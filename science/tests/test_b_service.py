"""Exercise real process jobs at the newly connected scientific boundaries."""
import json

import pytest

from singing_physics.engine import Engine
from singing_physics.frozen_control import KIND
from singing_physics.identifiability import freeze_hypotheses
from singing_physics.prediction import freeze_candidates
from singing_physics.service import JobService


def frozen_request():
    with Engine() as engine:
        snapshot = freeze_candidates(model_id='frozen-model', evidence_ids=['prior-training'],
            provenance=engine.provenance, frozen_at='2026-01-01T00:00:00Z',
            candidates=[{'candidate_id': 'fixed', 'anatomy': engine.anatomy()}])
        frames = []
        for index, ja in enumerate((-2.5, -3.5, -2.5)):
            hz, db, _ = engine.spectrum('a', {'JA': ja}, bins=512)
            mask = (hz >= 100) & (hz <= 6000)
            frames.append({'id': f'frame-{index}', 'audio_evidence_id': f'audio-{index}',
                'timestamp_seconds': 1. + index * .05, 'timebase_id': 'recording-clock',
                'sync_uncertainty_seconds': .001, 'pose': 'a',
                'frequency_hz': hz[mask].tolist(), 'magnitude_db': db[mask].tolist(),
                'visibility': 'missing', 'geometry_status': 'missing', 'geometry_reason': 'not_captured'})
        document = {'kind': KIND, 'schema_version': '0.1.0', 'provenance': engine.provenance,
            'sample_rate_hz': engine.sample_rate, 'spectrum_bins': 512, 'attempts': [{
                'attempt_id': 'attempt', 'cue_id': 'synthetic-sequence', 'cue_version': '1',
                'context_id': 'a-context', 'context': {'vowel': 'a'}, 'split': 'calibration',
                'execution_status': 'unsuccessful', 'observed_at': '2026-01-01T00:01:00Z',
                'cue_delivered_seconds': .9, 'frames': frames}]}
    return {'operation': 'fit_frozen_control', 'session_id': 'session', 'model_id': 'frozen-model',
        'parameters': {'snapshot_json': snapshot.content.decode(), 'expected_digest': snapshot.sha256,
                       'candidate_id': 'fixed', 'observations': document, 'budget': 180}}


def test_real_frozen_control_job_replay_binding_and_failure(tmp_path):
    request = frozen_request()
    original = json.dumps(request, sort_keys=True)
    with JobService(tmp_path) as service:
        service.register_model('session', 'frozen-model')
        job = service.submit(request, idempotency_key='control')
        assert service.wait(job)['status'] == 'succeeded'
        result = service.result(job)
        assert result['anatomy_optimized'] is False
        assert result['attempts'][0]['execution_status'] == 'unsuccessful'
        assert result['forward_evaluations'] <= 180
        states = [frame['state'] for frame in result['attempts'][0]['frames']]
        assert [state['JA'] for state in states] == pytest.approx([-2.5, -3.5, -2.5], abs=.02)
        assert all(state['derived_model_id'] == 'frozen-model' for state in states)
        replay = service.replay(job, idempotency_key='control-replay')
        assert service.wait(replay)['status'] == 'succeeded'
        assert service.result(replay) == result
        assert json.dumps(request, sort_keys=True) == original
        malformed = json.loads(original)
        malformed['parameters']['expected_digest'] = 'wrong'
        failed = service.submit(malformed, idempotency_key='bad-digest')
        assert service.wait(failed)['status'] == 'failed'
        with pytest.raises(RuntimeError):
            service.result(failed)
        service.register_model('session', 'next-model')
        with pytest.raises(ValueError, match='stale_model'):
            service.result(job)


