import json
import pytest
from singing_physics.service import JobService


def request(**parameters):
    return {'operation': 'forward', 'parameters': {'duration_s': .1, **parameters}}


def test_real_forward_replay_idempotency_and_integrity(tmp_path):
    with JobService(tmp_path) as service:
        job = service.submit(request(), idempotency_key='first')
        assert service.submit(request(), idempotency_key='first') == job
        with pytest.raises(ValueError, match='Idempotency'):
            service.submit(request(f0_hz=180), idempotency_key='first')
        assert service.wait(job)['status'] == 'succeeded'
        original = service.result(job)
        assert original['kind'] == 'synthetic_forward_export'
        again = service.replay(job, idempotency_key='replay')
        assert again != job
        assert service.wait(again)['status'] == 'succeeded'
        assert service.result(again) == original
        result_path = tmp_path / 'artifacts' / job / 'result.json'
        result_path.write_text('{}')
        with pytest.raises(RuntimeError, match='integrity'):
            service.result(job)
    with JobService(tmp_path) as reopened:
        assert reopened.status(again)['status'] == 'succeeded'
        assert reopened.result(again) == original


def test_cancel_failure_lock_and_stale_model(tmp_path):
    with JobService(tmp_path) as service:
        with pytest.raises(RuntimeError, match='already owns'):
            JobService(tmp_path)
        service.register_model('session', 'model-a')
        payload = {**request(), 'session_id': 'session', 'model_id': 'model-a'}
        job = service.submit(payload, idempotency_key='success')
        assert service.wait(job)['status'] == 'succeeded'
        service.register_model('session', 'model-b')
        with pytest.raises(ValueError, match='stale_model'):
            service.result(job)
        with pytest.raises(ValueError, match='stale_model'):
            service.replay(job, idempotency_key='stale')
        cancelled = service.submit(request(duration_s=5), idempotency_key='cancel')
        assert service.cancel(cancelled)
        assert service.wait(cancelled)['status'] == 'cancelled'
        assert not service.cancel(cancelled)
        with pytest.raises(RuntimeError, match='cancelled'):
            service.result(cancelled)
        invalid = service.submit(request(pose='does-not-exist'), idempotency_key='failure')
        state = service.wait(invalid)
        assert state['status'] == 'failed'
        assert 'Unknown pose' in state['error']
    with pytest.raises(RuntimeError, match='closed'):
        service.status(job)


def test_validation_and_close_marks_pending(tmp_path):
    service = JobService(tmp_path)
    for bad in [{}, {'operation':'forward','parameters':{'output':'/tmp/escape'}},
                {**request(), 'model_id':'alone'}, request(f0_hz=float('nan'))]:
        with pytest.raises(ValueError):
            service.submit(bad, idempotency_key='invalid')
    with pytest.raises(KeyError):
        service.status('missing')
    job = service.submit(request(), idempotency_key='close')
    service.close()
    with JobService(tmp_path) as reopened:
        assert reopened.status(job)['status'] == 'cancelled'
        assert not (tmp_path / 'artifacts' / job / 'manifest.json').exists()


def test_parallel_workers_and_timeout(tmp_path):
    from singing_physics.engine import Engine
    from singing_physics.inverse import make_observations
    with JobService(tmp_path/'parallel', max_workers=2) as service:
        jobs = [service.submit(request(), idempotency_key=str(i)) for i in range(2)]
        assert all(service.wait(job)['status'] == 'succeeded' for job in jobs)
        assert service.result(jobs[0]) == service.result(jobs[1])
    with Engine() as engine:
        data = make_observations(engine, {'hard_palate_length':4.3})
    with JobService(tmp_path/'timeout', timeout_s=1) as service:
        job = service.submit({'operation':'fit_transfer', 'parameters':{'observations':data}}, idempotency_key='timeout')
        state = service.wait(job)
        assert state['status'] == 'failed' and state['error'] == 'timeout'
        with pytest.raises(RuntimeError, match='failed'):
            service.result(job)
