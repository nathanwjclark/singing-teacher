"""Cross-module acceptance using physical spectra and subprocess job execution."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from singing_physics.service import JobService


@pytest.fixture(scope='module')
def replay_artifacts(tmp_path_factory):
    root = tmp_path_factory.mktemp('scientific-flow') / 'replay'
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'replay_science.py'
    subprocess.run([sys.executable, str(script), str(root), '--budget', '20'],
                   check=True, timeout=120, capture_output=True, text=True, env=os.environ.copy())
    return root


def read(path):
    return json.loads(path.read_text())


def test_real_fit_forecast_replay_preserves_evidence_and_artifacts(replay_artifacts):
    root = replay_artifacts
    summary = read(root / 'summary.json')
    observed = read(root / 'fit-input.json')
    assert [r['id'] for r in observed['observations']] == ['calibration-a', 'calibration-i']
    assert 'anatomy' not in observed and 'trial_articulation' not in observed
    assert all(row['split'] == 'calibration' for row in observed['observations'])
    frozen = read(root / 'frozen-candidates.json')
    assert frozen['evidence_ids'] == summary['fit_calibration_ids']
    assert summary['target_evidence_id'] not in frozen['evidence_ids']
    assert summary['residual_calls'] <= 40
    assert summary['spectrum_calls'] <= 80
    assert frozen['candidates']
    with JobService(root / 'jobs') as service:
        fit = service.result(summary['fit_job_id'])
        forecast = service.result(summary['prediction_job_id'])
        assert forecast == service.result(summary['prediction_replay_job_id'])
        assert fit['joint']['identifiability'] == 'not_established'
        assert forecast['candidate_snapshot_sha256'] == summary['candidate_snapshot_sha256']
        assert forecast['fitting_evidence_ids'] == fit['calibration_ids']
        assert forecast['quantity'] == 'tract_transfer_magnitude_db'
        assert len(forecast['frequency_hz']) == 257
    manifest = read(root / 'replay-manifest.json')
    for filename, digest in manifest['files'].items():
        assert hashlib.sha256((root / filename).read_bytes()).hexdigest() == digest
    assert any((root / 'synthetic-forward').glob('*.wav'))
    assert any((root / 'synthetic-forward').glob('*.svg'))


def test_flow_rejects_unsupported_intervention_and_evidence_leak(replay_artifacts):
    root = replay_artifacts
    summary = read(root / 'summary.json')
    snapshot = (root / 'frozen-candidates.json').read_text()
    parameters = {'snapshot_json': snapshot, 'expected_digest': summary['candidate_snapshot_sha256'],
        'prediction_id': 'error-check', 'target_evidence_id': 'new-heldout',
        'generated_at': '2099-01-01T00:00:00Z', 'intervention': {'kind': 'named_pose', 'pose': 'u'}, 'bins': 512}
    with JobService(root / 'jobs') as service:
        for label, changes in [('unsupported', {'intervention': {'kind': 'nasal_plugging', 'pose': 'u'}}),
                               ('evidence-leak', {'target_evidence_id': 'calibration-a'})]:
            job = service.submit({'operation': 'predict', 'parameters': {**parameters, **changes}},
                                 idempotency_key=label)
            state = service.wait(job, timeout_s=30)
            assert state['status'] == 'failed'
            assert state['error'].startswith('ValueError:')
            with pytest.raises(RuntimeError, match='failed'):
                service.result(job)


def test_flow_detects_mutated_job_artifact(replay_artifacts):
    root = replay_artifacts
    summary = read(root / 'summary.json')
    path = root / 'jobs' / 'artifacts' / summary['prediction_replay_job_id'] / 'forecast.json'
    original = path.read_bytes()
    try:
        path.write_bytes(original + b' ')
        with JobService(root / 'jobs') as service:
            with pytest.raises(RuntimeError, match='integrity'):
                service.result(summary['prediction_replay_job_id'])
    finally:
        path.write_bytes(original)