def test_real_ranking_job_keeps_canonical_artifact(tmp_path):
    with Engine() as engine:
        snapshot = freeze_hypotheses(model_id='model', evidence_ids=['training'],
            provenance=engine.provenance, frozen_at='2026-01-01T00:00:00Z', hypotheses=[
                {'hypothesis_id': 'h1', 'anatomy': {'hard_palate_length': 4.3}, 'articulation': {'JA': -3.}},
                {'hypothesis_id': 'h2', 'anatomy': {'hard_palate_length': 4.5}, 'articulation': {'JA': -3.}}])
    request = {'operation': 'rank_interventions', 'session_id': 'session', 'model_id': 'model',
        'parameters': {'snapshot_json': snapshot.content.decode(), 'expected_digest': snapshot.sha256,
            'ranking_id': 'rank', 'target_evidence_id': 'future', 'generated_at': '2026-01-01T00:01:00Z',
            'interventions': [{'intervention_id': 'u', 'kind': 'named_pose', 'pose': 'u', 'articulation': {}}],
            'noise_sigma_db': 1., 'noise_assumption': 'synthetic declared scale', 'max_native_calls': 2}}
    with JobService(tmp_path) as service:
        service.register_model('session', 'model')
        job = service.submit(request, idempotency_key='ranking')
        assert service.wait(job)['status'] == 'succeeded'
        result = service.result(job)
        assert result['native_calls'] == 2
        artifact = tmp_path / 'artifacts' / job / 'ranking.json'
        before = artifact.read_bytes()
        replay = service.replay(job, idempotency_key='rank-replay')
        assert service.wait(replay)['status'] == 'succeeded'
        assert service.result(replay) == result
        assert (tmp_path / 'artifacts' / replay / 'ranking.json').read_bytes() == before
        artifact.write_bytes(b'{}')
        with pytest.raises(RuntimeError, match='integrity'):
            service.result(job)


def test_real_pcm_job_uses_canonical_extractor_and_equal_baseline(tmp_path):
    from test_pcm_inverse import fixture
    with Engine() as engine:
        document, candidates = fixture(engine)
    request = {'operation': 'fit_pcm', 'parameters': {
        'observations': document, 'candidates': candidates, 'max_synthesis_calls': 12}}
    with JobService(tmp_path) as service:
        job = service.submit(request, idempotency_key='pcm')
        assert service.wait(job)['status'] == 'succeeded'
        result = service.result(job)
        assert result['actual_synthesis_calls'] == 12
        assert result['canonical_extractor']['extractorVersion'] == '1.1.0'
        assert result['joint']['best']['candidate_id'] == 'candidate-1'
        assert result['joint']['best']['weighted_mean_square_discrepancy'] < 1e-10
        assert result['joint']['actual_synthesis_calls'] == result['fixed_anatomy_baseline']['actual_synthesis_calls']
        replay = service.replay(job, idempotency_key='pcm-replay')
        assert service.wait(replay)['status'] == 'succeeded'
        def numeric_receipt(value):
            # B's unchanged serializer records the actual extraction wall clock.
            # Replay must reproduce all quantities, PCM hashes and model lineage;
            # each new extraction keeps its own honest creation timestamp.
            if isinstance(value, dict):
                return {k: numeric_receipt(v) for k, v in value.items()
                        if not (k == 'createdAt' and value.get('kind') == 'audio-measurement')}
            if isinstance(value, list):
                return [numeric_receipt(v) for v in value]
            return value
        assert numeric_receipt(service.result(replay)) == numeric_receipt(result)
        invalid = json.loads(json.dumps(request))
        invalid['parameters']['max_synthesis_calls'] = 11
        failed = service.submit(invalid, idempotency_key='budget-failure')
        assert service.wait(failed)['status'] == 'failed'
        assert 'budget' in service.status(failed)['error']
        with pytest.raises(ValueError, match='Unsupported operation parameters'):
            service.submit({'operation': 'fit_pcm', 'parameters': {
                **request['parameters'], 'node_binary': '/arbitrary/program'}}, idempotency_key='executable-path')
