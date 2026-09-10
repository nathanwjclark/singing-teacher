"""Actual process/SQLite lifecycle checks; no fake workers or native results."""
import gc
import json
import os
import signal
import sqlite3
import subprocess
import sys
import threading
import time

import pytest

from singing_physics.service import JobService, connect


def eventually(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.01)
    raise AssertionError('Timed out waiting for lifecycle condition')


def process_running(pid):
    # An adopted zombie is no longer executing native work; launchd/init reaps it.
    result = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True, timeout=2)
    state = result.stdout.strip()
    return bool(state) and not state.startswith('Z')


@pytest.mark.skipif(os.name != 'posix', reason='SIGKILL and process ownership test requires POSIX')
def test_parent_death_stops_native_worker_and_recovery_fails_pending(tmp_path):
    script = tmp_path / 'scheduler_parent.py'
    root = tmp_path / 'jobs'
    ready = tmp_path / 'ready.json'
    script.write_text('''
import json
from pathlib import Path
import sys
import time
from singing_physics.engine import Engine
from singing_physics.inverse import make_observations
from singing_physics.service import JobService

if __name__ == '__main__':
    root, ready = map(Path, sys.argv[1:])
    with Engine() as engine:
        observations = make_observations(engine, {'hard_palate_length': 4.42, 'pharynx_length': 6.83})
    with JobService(root, timeout_s=120) as service:
        running = service.submit({'operation': 'fit_transfer', 'parameters': {'observations': observations}}, idempotency_key='running')
        queued = service.submit({'operation': 'forward', 'parameters': {'duration_s': .1}}, idempotency_key='queued')
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            with service._mutex:
                worker = service._processes.get(running)
                if worker and (root / 'artifacts' / running).exists():
                    time.sleep(.2)  # Allow native initialization to enter the long fit.
                    payload = {'running': running, 'queued': queued, 'worker_pid': worker[0].pid}
                    temporary = ready.with_suffix('.partial')
                    temporary.write_text(json.dumps(payload))
                    temporary.replace(ready)
                    break
            time.sleep(.01)
        else:
            raise RuntimeError('Native worker did not start')
        while True:
            time.sleep(.1)
''')
    parent = subprocess.Popen([sys.executable, str(script), str(root), str(ready)],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    worker_pid = None
    try:
        eventually(lambda: ready.exists() or parent.poll() is not None, timeout=20)
        if not ready.exists():
            stdout, stderr = parent.communicate(timeout=2)
            pytest.fail(f'Parent exited before native work: {stdout}\n{stderr}')
        payload = json.loads(ready.read_text())
        worker_pid = payload['worker_pid']
        assert process_running(worker_pid)
        parent.kill()  # Only the subprocess created by this test.
        parent.wait(timeout=3)
        assert parent.returncode == -signal.SIGKILL
        eventually(lambda: not process_running(worker_pid), timeout=5)
        with JobService(root) as recovered:
            for key in ('running', 'queued'):
                state = recovered.status(payload[key])
                assert state['status'] == 'failed'
                assert state['error'] == 'scheduler_interrupted'
                with pytest.raises(RuntimeError, match='failed'):
                    recovered.result(payload[key])
        assert not (root / 'artifacts' / payload['running'] / 'manifest.json').exists()
    finally:
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=3)
        if worker_pid and process_running(worker_pid):
            os.kill(worker_pid, signal.SIGKILL)  # This test's recorded child only.
            eventually(lambda: not process_running(worker_pid), timeout=3)
        parent.communicate(timeout=3)


def test_cancel_at_result_publication_never_changes_a_terminal_result(tmp_path):
    with JobService(tmp_path) as service:
        for index in range(3):
            job = service.submit({'operation': 'forward', 'parameters': {'duration_s': .1}}, idempotency_key=f'race-{index}')
            outcome = []
            errors = []

            def cancel_at_publication():
                try:
                    eventually(lambda: (tmp_path / 'artifacts' / job / 'result.json').exists(), timeout=15)
                    outcome.append(service.cancel(job))
                except Exception as exc:
                    errors.append(exc)

            racer = threading.Thread(target=cancel_at_publication)
            racer.start()
            state = service.wait(job, timeout_s=20)
            racer.join(timeout=5)
            assert not racer.is_alive() and not errors and len(outcome) == 1
            final = service.status(job)
            assert final['status'] == ('cancelled' if outcome[0] else 'succeeded')
            assert state['status'] == final['status']
            assert not service.cancel(job)
            assert service.status(job) == final
            if outcome[0]:
                with pytest.raises(RuntimeError, match='cancelled'):
                    service.result(job)
            else:
                assert service.result(job)['kind'] == 'synthetic_forward_export'


def test_database_connections_close_without_garbage_collection(tmp_path):
    was_enabled = gc.isenabled()
    gc.disable()
    retained = []
    try:
        for _ in range(40):
            with connect(tmp_path) as connection:
                assert connection.execute('SELECT 1').fetchone()[0] == 1
                retained.append(connection)
        for connection in retained:
            with pytest.raises(sqlite3.ProgrammingError, match='closed'):
                connection.execute('SELECT 1')
        with pytest.raises(ValueError, match='transaction fails'):
            with connect(tmp_path) as failed:
                raise ValueError('transaction fails')
        with pytest.raises(sqlite3.ProgrammingError, match='closed'):
            failed.execute('SELECT 1')
    finally:
        if was_enabled:
            gc.enable()
