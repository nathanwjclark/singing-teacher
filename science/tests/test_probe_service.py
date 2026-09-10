"""Actual spawned probe operations, artifact integrity and prospective lineage."""
from datetime import datetime, timezone
import hashlib
import json

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.service import JobService


def now():
    return datetime.now(timezone.utc).isoformat()


@pytest.mark.parametrize('operation', ['predict_probe', 'fit_probe_pcm'])
def test_probe_job_parameter_boundaries(tmp_path, operation):
    with JobService(tmp_path) as service:
        with pytest.raises(ValueError, match='Missing operation parameters'):
            service.submit({'operation': operation, 'parameters': {}}, idempotency_key='missing')
        with pytest.raises(ValueError, match='Unsupported operation parameters'):
            service.submit({'operation': operation, 'parameters': {'node_binary': '/arbitrary/program'}},
                idempotency_key='program')


def test_external_probe_forecast_is_real_bound_and_immutable(tmp_path):
    from test_acoustic_probe import setup_probe
    from singing_physics.acoustic_probe import predict_external_probe
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id='probe-model', evidence_ids=['prior-singing'],
        evidence_hashes=[hashlib.sha256(b'prior singing bytes').hexdigest()],
        provenance=provenance, hypotheses=[
            {'hypothesis_id': 'short', 'anatomy': {'hard_palate_length': 4.1}},
            {'hypothesis_id': 'long', 'anatomy': {'hard_palate_length': 4.7}}], frozen_at=now())
    setup = setup_probe()
    request = {'operation': 'predict_probe', 'session_id': 'probe-session', 'model_id': 'probe-model',
        'parameters': {'snapshot_json': snapshot.content.decode(), 'expected_digest': snapshot.sha256,
            'prediction_id': 'external-prediction', 'target_evidence_id': 'future-probe',
            'generated_at': now(), **setup, 'calibration_evidence_ids': ['independent-instrument-reference'],
            'calibration_frozen_at': snapshot.data['frozen_at'], 'max_operator_calls': 2}}
    with JobService(tmp_path) as service:
        service.register_model('probe-session', 'probe-model')
        job = service.submit(request, idempotency_key='probe-prediction')
        assert service.wait(job)['status'] == 'succeeded', service.status(job)
        result = service.result(job)
        assert result['actual_operator_calls'] == 2
        assert not result['common_valid_mask'][-1]
        artifact = tmp_path / 'artifacts' / job / 'forecast.json'
        before = artifact.read_bytes()
        # Separate target computation occurs after the forecast is persisted.
        with Engine() as engine:
            engine.set_anatomy({'hard_palate_length': 4.1})
            later = predict_external_probe(engine, **setup)
        row = next(p for p in result['predictions'] if p['hypothesis_id'] == 'short')
        assert row['operator_prediction']['response_real'] == later['response_real']
        assert row['operator_prediction']['response_imag'] == later['response_imag']
        assert artifact.read_bytes() == before
        invalid = json.loads(json.dumps(request))
        invalid['parameters']['target_evidence_id'] = 'prior-singing'
        failed = service.submit(invalid, idempotency_key='leaking-target')
        assert service.wait(failed)['status'] == 'failed'
        with pytest.raises(RuntimeError):
            service.result(failed)
        artifact.write_bytes(b'{}')
        with pytest.raises(RuntimeError, match='integrity'):
            service.result(job)


def test_joint_probe_job_cli_includes_actual_probe_term_and_rejects_overwrite(tmp_path):
    import os
    from pathlib import Path
    import stat
    import subprocess
    import sys
    from test_probe_inverse import probe_fixture
    with Engine() as engine:
        pcm, probes, candidates = probe_fixture(engine)
    request = {'operation': 'fit_probe_pcm', 'parameters': {'observations': pcm,
        'probe_observations': probes, 'candidates': candidates, 'max_native_calls': 12}}
    request_path = tmp_path / 'request.json'
    request_path.write_text(json.dumps(request))
    output = tmp_path / 'fit'
    command = [sys.executable, '-m', 'singing_physics.cli', 'job', str(request_path), '--output', str(output)]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=60, env=os.environ)
    assert completed.returncode == 0, completed.stderr
    receipt = json.loads(completed.stdout)
    result = json.loads(Path(receipt['result_path']).read_text())
    assert result['status'] == 'joint_probe_evidence_used'
    assert result['actual_operator_calls'] == 12
    assert result['equal_actual_comparison_calls']
    assert result['probe_records'][0]['included_in_fit']
    assert result['joint']['best']['candidate_id'] == '4.2'
    assert result['joint']['candidates'][1]['probe_discrepancy'] > 0
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    before = (output / 'job.json').read_bytes()
    repeated = subprocess.run(command, capture_output=True, text=True, timeout=60, env=os.environ)
    assert repeated.returncode != 0 and 'overwrite' in repeated.stderr
    assert (output / 'job.json').read_bytes() == before
