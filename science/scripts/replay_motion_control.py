#!/usr/bin/env python3
"""Replay synthetic visible motion through dynamic inference and motor forecasts."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time

import numpy as np

from observations.geometry.depth import DepthFrame
from observations.geometry.motion import MotionFrame, analyze_motion
from singing_physics.control_forecast import freeze_control_profile
from singing_physics.dynamic import KIND
from singing_physics.engine import Engine, digest, write_json
from singing_physics.prediction import Artifact, freeze_candidates
from singing_physics.service import JobService

CONTEXT = {'pitch_hz': 160., 'vowel': 'a', 'level': 'comfortable', 'posture': 'seated'}
CUE = 'synthetic-research-jaw-sequence'


def iso(timestamp=None):
    return datetime.fromtimestamp(time.time() if timestamp is None else timestamp, timezone.utc).isoformat()


def complete(service, operation, parameters, key, *, model_id=None):
    request = {'operation': operation, 'parameters': parameters}
    if model_id is not None:
        request.update(session_id='synthetic-motion-session', model_id=model_id)
    job = service.submit(request, idempotency_key=key)
    state = service.wait(job, timeout_s=180)
    if state['status'] != 'succeeded':
        raise RuntimeError(f'{operation} failed: {state}')
    return job, service.result(job)


def generate(output):
    truth = {'hard_palate_length': 4.50, 'pharynx_length': 6.60}
    controls = [[-2.8, -3.8, -2.8], [-3.1, -3.1, -3.1], [-2.5, -3.5, -2.6]]
    statuses = ['successful', 'unsuccessful', 'unknown']
    attempts = []
    baseline = time.time() - 20
    (output / 'depth').mkdir()
    with Engine() as engine:
        engine.set_anatomy(truth)
        write_json(output / 'capabilities.json', engine.capabilities())
        for attempt_index, jaws in enumerate(controls):
            frames, audio = [], {}
            for index, (pose, jaw) in enumerate(zip(('a', 'i', 'a'), jaws)):
                identity = f'attempt-{attempt_index}-frame-{index}'
                timestamp = baseline + attempt_index * 2 + index * .05
                hz, spectrum, _ = engine.spectrum(pose, {'JA': jaw}, bins=512)
                mask = (hz >= 100) & (hz <= 6000)
                audio[identity] = {'audio_evidence_id': f'audio-{identity}', 'pose': pose,
                    'frequency_hz': hz[mask].tolist(), 'magnitude_db': spectrum[mask].tolist()}
                distance = engine.lip_markers(pose, articulation={'JA': jaw})['distance_m']
                values = np.full((1, 2), .5)
                intrinsics = np.diag([.5/distance, .5/distance, 1.])
                np.savez(output / 'depth' / f'{identity}.npz', depth_m=values, intrinsics=intrinsics,
                         world_from_camera=np.eye(4), timestamp_seconds=timestamp)
                depth = DepthFrame(evidence_id=f'depth-{identity}', timebase_id='synthetic-epoch-clock',
                    timestamp_seconds=timestamp, depth=values, intrinsics=intrinsics,
                    world_from_camera=np.eye(4), units='m', rectified=True,
                    depth_sigma_m=.0001, pixel_sigma=.01, visible_mask=np.ones((1, 2), dtype=bool),
                    sync_uncertainty_seconds=.001)
                frames.append(MotionFrame(identity, depth, np.eye(4), f'head-{identity}',
                    {'upper_lip': {'pixel_uv': [0, 0], 'correspondence_id': 'upper-v1'},
                     'lower_lip': {'pixel_uv': [1, 0], 'correspondence_id': 'lower-v1'}},
                    head_pose_rigid_reference_ids=(f'rigid-reference-{identity}',)))
            attempt = analyze_motion(frames, attempt_id=f'attempt-{attempt_index}', cue_id=CUE,
                cue_version='research-1', context_id='final-a-context', context=CONTEXT,
                split='calibration', expected_correspondence={'upper_lip': 'upper-v1', 'lower_lip': 'lower-v1'},
                outcome='unsuccessful' if statuses[attempt_index] == 'unsuccessful' else 'completed',
                lip_correspondence_id='native-lip-protocol-v1', lip_model_sigma_m=.002)
            attempt.update(cue_delivered_seconds=baseline + attempt_index * 2 - .05,
                actual_onset_seconds=baseline + attempt_index * 2 + .05,
                execution_status=statuses[attempt_index], mode='elicited')
            for row in attempt['frames']:
                row.update(audio[row['id']])
            attempts.append(attempt)
        document = {'schema_version': '0.1.0', 'kind': KIND, 'sample_rate_hz': engine.sample_rate,
            'spectrum_bins': 512, 'provenance': engine.provenance, 'max_gap_seconds': .1, 'attempts': attempts}
    write_json(output / 'generation-truth.json', {'kind': 'synthetic_generation_only', 'anatomy': truth,
                                                'jaw_controls_by_attempt': controls})
    write_json(output / 'dynamic-input.json', document)
    return document


def replay(output, *, budget=20):
    if type(budget) is not int or not 10 <= budget <= 10000:
        raise ValueError('budget must be an integer between 10 and 10000')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    # The final a frame is selected before fitting, independent of fit quality.
    write_json(output / 'protocol.json', {'kind': 'synthetic_research_protocol', 'cue_id': CUE,
        'cue_version': 'research-1', 'review_status': 'synthetic_test_only_not_a_human_cue',
        'trajectory_poses': ['a', 'i', 'a'], 'control_selection': 'final_frame_index_2_per_attempt',
        'independent_attempts': 3, 'context': CONTEXT,
        'depth_model': 'two_pixel_pinhole_pair_exactly_matching_native_visible_lip_distance'})
    document = generate(output)
    with JobService(output / 'jobs', timeout_s=180) as service:
        dynamic_id, dynamic = complete(service, 'fit_dynamic', {'observations': document,
            'budget_per_model': budget, 'starts': 1, 'seed': 7}, 'dynamic')
        model_id = dynamic['model_id']
        service.register_model('synthetic-motion-session', model_id)
        controls = []
        for attempt in dynamic['attempts']:
            frame = attempt['frames'][2]
            state = frame['state']
            controls.append({'attempt_id': attempt['attempt_id'], 'evidence_id': frame['id'],
                'cue_id': CUE, 'cue_version': 'research-1', 'context': CONTEXT, 'mode': 'elicited',
                'observed_at': iso(frame['timestamp_seconds']), 'sensor_status': 'valid', 'sensor_reason': None,
                'execution_status': attempt['execution_status'], 'JA': state['native_controls']['JA']['applied'],
                'measurement_sigma_deg': None, 'operator_id': 'dynamic-final-a-reconstruction-v1',
                'comfortable': True, 'source_kind': 'inferred_articulation',
                'uncertainty_scope': state['uncertainty_scope'], 'derived_model_id': state['derived_model_id']})
        write_json(output / 'control-attempts.json', controls)
        control_id, profile = complete(service, 'fit_control', {'attempts': controls,
            'anatomy_model_id': model_id, 'fitted_at': iso()}, 'control', model_id=model_id)
        control_snapshot = freeze_control_profile(profile)
        control_snapshot.write(output / 'control-profile.json')
        anatomy = freeze_candidates(model_id=model_id, evidence_ids=dynamic['joint_fit']['calibration_ids'],
            provenance=dynamic['joint_fit']['provenance'], frozen_at=iso(),
            candidates=[{'candidate_id': 'joint-best', 'anatomy': dynamic['shared_anatomy']}])
        anatomy.write(output / 'anatomy-candidates.json')
        parameters = {'snapshot_json': anatomy.content.decode(), 'control_profile_json': control_snapshot.content.decode(),
            'expected_anatomy_digest': anatomy.sha256, 'expected_control_digest': control_snapshot.sha256,
            'prediction_id': 'synthetic-motion-prospective', 'target_evidence_id': 'next-independent-attempt',
            'generated_at': iso(), 'cue_id': CUE, 'cue_version': 'research-1', 'context': CONTEXT,
            'mode': 'elicited', 'bins': 512, 'max_native_calls': 32}
        forecast_id, forecast = complete(service, 'control_predict', parameters, 'forecast', model_id=model_id)
        prospective = Artifact((output / 'jobs' / 'artifacts' / forecast_id / 'forecast.json').read_bytes())
        prospective.write(output / 'prospective.json')
        # Target generation happens only after the prospective artifact was persisted.
        rng = np.random.default_rng(42)
        latent_ja = float(rng.uniform(-3.5, -2.5))
        measured_ja = float(latent_ja + rng.normal(0, .05))
        observed_at = iso()
        measurement = {'evidence_id': 'next-independent-attempt', 'source_kind': 'synthetic',
            'observed_at': observed_at, 'measured_ja_deg': measured_ja, 'measurement_sigma_deg': .05}
        write_json(output / 'target-measurement.json', measurement)
        write_json(output / 'target-generation-truth.json', {'latent_ja_deg': latent_ja,
            'generation': 'uniform_control_plus_independent_gaussian_sensor_error', 'sensor_sigma_deg': .05})
        conditional_id, conditional = complete(service, 'condition_prediction', {
            'prospective_json': prospective.content.decode(), 'snapshot_json': anatomy.content.decode(),
            'expected_prospective_digest': prospective.sha256, 'expected_anatomy_digest': anatomy.sha256,
            'prediction_id': 'synthetic-motion-conditional', 'generated_at': iso(), 'observed_at': observed_at,
            'observed_evidence_id': measurement['evidence_id'], 'measured_ja_deg': measured_ja,
            'measurement_sigma_deg': .05}, 'conditional', model_id=model_id)
        repeated_id = service.replay(forecast_id, idempotency_key='forecast-replay')
        if service.wait(repeated_id, timeout_s=180)['status'] != 'succeeded':
            raise RuntimeError('Prospective replay failed')
        if service.result(repeated_id) != forecast:
            raise RuntimeError('Prospective replay changed after target observation')
        repeated = output / 'jobs' / 'artifacts' / repeated_id / 'forecast.json'
        if digest(repeated) != prospective.sha256:
            raise RuntimeError('Prospective canonical bytes changed')
        summary = {'kind': 'synthetic_motion_control_integration_replay', 'dynamic_job_id': dynamic_id,
            'control_job_id': control_id, 'forecast_job_id': forecast_id, 'conditional_job_id': conditional_id,
            'forecast_replay_job_id': repeated_id, 'model_id': model_id, 'motion_frames': 9,
            'independent_control_attempts': 3, 'prospective_sha256': prospective.sha256,
            'conditional_kind': conditional['kind'], 'dynamic_budget_per_model': budget,
            'native_forecast_calls': forecast['numeric']['native_calls'],
            'claim': 'Synthetic integration only; no human G6/G7 or calibrated motor/anatomy inference claim',
            'dependence_limit': 'Control points are conditioned on shared fitted anatomy; Cartesian support is not a joint posterior'}
    write_json(output / 'summary.json', summary)
    files = {str(p.relative_to(output)): digest(p) for p in output.rglob('*')
             if p.is_file() and 'jobs' not in p.relative_to(output).parts}
    write_json(output / 'manifest.json', {'kind': 'synthetic_motion_replay_index', 'files': files})
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--budget', type=int, default=20)
    arguments = parser.parse_args()
    print(json.dumps(replay(arguments.output, budget=arguments.budget), indent=2))


if __name__ == '__main__':
    main()
