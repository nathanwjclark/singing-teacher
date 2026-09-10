"""Durable local scientific jobs; native state is isolated in child processes.

This is the transport-independent service layer. Public KIT-01 HTTP adaptation
belongs to the shared contract handoff, not an invented parallel wire protocol.
"""
from __future__ import annotations

import hashlib
import os
from contextlib import contextmanager
import json
import multiprocessing as mp
from pathlib import Path
import sqlite3
import threading
import time
import uuid
import fcntl

TERMINAL = {'succeeded', 'failed', 'cancelled'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


@contextmanager
def connect(root):
    db = sqlite3.connect(Path(root) / 'jobs.sqlite3', timeout=10)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def _worker(root, job_id, parent_pid, timeout_s):
    """Only this subprocess owns a native Engine. Parent owns scheduling."""
    def watchdog():
        deadline = time.monotonic() + timeout_s + 1
        while time.monotonic() < deadline:
            if os.getppid() != parent_pid:
                os._exit(70)
            time.sleep(.1)
        os._exit(124)
    threading.Thread(target=watchdog, daemon=True).start()
    from .engine import Engine, digest, write_json
    from .inverse import fit
    with connect(root) as db:
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
    if row is None or row['status'] != 'running':
        return
    request = json.loads(row['request'])
    destination = Path(root) / 'artifacts' / job_id
    try:
        destination.mkdir(parents=True, exist_ok=False)
        params = request['parameters']
        if request['operation'] == 'fit_control':
            from .control import fit_control_profile
            result = fit_control_profile(**params)
        elif request['operation'] in {'control_predict', 'condition_prediction'}:
            from .prediction import Artifact
            from .control_forecast import predict_control, condition_on_execution
            snapshot = Artifact(params['snapshot_json'].encode())
            options = {k:v for k,v in params.items() if k not in {'snapshot_json','control_profile_json','prospective_json'}}
            if request['operation'] == 'control_predict':
                forecast = predict_control(snapshot, Artifact(params['control_profile_json'].encode()), **options)
            else:
                forecast = condition_on_execution(Artifact(params['prospective_json'].encode()), snapshot, **options)
            forecast.write(destination / 'forecast.json')
            result = forecast.data
        elif request['operation'] in {'design_pcm', 'update_pcm'}:
            from .prediction import Artifact
            from .pcm_design import design_pcm, update_pcm
            snapshot = Artifact(params['snapshot_json'].encode())
            options = {k:v for k,v in params.items() if k not in {'snapshot_json', 'design_json'}}
            if request['operation'] == 'design_pcm':
                artifact = design_pcm(snapshot, **options)
            else:
                artifact = update_pcm(Artifact(params['design_json'].encode()), snapshot, **options)
            artifact.write(destination / ('design.json' if request['operation'] == 'design_pcm' else 'update.json'))
            result = artifact.data
        elif request['operation'] == 'predict_probe':
            from .prediction import Artifact
            from .probe_prediction import predict_probe
            snapshot = Artifact(params['snapshot_json'].encode())
            forecast = predict_probe(snapshot, **{k:v for k,v in params.items() if k != 'snapshot_json'})
            forecast.write(destination / 'forecast.json')
            result = forecast.data
        elif request['operation'] == 'rank_interventions':
            from .prediction import Artifact
            from .identifiability import rank_interventions
            snapshot = Artifact(params['snapshot_json'].encode())
            ranking = rank_interventions(snapshot, **{k:v for k,v in params.items() if k != 'snapshot_json'})
            ranking.write(destination / 'ranking.json')
            result = ranking.data
        elif request['operation'] == 'predict':
            from .prediction import Artifact, predict
            snapshot = Artifact(params['snapshot_json'].encode())
            options = {k: v for k, v in params.items() if k != 'snapshot_json'}
            forecast = predict(snapshot, **options)
            forecast.write(destination / 'forecast.json')
            result = forecast.data
        else:
            with Engine() as engine:
                if request['operation'] == 'forward':
                    result = engine.export(destination / 'forward', **params)
                elif request['operation'] == 'fit_transfer':
                    result = fit(engine, params['observations'], **{k: v for k, v in params.items() if k != 'observations'})
                elif request['operation'] == 'fit_pcm':
                    from .pcm_inverse import fit_pcm
                    result = fit_pcm(engine, params['observations'], **{k:v for k,v in params.items() if k != 'observations'})
                elif request['operation'] == 'search_pcm':
                    from .pcm_search import search_pcm
                    result = search_pcm(engine, params['observations'], **{k:v for k,v in params.items() if k != 'observations'})
                elif request['operation'] == 'fit_probe_pcm':
                    from .probe_inverse import fit_probe_pcm
                    result = fit_probe_pcm(engine, params['observations'], params['probe_observations'],
                        **{k:v for k,v in params.items() if k not in {'observations', 'probe_observations'}})
                elif request['operation'] == 'fit_frozen_control':
                    from .prediction import Artifact
                    from .frozen_control import fit_frozen_control
                    snapshot = Artifact(params['snapshot_json'].encode())
                    options = {k:v for k,v in params.items() if k not in {'snapshot_json', 'observations'}}
                    result = fit_frozen_control(engine, snapshot, params['observations'], **options)
                elif request['operation'] == 'fit_dynamic':
                    from .dynamic import fit_dynamic
                    result = fit_dynamic(engine, params['observations'], **{k:v for k,v in params.items() if k != 'observations'})
                elif request['operation'] == 'fit_joint':
                    from .joint import fit_joint
                    result = fit_joint(engine, params['observations'], **{k: v for k, v in params.items() if k != 'observations'})
                else:
                    raise ValueError('Unsupported operation')
        result_path = destination / 'result.json'
        write_json(result_path, result)
        files = {str(p.relative_to(destination)): digest(p) for p in destination.rglob('*') if p.is_file()}
        manifest = {'schema_version': 'science-local-0.1', 'job_id': job_id,
                    'request_sha256': row['request_hash'], 'model_id': request.get('model_id'),
                    'session_id': request.get('session_id'), 'files': files}
        write_json(destination / 'manifest.json', manifest)
        manifest_hash = digest(destination / 'manifest.json')
        with connect(root) as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()
            if current['status'] != 'running':
                return
            if request.get('session_id'):
                model = db.execute('SELECT model_id FROM models WHERE session_id=?', (request['session_id'],)).fetchone()
                if model is None or model['model_id'] != request['model_id']:
                    db.execute("UPDATE jobs SET status='failed',error='stale_model',updated=? WHERE id=?", (time.time(), job_id))
                    return
            db.execute("UPDATE jobs SET status='succeeded',manifest_hash=?,updated=? WHERE id=?", (manifest_hash, time.time(), job_id))
    except Exception as exc:
        with connect(root) as db:
            db.execute("UPDATE jobs SET status='failed',error=?,updated=? WHERE id=? AND status='running'", (f'{type(exc).__name__}: {exc}', time.time(), job_id))


class JobService:
    """One scheduler per directory. Reopen safely; never silently replay work."""
    def __init__(self, root, *, max_workers=1, timeout_s=180.):
        if type(max_workers) is not int or not 1 <= max_workers <= 2:
            raise ValueError('max_workers must be 1 or 2')
        if isinstance(timeout_s, bool) or not isinstance(timeout_s, (int, float)) or not 1 <= timeout_s <= 3600:
            raise ValueError('timeout_s must be finite and between 1 and 3600')
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / 'artifacts').mkdir(exist_ok=True)
        self._lockfile = (self.root / 'scheduler.lock').open('a')
        try:
            fcntl.flock(self._lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._lockfile.close()
            raise RuntimeError('A scheduler already owns this directory') from None
        self._closed = False
        self._mutex = threading.RLock()
        self._stop = threading.Event()
        self._processes = {}
        self._max_workers, self._timeout = max_workers, timeout_s
        try:
            with connect(self.root) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE IF NOT EXISTS models(session_id TEXT PRIMARY KEY, model_id TEXT NOT NULL)')
                db.execute('''CREATE TABLE IF NOT EXISTS jobs(
                    id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, request TEXT NOT NULL,
                    request_hash TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
                    manifest_hash TEXT, created REAL NOT NULL, updated REAL NOT NULL)''')
                db.execute("UPDATE jobs SET status='failed',error='scheduler_interrupted',updated=? WHERE status IN ('queued','running')", (time.time(),))
            self._thread = threading.Thread(target=self._schedule, daemon=True)
            self._thread.start()
        except BaseException:
            self._lockfile.close()
            raise

    def _guard(self):
        if self._closed:
            raise RuntimeError('Service is closed')

    @staticmethod
    def _identity(value, label):
        if not isinstance(value, str) or not value.strip() or len(value) > 256:
            raise ValueError(f'{label} must be a nonempty string of at most 256 characters')

    def register_model(self, session_id, model_id):
        self._guard()
        self._identity(session_id, 'session_id')
        self._identity(model_id, 'model_id')
        with connect(self.root) as db:
            db.execute('INSERT INTO models VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET model_id=excluded.model_id', (session_id, model_id))

    def submit(self, request, *, idempotency_key):
        self._guard()
        self._identity(idempotency_key, 'idempotency_key')
        if not isinstance(request, dict) or set(request) - {'operation', 'parameters', 'session_id', 'model_id'}:
            raise ValueError('Invalid local job request fields')
        if request.get('operation') not in {'forward', 'fit_transfer', 'fit_joint', 'predict', 'fit_dynamic', 'fit_control', 'control_predict', 'condition_prediction', 'fit_frozen_control', 'rank_interventions', 'fit_pcm', 'search_pcm', 'design_pcm', 'update_pcm', 'fit_probe_pcm', 'predict_probe'} or not isinstance(request.get('parameters'), dict):
            raise ValueError('Unsupported operation or missing parameters')
        allowed = {
            'predict_probe': {'snapshot_json', 'expected_digest', 'prediction_id', 'target_evidence_id', 'generated_at', 'pose', 'frequency_hz', 'placement', 'calibration', 'calibration_evidence_ids', 'calibration_frozen_at', 'articulation', 'channel', 'comparison', 'timing', 'termination', 'termination_resistance_pa_s_m3', 'attenuation_np_per_m', 'max_operator_calls'},
            'fit_probe_pcm': {'observations', 'probe_observations', 'candidates', 'max_native_calls', 'pcm_weight', 'probe_weight'},
            'search_pcm': {'observations', 'anatomy_bounds', 'nuisance_profiles', 'max_synthesis_calls', 'rounds', 'seed'},
            'design_pcm': {'snapshot_json', 'expected_digest', 'design_id', 'target_observation_id', 'generated_at', 'experiments', 'feature_scales', 'minimum_separation', 'max_synthesis_calls', 'retention_margin', 'maximum_discrepancy'},
            'update_pcm': {'snapshot_json', 'design_json', 'expected_design_digest', 'expected_snapshot_digest', 'experiment_id', 'observation_id', 'artifact_id', 'observed_at', 'pcm', 'sample_rate_hz', 'frame_start_sample', 'frame_size', 'source_kind'},
            'fit_pcm': {'observations', 'candidates', 'max_synthesis_calls'},
            'fit_frozen_control': {'snapshot_json', 'observations', 'expected_digest', 'candidate_id', 'budget', 'seed'},
            'rank_interventions': {'snapshot_json', 'expected_digest', 'ranking_id', 'target_evidence_id', 'generated_at', 'interventions', 'noise_sigma_db', 'noise_assumption', 'frequency_band_hz', 'bins', 'max_native_calls', 'separation_threshold'},
            'forward': {'pose', 'anatomy', 'articulation', 'f0_hz', 'duration_s'},
            'fit_transfer': {'observations', 'starts', 'seed', 'max_spectrum_evaluations'},
            'fit_joint': {'observations', 'anatomy_bounds', 'articulation_bounds', 'budget_per_model', 'starts', 'seed'},
            'fit_dynamic': {'observations', 'anatomy_bounds', 'articulation_bounds', 'budget_per_model', 'starts', 'seed'},
            'fit_control': {'attempts', 'anatomy_model_id', 'fitted_at'},
            'control_predict': {'snapshot_json', 'control_profile_json', 'expected_anatomy_digest', 'expected_control_digest', 'prediction_id', 'target_evidence_id', 'generated_at', 'cue_id', 'cue_version', 'context', 'mode', 'bins', 'max_native_calls'},
            'condition_prediction': {'prospective_json', 'snapshot_json', 'expected_prospective_digest', 'expected_anatomy_digest', 'prediction_id', 'generated_at', 'observed_at', 'observed_evidence_id', 'measured_ja_deg', 'measurement_sigma_deg', 'bins', 'max_native_calls'},
            'predict': {'snapshot_json', 'expected_digest', 'prediction_id', 'target_evidence_id', 'generated_at', 'intervention', 'bins', 'repeat_variability'},
        }[request['operation']]
        if set(request['parameters']) - allowed:
            raise ValueError('Unsupported operation parameters')
        if request['operation'] in {'fit_transfer', 'fit_joint', 'fit_dynamic'} and 'observations' not in request['parameters']:
            raise ValueError('Missing observations')
        if request['operation'] == 'predict' and not {'snapshot_json', 'expected_digest', 'prediction_id', 'target_evidence_id', 'generated_at', 'intervention'} <= set(request['parameters']):
            raise ValueError('Missing prediction parameters')
        required = {
            'predict_probe': {'snapshot_json', 'expected_digest', 'prediction_id', 'target_evidence_id', 'generated_at', 'pose', 'frequency_hz', 'placement', 'calibration', 'calibration_evidence_ids', 'calibration_frozen_at'},
            'fit_probe_pcm': {'observations', 'probe_observations', 'candidates'},
            'search_pcm': {'observations', 'anatomy_bounds', 'nuisance_profiles'},
            'design_pcm': {'snapshot_json', 'expected_digest', 'design_id', 'target_observation_id', 'generated_at', 'experiments', 'feature_scales'},
            'update_pcm': {'snapshot_json', 'design_json', 'expected_design_digest', 'expected_snapshot_digest', 'experiment_id', 'observation_id', 'artifact_id', 'observed_at', 'pcm'},
            'fit_pcm': {'observations', 'candidates'},
            'fit_frozen_control': {'snapshot_json', 'observations', 'expected_digest', 'candidate_id'},
            'rank_interventions': {'snapshot_json', 'expected_digest', 'ranking_id', 'target_evidence_id', 'generated_at', 'interventions', 'noise_sigma_db', 'noise_assumption'},
            'fit_control': {'attempts', 'anatomy_model_id', 'fitted_at'},
            'control_predict': {'snapshot_json', 'control_profile_json', 'expected_anatomy_digest', 'expected_control_digest', 'prediction_id', 'target_evidence_id', 'generated_at', 'cue_id', 'cue_version', 'context', 'mode'},
            'condition_prediction': {'prospective_json', 'snapshot_json', 'expected_prospective_digest', 'expected_anatomy_digest', 'prediction_id', 'generated_at', 'observed_at', 'observed_evidence_id', 'measured_ja_deg', 'measurement_sigma_deg'},
        }.get(request['operation'], set())
        if not required <= set(request['parameters']):
            raise ValueError('Missing operation parameters')
        if ('session_id' in request) != ('model_id' in request):
            raise ValueError('session_id and model_id must occur together')
        for key in ('session_id', 'model_id'):
            if key in request:
                self._identity(request[key], key)
        if request['operation'] in {'predict', 'control_predict', 'condition_prediction', 'fit_frozen_control', 'rank_interventions', 'design_pcm', 'update_pcm', 'predict_probe'} and 'model_id' in request:
            snapshot = json.loads(request['parameters']['snapshot_json'])
            if not isinstance(snapshot, dict) or snapshot.get('model_id') != request['model_id']:
                raise ValueError('Prediction or inference model does not match job model')
        if request['operation'] == 'fit_control' and 'model_id' in request and request['parameters']['anatomy_model_id'] != request['model_id']:
            raise ValueError('Control profile anatomy model does not match job model')
        encoded = canonical(request)
        if len(encoded.encode()) > 2_000_000:
            raise ValueError('Job input exceeds 2 MB; keep large media outside requests')
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        with self._mutex, connect(self.root) as db:
            self._guard()
            db.execute('BEGIN IMMEDIATE')
            prior = db.execute('SELECT * FROM jobs WHERE key=?', (idempotency_key,)).fetchone()
            if prior:
                if prior['request_hash'] != digest:
                    raise ValueError('Idempotency key reused with different input')
                return prior['id']
            if 'session_id' in request:
                model = db.execute('SELECT model_id FROM models WHERE session_id=?', (request['session_id'],)).fetchone()
                if model is None or model['model_id'] != request['model_id']:
                    raise ValueError('stale_model')
            job_id = uuid.uuid4().hex
            now = time.time()
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)', (job_id, idempotency_key, encoded, digest, 'queued', None, None, now, now))
        return job_id

    def status(self, job_id):
        self._guard()
        with connect(self.root) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return {key: row[key] for key in ('id', 'status', 'error', 'request_hash', 'manifest_hash', 'created', 'updated')}

    def cancel(self, job_id):
        self._guard()
        with self._mutex, connect(self.root) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row is None:
                raise KeyError(job_id)
            if row['status'] in TERMINAL:
                return False
            db.execute("UPDATE jobs SET status='cancelled',error='cancelled_by_caller',updated=? WHERE id=?", (time.time(), job_id))
            # Commit cancellation before stopping the process, so no late result wins.
        with self._mutex:
            if job_id in self._processes:
                process, _ = self._processes[job_id]
                self._terminate(process)
        return True

    @staticmethod
    def _terminate(process):
        if process.is_alive():
            process.terminate()
            process.join(timeout=1)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)

    def _schedule(self):
        while not self._stop.wait(.03):
            with self._mutex:
                for job_id, (process, began) in list(self._processes.items()):
                    timeout = time.monotonic() - began > self._timeout
                    if timeout or not process.is_alive():
                        with connect(self.root) as db:
                            db.execute("UPDATE jobs SET status='failed',error=?,updated=? WHERE id=? AND status='running'", ('timeout' if timeout else 'worker_exited_without_result', time.time(), job_id))
                        self._terminate(process)
                        process.join(timeout=1)
                        process.close()
                        del self._processes[job_id]
                if len(self._processes) >= self._max_workers:
                    continue
                with connect(self.root) as db:
                    db.execute('BEGIN IMMEDIATE')
                    row = db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created,id LIMIT 1").fetchone()
                    if row is None:
                        continue
                    db.execute("UPDATE jobs SET status='running',updated=? WHERE id=?", (time.time(), row['id']))
                process = mp.get_context('spawn').Process(target=_worker, args=(str(self.root), row['id'], os.getpid(), self._timeout), daemon=True)
                try:
                    process.start()
                    self._processes[row['id']] = (process, time.monotonic())
                except Exception as exc:
                    with connect(self.root) as db:
                        db.execute("UPDATE jobs SET status='failed',error=?,updated=? WHERE id=? AND status='running'", (f'worker_start: {exc}', time.time(), row['id']))

    def result(self, job_id):
        from .engine import digest
        self._guard()
        with connect(self.root) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row is None:
                raise KeyError(job_id)
            if row['status'] != 'succeeded':
                raise RuntimeError(f"Job is {row['status']}: {row['error']}")
            request = json.loads(row['request'])
            if 'session_id' in request:
                model = db.execute('SELECT model_id FROM models WHERE session_id=?', (request['session_id'],)).fetchone()
                if model is None or model['model_id'] != request['model_id']:
                    raise ValueError('stale_model')
        destination = self.root / 'artifacts' / row['id']
        manifest = destination / 'manifest.json'
        if digest(manifest) != row['manifest_hash']:
            raise RuntimeError('Artifact manifest integrity failure')
        record = json.loads(manifest.read_text())
        for name, expected in record['files'].items():
            path = (destination / name).resolve()
            if not path.is_relative_to(destination) or digest(path) != expected:
                raise RuntimeError('Artifact integrity failure')
        return json.loads((destination / 'result.json').read_text())

    def replay(self, job_id, *, idempotency_key):
        self._guard()
        with connect(self.root) as db:
            row = db.execute('SELECT request FROM jobs WHERE id=?', (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return self.submit(json.loads(row['request']), idempotency_key=idempotency_key)

    def wait(self, job_id, timeout_s=30):
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            state = self.status(job_id)
            if state['status'] in TERMINAL:
                return state
            time.sleep(.03)
        raise TimeoutError(job_id)

    def close(self):
        if self._closed:
            return
        self._stop.set()
        self._thread.join(timeout=5)
        with self._mutex:
            with connect(self.root) as db:
                db.execute("UPDATE jobs SET status='cancelled',error='scheduler_closed',updated=? WHERE status IN ('queued','running')", (time.time(),))
            for process, _ in self._processes.values():
                self._terminate(process)
                process.close()
            self._processes.clear()
            self._closed = True
            self._lockfile.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
