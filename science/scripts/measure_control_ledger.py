"""Measure session-ledger size across cue-execution rounds (generated native frames; temporary directory only).

    PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/measure_control_ledger.py --anatomies 4 --rounds 6

Each round freezes a five-alternative control forecast and scores one generated frame
through a real JobService and SessionController. Prints one JSON line per round with
the replay, state and event sizes. Nothing outside the temporary directory is written.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile

import numpy as np

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.service import JobService
from singing_physics.session import SessionController

WORDING = 'Sing an easy, comfortable ah and let the jaw drop.'
CONTROLS = [{'control_id': 'reference', 'JA': -3., 'f0_hz': 180.}, {'control_id': 'jaw-less-open', 'JA': -2., 'f0_hz': 180.},
            {'control_id': 'jaw-more-open', 'JA': -4., 'f0_hz': 180.}, {'control_id': 'pitch-lower', 'JA': -3., 'f0_hz': 169.9},
            {'control_id': 'pitch-higher', 'JA': -3., 'f0_hz': 190.7}]


def now(): return datetime.now(timezone.utc).isoformat()
def size(value): return len(json.dumps(value, separators=(',', ':')))


def measure(anatomies, rounds):
    with tempfile.TemporaryDirectory() as directory, JobService(Path(directory) / 'jobs') as service:
        controller = SessionController(Path(directory) / 'sessions', service, 'session')
        def send(action, **fields):
            version = controller.execute({'action': 'state'})['state']['version']
            return controller.execute({'action': action, 'command_id': f'{version}-{action}', 'expected_version': version, **fields})['state']
        def finish():
            job = controller.execute({'action': 'state'})['state']['pending']['job_id']
            if service.wait(job, timeout_s=120)['status'] != 'succeeded': raise RuntimeError(service.status(job))
            send('collect_job', job_id=job)
        with Engine() as engine:
            provenance = engine.provenance
        geometry = [{'hard_palate_length': 4. + .1 * i, 'pharynx_length': 6. + .15 * i} for i in range(anatomies)]
        send('register_model', snapshot=freeze_pcm_hypotheses(model_id='measurement-model', evidence_ids=['calibration'], evidence_hashes=['a' * 64],
            provenance=provenance, frozen_at=now(), hypotheses=[{'hypothesis_id': f'h{i}', 'anatomy': a} for i, a in enumerate(geometry)]).data)
        send('declare_control_binding', binding_id='measurement-cue', binding={
            'cue': {'cue_id': 'measurement-cue', 'cue_version': '1', 'wording': WORDING, 'wording_sha256': hashlib.sha256(WORDING.encode()).hexdigest(), 'mode': 'elicited'},
            'context': {'capture_context_id': 'native-usb-pcm', 'source_kind': 'engine-generated', 'pitch_hz': 180., 'vowel': 'a', 'level': 'comfortable', 'posture': 'not-instructed'},
            'controls': CONTROLS, 'gain': .8})
        for index in range(rounds):
            target = f'target-{index}'
            send('forecast_control', binding_id='measurement-cue', target_id=target, parameters={}); finish()
            with Engine() as engine:
                engine.set_anatomy(geometry[0])
                audio = engine.synthesize('a', {'JA': -4.5}, f0_hz=180., duration_s=.25)[4410:8506] * .8
            pcm = (audio + np.random.default_rng(index).normal(0, 1e-4, audio.shape)).tolist()
            send('score_control', forecast_id=target, pcm=pcm, metadata={'sessionId': 'session', 'observationId': target, 'attemptId': f'attempt-{index}',
                'artifactId': f'artifact-{index}', 'clockId': 'clock', 'sourceKind': 'engine-generated', 'evidenceAt': now(),
                'sourceHashes': [hashlib.sha256(f'measurement-original-{index}'.encode()).hexdigest()]})
            finish()
            replay = controller.execute({'action': 'replay'})
            print(json.dumps({'round': index + 1, 'replay_bytes': size(replay), 'state_bytes': size(replay['state']), 'events': len(replay['events'])}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--anatomies', type=int, default=4); parser.add_argument('--rounds', type=int, default=6)
    arguments = parser.parse_args()
    if not 1 <= arguments.anatomies <= 19 or not 1 <= arguments.rounds <= 20: parser.error('Use 1-19 anatomies and 1-20 rounds')
    measure(arguments.anatomies, arguments.rounds)
