"""Native dynamic-to-motor-to-forecast integration across isolated service jobs."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from singing_physics.service import JobService


def read(path):
    return json.loads(path.read_text())


@pytest.fixture(scope='module')
def artifacts(tmp_path_factory):
    root = tmp_path_factory.mktemp('motion-control-flow') / 'replay'
    script = Path(__file__).resolve().parents[1] / 'scripts' / 'replay_motion_control.py'
    result = subprocess.run([sys.executable, str(script), str(root), '--budget', '10'],
                            text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr
    return root


def test_dynamic_motion_to_three_independent_inferred_attempts(artifacts):
    root = artifacts
    summary = read(root / 'summary.json')
    document = read(root / 'dynamic-input.json')
    controls = read(root / 'control-attempts.json')
    assert len(document['attempts']) == len(controls) == 3
    assert sum(len(a['frames']) for a in document['attempts']) == 9
    assert len(list((root / 'depth').glob('*.npz'))) == 9
    assert 'anatomy' not in document
    for index, attempt in enumerate(document['attempts']):
        assert [f['pose'] for f in attempt['frames']] == ['a', 'i', 'a']
        assert controls[index]['evidence_id'] == attempt['frames'][2]['id']
        assert controls[index]['JA'] is not None
        assert controls[index]['source_kind'] == 'inferred_articulation'
        assert controls[index]['measurement_sigma_deg'] is None
        assert controls[index]['derived_model_id'] == summary['model_id']
        for frame in attempt['frames']:
            depth = np.load(root / 'depth' / f"{frame['id']}.npz")
            expected = .5 / depth['intrinsics'][0, 0]
            assert frame['geometry_observation']['value_m'] == pytest.approx(expected)
    assert {c['execution_status'] for c in controls} == {'successful', 'unsuccessful', 'unknown'}
    with JobService(root / 'jobs') as service:
        fitted = service.result(summary['dynamic_job_id'])
        assert fitted['joint_fit']['visible_geometry_measurement_count'] == 9
        assert fitted['joint_fit']['residual_calls'] <= 20
        assert fitted['physiological_limits_established'] is False
        motor = service.result(summary['control_job_id'])
        assert len(motor['attempts']) == 3
        assert motor['anatomy_model_id'] == summary['model_id']


def test_control_forecast_then_target_then_separate_conditional(artifacts):
    root = artifacts
    summary = read(root / 'summary.json')
    original = (root / 'prospective.json').read_bytes()
    prospective = json.loads(original)
    measurement = read(root / 'target-measurement.json')
    assert datetime.fromisoformat(measurement['observed_at']) >= datetime.fromisoformat(prospective['generated_at'])
    assert measurement['evidence_id'] not in prospective['control_evidence_ids']
    assert measurement['evidence_id'] not in prospective['anatomy_evidence_ids']
    distribution = prospective['execution_distribution']
    assert distribution['sample_count'] == 3
    assert distribution['estimated_between_attempt_variance_deg2'] is None
    assert len(distribution['samples']) == 3
    assert prospective['numeric']['execution_failure_probability'] == pytest.approx(1 / 3)
    assert prospective['numeric']['unknown_execution_probability'] == pytest.approx(1 / 3)
    with JobService(root / 'jobs') as service:
        conditional = service.result(summary['conditional_job_id'])
        replay = service.result(summary['forecast_replay_job_id'])
        assert replay == prospective
        assert conditional['kind'] == 'postcapture_measured_execution_transfer_forecast'
        assert conditional['prospective_prediction_sha256'] == summary['prospective_sha256']
        assert conditional['prediction_id'] != prospective['prediction_id']
    assert (root / 'prospective.json').read_bytes() == original
    assert hashlib.sha256(original).hexdigest() == summary['prospective_sha256']
    for filename, expected in read(root / 'manifest.json')['files'].items():
        assert hashlib.sha256((root / filename).read_bytes()).hexdigest() == expected
