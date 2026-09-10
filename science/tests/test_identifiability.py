from copy import deepcopy

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.identifiability import freeze_hypotheses, rank_interventions


@pytest.fixture
def frozen():
    with Engine() as engine:
        provenance = engine.provenance
    return freeze_hypotheses(model_id='test-model', evidence_ids=['fit-evidence'], provenance=provenance,
        frozen_at='2026-01-01T00:00:00Z', hypotheses=[
            {'hypothesis_id': 'first', 'anatomy': {'hard_palate_length': 4.3}, 'articulation': {'JA': -3.5}},
            {'hypothesis_id': 'second', 'anatomy': {'hard_palate_length': 4.7}, 'articulation': {'JA': -2.5}}])


def rank(frozen, **changes):
    options = dict(expected_digest=frozen.sha256, ranking_id='ranking', target_evidence_id='heldout',
        generated_at='2026-01-01T00:01:00Z', noise_sigma_db=.5, noise_assumption='Test assumed direct-transfer dB SD',
        bins=128, interventions=[{'intervention_id': 'a', 'kind': 'named_pose', 'pose': 'a', 'articulation': {}},
                                {'intervention_id': 'i', 'kind': 'named_pose', 'pose': 'i', 'articulation': {'JA': -3.}}])
    options.update(changes)
    return rank_interventions(frozen, **options)


def test_native_pair_scores_deterministic_lineage_and_noise_scaling(frozen, tmp_path):
    result = rank(frozen)
    assert result.content == rank(frozen).content
    assert result.data['hypothesis_snapshot_sha256'] == frozen.sha256
    assert result.data['native_calls'] == 4
    scores = result.data['rankings']
    assert scores[0]['worst_pair_standardized_rms'] >= scores[1]['worst_pair_standardized_rms']
    for entry in scores:
        first, second = entry['predictions']
        rms = np.sqrt(np.mean((np.array(first['magnitude_db']) - second['magnitude_db']) ** 2))
        assert entry['pairs'][0]['standardized_rms'] == pytest.approx(rms/.5)
    doubled = rank(frozen, noise_sigma_db=1.).data['rankings']
    assert doubled[0]['worst_pair_standardized_rms'] == pytest.approx(scores[0]['worst_pair_standardized_rms']/2)
    result.write(tmp_path / 'ranking.json')
    with pytest.raises(FileExistsError):
        result.write(tmp_path / 'ranking.json')
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


@pytest.mark.parametrize('changes', [
    {'expected_digest': 'stale'}, {'target_evidence_id': 'fit-evidence'}, {'max_native_calls': 3},
    {'noise_sigma_db': 0}, {'noise_sigma_db': float('nan')}, {'separation_threshold': -1},
    {'frequency_band_hz': [1, 2]}, {'frequency_band_hz': [100, 50000]}, {'bins': 13},
    {'generated_at': '2025-01-01T00:00:00Z'}, {'interventions': []},
    {'interventions': [{'intervention_id': 'x', 'kind': 'nasal_occlusion', 'pose': 'a', 'articulation': {}}]},
    {'interventions': [{'intervention_id': 'x', 'kind': 'named_pose', 'pose': 'a', 'articulation': {'unknown': 1}}]},
])
def test_invalid_inputs_and_budget_release_native(frozen, changes):
    with pytest.raises(ValueError):
        rank(frozen, **changes)
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


def test_equivalent_explanations_report_no_separated_pair(frozen):
    data = frozen.data
    data['hypotheses'][1].update(anatomy=deepcopy(data['hypotheses'][0]['anatomy']),
                                articulation=deepcopy(data['hypotheses'][0]['articulation']))
    identical = freeze_hypotheses(**{key: data[key] for key in ('model_id', 'evidence_ids', 'provenance', 'hypotheses', 'frozen_at')})
    result = rank(identical).data
    assert all(row['status'] == 'no_separated_pair_at_threshold' for row in result['rankings'])
    assert all(row['worst_pair_standardized_rms'] == 0 for row in result['rankings'])
