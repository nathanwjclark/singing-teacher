#!/usr/bin/env python3
"""Run a genuine, explicitly synthetic fit-to-frozen-forecast integration replay."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from singing_physics.engine import Engine, digest, write_json
from singing_physics.joint import KIND
from singing_physics.prediction import freeze_candidates
from singing_physics.service import JobService


def now():
    return datetime.now(timezone.utc).isoformat()


def complete(service, request, key):
    job = service.submit(request, idempotency_key=key)
    state = service.wait(job, timeout_s=120)
    if state['status'] != 'succeeded':
        raise RuntimeError(f"Scientific replay job {job}: {state}")
    return job, service.result(job)


def replay(output, *, budget=20):
    if type(budget) is not int or not 10 <= budget <= 10000:
        raise ValueError("budget must be an integer between 10 and 10000")
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    # Ground truth is retained separately for audit and never supplied to fitting.
    truth = {'hard_palate_length': 4.42, 'pharynx_length': 6.83}
    trial_controls = {'calibration-a': -2.5, 'calibration-i': -3.5, 'heldout-u': -3.0}
    with Engine() as engine:
        write_json(output / 'capabilities.json', engine.capabilities())
        engine.set_anatomy(truth)
        rows = []
        for identity, pose in [('calibration-a', 'a'), ('calibration-i', 'i'), ('heldout-u', 'u')]:
            frequency, magnitude, _ = engine.spectrum(pose, {'JA': trial_controls[identity]}, bins=512)
            mask = (frequency >= 100) & (frequency <= 6000)
            rows.append({'id': identity, 'pose': pose, 'split': 'held_out' if identity == 'heldout-u' else 'calibration',
                         'frequency_hz': frequency[mask].tolist(), 'magnitude_db': magnitude[mask].tolist()})
        provenance, sample_rate = engine.provenance, engine.sample_rate
        engine.export(output / 'synthetic-forward', pose='a', anatomy=truth,
                      articulation={'JA': trial_controls['calibration-a']}, duration_s=.1)
    write_json(output / 'generation-truth.json', {'kind': 'synthetic_generation_truth_not_fit_input',
                                                 'anatomy': truth, 'trial_articulation': trial_controls})
    write_json(output / 'heldout-observation.json', rows[-1])
    observations = {'schema_version': '0.1.0', 'kind': KIND, 'provenance': provenance,
                    'sample_rate_hz': sample_rate, 'spectrum_bins': 512, 'observations': rows[:2]}
    write_json(output / 'fit-input.json', observations)
    session_id, model_id = 'synthetic-replay-session', 'synthetic-replay-model'
    with JobService(output / 'jobs', timeout_s=120) as service:
        service.register_model(session_id, model_id)
        fit_request = {'operation': 'fit_joint', 'session_id': session_id, 'model_id': model_id,
                       'parameters': {'observations': observations, 'budget_per_model': budget, 'starts': 2, 'seed': 7}}
        fit_id, fitted = complete(service, fit_request, 'fit')
        candidates = [{'candidate_id': f"fit-start-{c['start']}", 'anatomy': c['anatomy']}
                      for c in fitted['joint']['candidates']]
        frozen = freeze_candidates(model_id=model_id, evidence_ids=fitted['calibration_ids'],
            provenance=fitted['provenance'], candidates=candidates, frozen_at=now())
        frozen.write(output / 'frozen-candidates.json')
        forecast_request = {'operation': 'predict', 'session_id': session_id, 'model_id': model_id,
            'parameters': {'snapshot_json': frozen.content.decode(), 'expected_digest': frozen.sha256,
                'prediction_id': 'synthetic-replay-prediction', 'target_evidence_id': 'heldout-u',
                'generated_at': now(), 'intervention': {'kind': 'named_pose', 'pose': 'u', 'articulation': {'JA': -3.0}},
                'bins': 512}}
        prediction_id, forecast = complete(service, forecast_request, 'prediction')
        replay_id = service.replay(prediction_id, idempotency_key='prediction-replay')
        if service.wait(replay_id, timeout_s=120)['status'] != 'succeeded':
            raise RuntimeError('Forecast replay failed')
        if service.result(replay_id) != forecast:
            raise RuntimeError('Forecast replay changed numerical or identity content')
        forecast_path = output / 'jobs' / 'artifacts' / prediction_id / 'forecast.json'
        repeated_path = output / 'jobs' / 'artifacts' / replay_id / 'forecast.json'
        if digest(forecast_path) != digest(repeated_path):
            raise RuntimeError('Forecast replay changed immutable artifact bytes')
        summary = {'schema_version': 'science-replay-0.1', 'kind': 'synthetic_integration_replay',
            'fit_job_id': fit_id, 'prediction_job_id': prediction_id, 'prediction_replay_job_id': replay_id,
            'model_id': model_id, 'session_id': session_id, 'candidate_snapshot_sha256': frozen.sha256,
            'prediction_sha256': digest(forecast_path), 'fit_calibration_ids': fitted['calibration_ids'],
            'target_evidence_id': forecast['target_evidence_id'], 'budget_per_model': budget,
            'residual_calls': fitted['residual_calls'], 'spectrum_calls': fitted['spectrum_calls'],
            'claim': 'Integration replay only; anatomy recovery and human validity are not established',
            'prospective_status': 'retrospective synthetic replay; not a commit-before-human-capture experiment'}
    write_json(output / 'summary.json', summary)
    files = {str(p.relative_to(output)): digest(p) for p in output.rglob('*')
             if p.is_file() and 'jobs' not in p.relative_to(output).parts}
    write_json(output / 'replay-manifest.json', {'kind': 'synthetic_replay_artifact_index', 'files': files,
        'job_artifacts': 'jobs/artifacts', 'summary_sha256': digest(output / 'summary.json')})
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New output directory; existing paths are refused')
    parser.add_argument('--budget', type=int, default=20, help='Residual calls per model, minimum 10')
    arguments = parser.parse_args()
    print(json.dumps(replay(arguments.output, budget=arguments.budget), indent=2))


if __name__ == '__main__':
    main()
