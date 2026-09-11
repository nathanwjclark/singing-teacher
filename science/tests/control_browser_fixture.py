"""Browser fixture for cue-execution learning; generated evidence and seeded decisions, no paid model.

Starts the real worker and the built app server (dist/ from `npm run build`) on free loopback ports over a session with a calibration,
two frozen anatomy hypotheses and a committed experiment, then prints the app port.
The spec drives it with flag files: `publish-N` publishes a later generated native
capture as the latest USB pull; `decide-N` commits a new experiment and seeds an
Astra decision that repeats the declared cue binding verbatim.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
import zipfile

import numpy as np

from singing_physics.engine import Engine
from singing_physics.http_service import ScientificHTTPServer
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.pcm_inverse import FEATURES, extract_pcm, resample_native_pcm
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_live_capture_jobs import capture
from test_session import collect, send

WORDING = 'Sing an easy, comfortable ah.'
ANATOMIES = [{'hard_palate_length': 4.2, 'pharynx_length': 7.}, {'hard_palate_length': 4.8, 'pharynx_length': 6.2}]


def now(): return datetime.now(timezone.utc).isoformat()


def calibrate(controller):
    with Engine() as engine:
        provenance = engine.provenance
        audio, _ = resample_native_pcm(engine.synthesize('a', {'JA': -3.}, f0_hz=180., duration_s=.25), 44100, 48000)
    measurement = extract_pcm(audio[4800:8896] * 4., 48000, measurement_id='cal-measurement', observation_id='cal',
                              artifact_id='cal-audio', start_ms=100.)['measurement']
    send(controller, 'ingest_calibration', document={'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': [
        {'id': 'cal', 'pose': 'a', 'measurement': measurement, 'sample_rate_hz': 48000, 'frame_start_sample': 4800, 'frame_size': 4096, 'duration_s': .25}]})
    snapshot = freeze_pcm_hypotheses(model_id='browser-control-model', evidence_ids=['cal', 'cal-audio', 'cal-measurement'],
        evidence_hashes=measurement['provenance']['sourceHashes'], provenance=provenance, frozen_at=now(),
        hypotheses=[{'hypothesis_id': f'anatomy-{i}', 'anatomy': a} for i, a in enumerate(ANATOMIES)]).data
    send(controller, 'register_model', snapshot=snapshot)


def decide(root, controller, index, source, binding_id):
    design = f'selected-{index}'
    send(controller, 'select_experiment', source_design_id=source, design_id=design, target_observation_id=f'later-{index}',
         experiment_id='a', selection_reason='Seeded software decision for browser acceptance')
    state = controller.execute({'action': 'state'})['state']
    if binding_id:
        assert state['control_bindings'][binding_id]['cue']['wording'] == WORDING
    decision = {'action': 'record', 'experimentId': 'a', 'cue': WORDING, 'explanation': 'Seeded software decision.',
                **({'cueBindingId': binding_id} if binding_id else {})}
    stamp = now()
    (root / 'astra-decisions/session' / f'seeded-{index}.json').write_text(json.dumps({'status': 'succeeded', 'requestId': f'seeded-{index}',
        'createdAt': stamp, 'completedAt': stamp, 'sessionId': 'session', 'runId': 'run-control', 'modelId': state['snapshot']['model_id'],
        'designId': design, 'provider': 'seeded-software-fixture', 'model': 'no-live-model-call', 'decision': decision}))
    (root / 'science-runs/run-control/astra-current.json').write_text(json.dumps({'sessionId': 'session', 'modelId': state['snapshot']['model_id'],
        'designId': design, 'forecast': state['designs'][design]['data'], 'decisionId': f'seeded-{index}', 'sessionVersion': state['version'], 'createdAt': stamp}))
    return design


def publish(root, index):
    work = root / f'capture-work-{index}'; work.mkdir()
    source = capture(work)
    raw = (source / 'audio.pcm.raw').read_bytes()
    # A small level change per attempt; identical bytes would be rejected as reused evidence.
    scaled = (np.frombuffer(raw, dtype='<f4') * (1 + .02 * index)).astype('<f4').tobytes()
    (source / 'audio.pcm.raw').write_bytes(scaled)
    manifest = json.loads((source / 'manifest.json').read_text())
    manifest['capture_id'] = f'00000000-0000-4000-8000-0000000c{index:04d}'
    manifest['created_at'] = now()
    manifest['audio']['samples'][0]['artifact'].update(bytes=len(scaled), sha256=hashlib.sha256(scaled).hexdigest())
    (source / 'manifest.json').write_text(json.dumps(manifest))
    archive = root / 'usb-imports' / ('capture-' + manifest['capture_id'] + '.zip')
    with zipfile.ZipFile(archive, 'x') as zipped:
        for file in source.iterdir(): zipped.write(file, file.name)
    (root / 'native-pull-latest.json').write_text(json.dumps({'name': archive.name, 'bytes': archive.stat().st_size,
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))


def main():
    def stop(_signal, _frame): raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    root = Path(sys.argv[1]); root.mkdir(); jobs = root / 'jobs'
    with JobService(jobs) as service:
        controller = SessionController(jobs / 'sessions', service, 'session')
        calibrate(controller)
        send(controller, 'propose_design', parameters={'design_id': 'design', 'target_observation_id': 'future',
            'experiments': [{'experiment_id': 'a', 'pose': 'a', 'JA': -3., 'f0_hz': 180., 'gain': 4.}],
            'profile': {'sample_rate_hz': 48000, 'frame_start_sample': 4800, 'frame_size': 4096, 'duration_s': .25},
            'feature_scales': {key: {'unit': unit, 'scale': scale, 'assumption': 'Software fixture engineering scale'} for key, (unit, scale) in FEATURES.items()},
            'max_synthesis_calls': 2, 'minimum_separation': .000001})
        collect(controller, service)
    (root / 'science-runs/run-control').mkdir(parents=True); (root / 'astra-decisions/session').mkdir(parents=True); (root / 'usb-imports').mkdir()
    (root / 'science-current.json').write_text(json.dumps({'status': 'succeeded', 'runId': 'run-control'}))
    (root / 'science-runs/run-control/summary.json').write_text(json.dumps({'sessionId': 'session', 'modelId': 'browser-control-model',
        'source': 'development-fixture', 'files': {}}))
    token = 'browser-control-token-' + 'c' * 32
    worker = ScientificHTTPServer(str(jobs), token, port=0)
    thread = threading.Thread(target=worker.serve_forever, daemon=True); thread.start()
    controller = SessionController(jobs / 'sessions', worker.jobs, 'session')
    design = decide(root, controller, 0, 'design', None)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); app_port = probe.getsockname()[1]
    env = {**os.environ, 'OPENAI_API_KEY': '', 'OPENAI_ENV_FILE': str(root / 'absent.env'), 'PORT': str(app_port), 'HOST': '127.0.0.1',
           'LOCAL_DATA_DIR': str(root), 'SCIENCE_URL': f'http://127.0.0.1:{worker.server_port}', 'SCIENCE_TOKEN': token}
    app = subprocess.Popen(['node', 'server/local.mjs'], cwd=Path.cwd(), env=env, stdout=subprocess.DEVNULL, stderr=sys.stderr)
    print(json.dumps({'port': app_port}), flush=True)
    try:
        while not (root / 'quit').exists():
            for flag in sorted(root.glob('publish-*')) + sorted(root.glob('decide-*')):
                done = root / flag.name.replace('publish-', 'published-').replace('decide-', 'decided-')
                if done.exists(): continue
                index = int(flag.name.split('-')[1])
                if flag.name.startswith('publish-'): publish(root, index)
                else:
                    state = controller.execute({'action': 'state'})['state']
                    design = decide(root, controller, index, design, next(iter(state['control_bindings'])))
                done.write_text('complete')
            time.sleep(.05)
    finally:
        app.terminate(); app.wait(timeout=10); worker.shutdown(); worker.server_close()


if __name__ == '__main__': main()
