from copy import deepcopy
import shutil

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_inverse import extract_pcm
from singing_physics.pcm_search import search_pcm

NODE = shutil.which('node')


def search_fixture(engine):
    """Generating geometry is deliberately absent from the initial search design."""
    anatomy = {'hard_palate_length': 4.43}
    control = {'JA': -2., 'f0_hz': 180., 'gain': .8}
    saved = engine.anatomy()
    try:
        engine.set_anatomy(anatomy)
        pcm = engine.synthesize('a', {'JA': control['JA']}, f0_hz=control['f0_hz'], duration_s=.25)
    finally:
        engine.set_anatomy(saved)
    measurement = extract_pcm(pcm[4410:8506]*control['gain'], 44100, measurement_id='calibration-measurement',
        observation_id='calibration', artifact_id='calibration-pcm', start_ms=100., node_binary=NODE)['measurement']
    doc = {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': [{
        'id': 'calibration', 'pose': 'a', 'measurement': measurement, 'sample_rate_hz': 44100,
        'frame_start_sample': 4410, 'frame_size': 4096, 'duration_s': .25}]}
    profiles = [{'profile_id': 'known-controls', 'trials': {'calibration': control}}]
    return doc, profiles, anatomy


def test_native_adaptive_search_outside_initial_grid_and_exact_budget():
    with Engine() as engine:
        doc, profiles, truth = search_fixture(engine)
        before, controls = deepcopy(doc), deepcopy(profiles)
        saved = engine.anatomy()
        result = search_pcm(engine, doc, anatomy_bounds={'hard_palate_length': [4., 4.8]},
            nuisance_profiles=profiles, max_synthesis_calls=22, rounds=5, seed=17, node_binary=NODE)
        assert doc == before and profiles == controls and engine.anatomy() == saved
        initial = result['history'][0]['proposals']
        assert all(p['anatomy'] != truth for p in initial)
        first_best = min(r['weighted_mean_square_discrepancy'] for r in result['joint']['candidates']
                         if r['search_round'] == 0 and r['status'] == 'scored')
        best = result['joint']['best']
        assert best['weighted_mean_square_discrepancy'] < first_best
        assert abs(best['anatomy']['hard_palate_length']-truth['hard_palate_length']) < .06
        assert result['actual_synthesis_calls'] <= 22
        assert result['joint']['actual_synthesis_calls'] == result['fixed_anatomy_baseline']['actual_synthesis_calls']
        assert sum(b['actual_synthesis_calls'] for h in result['history'] for b in h['batches']) == result['actual_synthesis_calls']
        assert result['baseline_unique_nuisance_synthesis_calls'] == 1
        assert result['baseline_redundant_synthesis_calls'] == result['fixed_anatomy_baseline']['actual_synthesis_calls']-1
        assert result['identifiability'] == 'not_established'
        assert result['canonical_extractor']['extractorVersion'] == '1.1.0'
        assert all(4. <= r['anatomy']['hard_palate_length'] <= 4.8 for r in result['joint']['candidates'])


def test_reproducibility_and_retain_clipped_candidates():
    with Engine() as engine:
        doc, profiles, _ = search_fixture(engine)
        profiles.append({'profile_id': 'clipping-controls', 'trials': {
            'calibration': {**profiles[0]['trials']['calibration'], 'gain': 100.}}})
        kwargs = dict(anatomy_bounds={'hard_palate_length': [4., 4.8]}, nuisance_profiles=profiles,
                      max_synthesis_calls=12, rounds=2, seed=4, node_binary=NODE)
        first = search_pcm(engine, doc, **kwargs)
        second = search_pcm(engine, doc, **kwargs)
        def without_audit_times(value):
            if isinstance(value, dict):
                return {k: without_audit_times(v) for k, v in value.items() if k != 'createdAt'}
            if isinstance(value, list):
                return [without_audit_times(v) for v in value]
            return value
        # Keep actual canonical creation timestamps in production evidence.
        assert without_audit_times(first) == without_audit_times(second)
        assert first['status'] == 'budget_exhausted'
        assert len(first['joint']['candidates']) == 6
        assert any(row['status'] == 'missing_predicted_features' for row in first['joint']['candidates'])
        assert first['actual_synthesis_calls'] == 12
        assert first['baseline_unique_nuisance_synthesis_calls'] == 2


def test_invalid_budget_bounds_lineage_and_partial_native_failure(monkeypatch):
    with Engine() as engine:
        doc, profiles, _ = search_fixture(engine)
        kwargs = dict(anatomy_bounds={'hard_palate_length': [4., 4.8]}, nuisance_profiles=profiles,
                      max_synthesis_calls=10, rounds=2, seed=1, node_binary=NODE)
        for options in ({'max_synthesis_calls': 5}, {'max_synthesis_calls': True}, {'rounds': 0},
                        {'seed': -1}, {'anatomy_bounds': {'lip_width': [1., 1.2]}},
                        {'nuisance_profiles': profiles*2}):
            with pytest.raises(ValueError):
                search_pcm(engine, doc, **{**kwargs, **options})
        contaminated = deepcopy(doc); contaminated['held_out'] = {'target': 'must not read'}
        with pytest.raises(ValueError, match='held-out'):
            search_pcm(engine, contaminated, **kwargs)
        duplicate = deepcopy(doc); duplicate['trials'].append(deepcopy(duplicate['trials'][0]))
        duplicate['trials'][1]['id'] = 'another-trial'
        duplicate['trials'][1]['measurement']['id'] = 'another-measurement'
        double_profiles = deepcopy(profiles)
        double_profiles[0]['trials']['another-trial'] = deepcopy(double_profiles[0]['trials']['calibration'])
        with pytest.raises(ValueError, match='Duplicate source audio interval'):
            search_pcm(engine, duplicate, **{**kwargs, 'max_synthesis_calls': 12, 'nuisance_profiles': double_profiles})
        saved, real_synthesize = engine.anatomy(), engine.synthesize
        calls = 0
        def fail_after_complete_round(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 7:
                raise RuntimeError('Injected native failure after completed initial round')
            return real_synthesize(*args, **kwargs)
        monkeypatch.setattr(engine, 'synthesize', fail_after_complete_round)
        result = search_pcm(engine, doc, **kwargs)
        assert result['status'] == 'execution_failed'
        assert result['actual_synthesis_calls'] == 7
        assert result['unpaired_failure_synthesis_calls'] == 1
        assert result['joint']['best'] is not None
        assert len(result['joint']['candidates']) == 3
        assert result['history'][-1]['batches'][-1]['comparison_complete'] is False
        assert engine.anatomy() == saved


def test_all_unscorable_predictions_are_a_retained_failure_outcome():
    with Engine() as engine:
        doc, profiles, _ = search_fixture(engine)
        profiles[0]['trials']['calibration']['gain'] = 100.
        result = search_pcm(engine, doc, anatomy_bounds={'hard_palate_length': [4., 4.8]},
            nuisance_profiles=profiles, max_synthesis_calls=10, rounds=2, seed=1, node_binary=NODE)
        assert result['status'] == 'no_scorable_candidates'
        assert result['joint']['best'] is None
        assert len(result['joint']['candidates']) == 3
        assert all(r['status'] == 'missing_predicted_features' for r in result['joint']['candidates'])
        assert result['actual_synthesis_calls'] == 6
        assert result['completed_comparison_calls_equal'] is True
