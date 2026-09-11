"""Protocol-integrity checks; the native comparison runs once through run.py, not per test."""
import importlib.util
import json
from pathlib import Path

import pytest

from singing_physics.phonation import _controls, _source_shape

spec = importlib.util.spec_from_file_location('wave3_source_run', Path(__file__).with_name('run.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
P = json.loads(m.PROTOCOL_PATH.read_text())
F0 = {t['id']: t['requested_f0_hz'] for t in P['calibration_trials']}


def test_equal_family_budgets_fit_the_production_caps():
    grid = m.candidates(P, F0)
    assert len(grid) == 12 and [m.family_of(c['candidate_id']) for c in grid].count('two_mass') == 6
    fit_calls, bank_calls = 3*len(grid)*len(P['calibration_trials']), 3*len(grid)
    b = P['budgets']
    assert fit_calls == b['fit_max_synthesis_calls'] == 72 <= 96 and bank_calls == b['bank_max_synthesis_calls'] == 36 <= 48
    assert b['per_family_fit_calls'] == fit_calls//2 and b['per_family_bank_alternatives'] == bank_calls//2
    per_generator = fit_calls+len(P['heldout_trials'])*bank_calls+b['generator_calls_per_generator']
    assert b['generator_calls_per_generator'] == len(P['calibration_trials'])+len(P['heldout_trials'])
    assert b['hard_total_native_calls'] == len(P['generators'])*per_generator == 592
    for c in grid:
        shapes = {json.dumps(_source_shape(_controls(t)), sort_keys=True) for t in c['trials'].values()}
        assert len(shapes) == 1 and set(c['trials']) == set(F0)


def test_generators_are_off_grid_with_declared_nearest_candidates():
    t0, t1 = P['tract_options']
    for g in P['generators']:
        assert g['shape'] not in P['families'][g['family']] and g['anatomy'] not in P['tract_options']
        assert g['anatomy'] == {k: pytest.approx(t0[k]+g['anatomy_fraction']*(t1[k]-t0[k])) for k in t0}
        assert m.nearest(P, g) == g['nearest_grid']
        _controls({'JA': -3., 'F0': 190., 'PR': 8500., 'gain': 2., **g['shape']})
    assert sorted(g['family'] for g in P['generators']) == ['geometric', 'geometric', 'two_mass', 'two_mass']


def test_heldout_conditions_are_unseen_in_calibration():
    calibration, heldout = P['calibration_trials'], P['heldout_trials']
    assert not {t['pose'] for t in calibration} & {h['pose'] for h in heldout}
    assert all(h['F0'] not in F0.values() and h['PR'] not in {t['PR'] for t in calibration} for h in heldout)


def fit_rows(scores):
    return {'joint': {'candidates': [{'candidate_id': c, 'status': 'scored' if s is not None else 'unscorable', 'score': s, 'score_excluding_pitch': s if s is None else s/2}
                                     for c, s in scores.items()]}}


def score_rows(scores):
    return {'alternatives': [{'family': 'joint', 'candidate_id': c, 'score': s, 'score_excluding_pitch': s if s is None else s/2} for c, s in scores.items()]}


def test_selection_ranks_and_failures_follow_the_frozen_rules():
    generator = P['generators'][2]
    fit = fit_rows({'t0-geometric-0': .2, 't1-geometric-1': .1, 't0-two_mass-0': .3, 't1-two_mass-1': None})
    score = score_rows({'t0-geometric-0': .01, 't1-geometric-1': .5, 't0-two_mass-0': .2, 't1-two_mass-1': .05})
    metrics = m.case_metrics(P, generator, fit, score)
    primary = metrics['primary']
    assert primary['selected'] == {'geometric': 't1-geometric-1', 'two_mass': 't0-two_mass-0'}
    assert primary['heldout_discrepancy'] == {'geometric': .5, 'two_mass': .2} and primary['winner'] == 'two_mass'
    assert primary['difference_two_mass_minus_geometric'] == pytest.approx(-.3)
    assert primary['joint_ranking'] == ['t0-geometric-0', 't1-two_mass-1', 't0-two_mass-0', 't1-geometric-1']
    assert primary['true_family_rank'] == 2 and primary['nearest_grid_rank'] == 3
    unscorable = m.case_metrics(P, generator, fit, score_rows({'t1-geometric-1': .5, 't0-two_mass-0': None}))
    assert unscorable['primary']['failures'] == {'geometric': False, 'two_mass': True} and unscorable['primary']['winner'] == 'geometric'
    assert unscorable['unscorable_alternatives'] == {'geometric': 0, 'two_mass': 1}
    missing = m.case_metrics(P, generator, None, None)
    assert missing['primary']['winner'] == 'none' and missing['unscorable_alternatives'] == {'geometric': 6, 'two_mass': 6}


def test_decision_needs_six_wins_under_both_scores_and_counts_failures():
    assert m.winner({'geometric': 1., 'two_mass': .96}, P['tie_margin']) == 'tie'
    assert m.winner({'geometric': 1., 'two_mass': .9}, P['tie_margin']) == 'two_mass'
    case = lambda primary, pitchless, failed=(): {'primary': {'winner': primary, 'failures': {f: f in failed for f in m.FAMILIES}}, 'pitch_excluded': {'winner': pitchless}}
    assert m.decide([case('two_mass', 'two_mass')]*6+[case('tie', 'tie')]*2)['outcome'] == 'positive'
    assert m.decide([case('two_mass', 'two_mass')]*6+[case('geometric', 'geometric', ('two_mass',))]*2)['outcome'] == 'inconclusive'
    assert m.decide([case('two_mass', 'geometric')]*8)['outcome'] == 'inconclusive'
    assert m.decide([case('geometric', 'geometric')]*6+[case('two_mass', 'two_mass')]*2)['outcome'] == 'negative'
