"""Actual local jobs for the active PCM research path and its trust boundaries."""
import json

import pytest

from singing_physics.service import JobService


@pytest.mark.parametrize('operation', ['search_pcm', 'design_pcm', 'update_pcm'])
def test_active_service_rejects_missing_or_executable_parameters(tmp_path, operation):
    with JobService(tmp_path) as service:
        with pytest.raises(ValueError, match='Missing operation parameters'):
            service.submit({'operation': operation, 'parameters': {}}, idempotency_key='missing')
        with pytest.raises(ValueError, match='Unsupported operation parameters'):
            service.submit({'operation': operation, 'parameters': {'node_binary': '/arbitrary/program'}},
                           idempotency_key='program')


def numerical_receipt(value):
    """Keep numerical/source identity comparisons separate from new receipt times."""
    if isinstance(value, dict):
        return {k: numerical_receipt(v) for k, v in value.items()
                if not (k == 'createdAt' and value.get('kind') == 'audio-measurement')}
    if isinstance(value, list):
        return [numerical_receipt(v) for v in value]
    return value


def test_search_job_replay_and_hard_budget(tmp_path):
    from singing_physics.engine import Engine
    from singing_physics.pcm_inverse import extract_pcm
    with Engine() as engine:
        engine.set_anatomy({'hard_palate_length': 4.37})
        audio = engine.synthesize('a', {'JA': -2.}, f0_hz=180., duration_s=.25)
        measurement = extract_pcm(audio[4410:8506] * .8, 44100,
            measurement_id='calibration-measurement', observation_id='calibration',
            artifact_id='calibration-pcm', start_ms=100.)['measurement']
    document = {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': [{
        'id': 'calibration', 'pose': 'a', 'measurement': measurement, 'sample_rate_hz': 44100,
        'frame_start_sample': 4410, 'frame_size': 4096, 'duration_s': .25}]}
    request = {'operation': 'search_pcm', 'parameters': {'observations': document,
        'anatomy_bounds': {'hard_palate_length': [4.1, 4.7]},
        'nuisance_profiles': [{'profile_id': 'known-source', 'trials': {
            'calibration': {'JA': -2., 'f0_hz': 180., 'gain': .8}}}],
        'max_synthesis_calls': 18, 'rounds': 2, 'seed': 7}}
    original = json.dumps(request, sort_keys=True)
    with JobService(tmp_path) as service:
        job = service.submit(request, idempotency_key='search')
        assert service.wait(job)['status'] == 'succeeded', service.status(job)
        result = service.result(job)
        assert 0 < result['actual_synthesis_calls'] <= 18
        assert result['joint']['actual_synthesis_calls'] == result['fixed_anatomy_baseline']['actual_synthesis_calls']
        assert result['joint']['best'] is not None
        replay = service.replay(job, idempotency_key='search-replay')
        assert service.wait(replay)['status'] == 'succeeded', service.status(replay)
        assert numerical_receipt(service.result(replay)) == numerical_receipt(result)
        assert json.dumps(request, sort_keys=True) == original
        invalid = json.loads(original)
        invalid['parameters']['max_synthesis_calls'] = 1
        failed = service.submit(invalid, idempotency_key='search-budget')
        assert service.wait(failed)['status'] == 'failed'
        with pytest.raises(RuntimeError):
            service.result(failed)


def test_design_then_later_pcm_update_jobs_and_model_binding(tmp_path):
    from datetime import datetime, timezone
    import hashlib
    import numpy as np
    from singing_physics.engine import Engine
    from singing_physics.pcm_design import freeze_pcm_hypotheses
    from singing_physics.pcm_inverse import FEATURES
    from singing_physics.prediction import Artifact
    def now():
        return datetime.now(timezone.utc).isoformat()
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id='active-model', evidence_ids=['earlier-calibration'],
        evidence_hashes=[hashlib.sha256(b'earlier calibration source').hexdigest()],
        provenance=provenance, frozen_at=now(), hypotheses=[
            {'hypothesis_id': 'short', 'anatomy': {'hard_palate_length': 3.8}},
            {'hypothesis_id': 'long', 'anatomy': {'hard_palate_length': 5.1}}])
    request = {'operation': 'design_pcm', 'session_id': 'session', 'model_id': 'active-model',
        'parameters': {'snapshot_json': snapshot.content.decode(), 'expected_digest': snapshot.sha256,
            'design_id': 'prospective-design', 'target_observation_id': 'later-observation',
            'generated_at': now(), 'experiments': [{'experiment_id': 'a', 'pose': 'a',
                'JA': -2., 'f0_hz': 180., 'gain': .8}],
            'feature_scales': {name: {'unit': unit, 'scale': scale, 'assumption': 'Software test engineering scale'}
                for name, (unit, scale) in FEATURES.items()},
            'minimum_separation': .00001, 'max_synthesis_calls': 2}}
    with JobService(tmp_path) as service:
        service.register_model('session', 'active-model')
        design_job = service.submit(request, idempotency_key='design')
        assert service.wait(design_job)['status'] == 'succeeded', service.status(design_job)
        design_data = service.result(design_job)
        design_path = tmp_path / 'artifacts' / design_job / 'design.json'
        design = Artifact(design_path.read_bytes())
        assert design.data == design_data
        assert design_data['actual_synthesis_calls'] == 2
        assert design_data['selected_experiment_id'] == 'a'
        # Acquire only after the service has sealed and persisted its design.
        with Engine() as engine:
            engine.set_anatomy({'hard_palate_length': 3.8})
            pcm = engine.synthesize('a', {'JA': -2.}, f0_hz=180., duration_s=.25)[4410:8506] * .8
        update_request = {'operation': 'update_pcm', 'session_id': 'session', 'model_id': 'active-model',
            'parameters': {'snapshot_json': snapshot.content.decode(), 'design_json': design.content.decode(),
                'expected_snapshot_digest': snapshot.sha256, 'expected_design_digest': design.sha256,
                'experiment_id': 'a', 'observation_id': 'later-observation', 'artifact_id': 'later-pcm',
                'observed_at': now(), 'pcm': np.asarray(pcm, dtype=np.float32).tolist(),
                'source_kind': 'engine-generated'}}
        update_job = service.submit(update_request, idempotency_key='update')
        assert service.wait(update_job)['status'] == 'succeeded', service.status(update_job)
        updated = service.result(update_job)
        assert updated['status'] == 'conditional_support_updated'
        assert updated['scores'][0]['hypothesis_id'] == 'short'
        assert updated['scores'][0]['standardized_rms'] < 1e-8
        assert 'later-observation' in updated['updated_snapshot']['evidence_ids']
        assert updated['updated_snapshot']['model_id'] != 'active-model'
        assert design_path.read_bytes() == design.content
        bad = json.loads(json.dumps(update_request))
        bad['parameters']['observed_at'] = snapshot.data['frozen_at']
        failed = service.submit(bad, idempotency_key='early-observation')
        assert service.wait(failed)['status'] == 'failed'
        assert 'Observation' in service.status(failed)['error']
        bad['model_id'] = 'other-model'
        with pytest.raises(ValueError, match='match job model'):
            service.submit(bad, idempotency_key='wrong-model')
        service.register_model('session', updated['updated_snapshot']['model_id'])
        with pytest.raises(ValueError, match='stale_model'):
            service.result(design_job)
