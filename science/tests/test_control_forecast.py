import hashlib

import numpy as np
import pytest

from singing_physics.control import fit_control_profile
from singing_physics.control_forecast import (
    condition_on_execution, freeze_control_profile, predict_control,
)
from singing_physics.engine import Engine
from singing_physics.prediction import Artifact, freeze_candidates

CONTEXT = {'pitch_hz': 160., 'vowel': 'a', 'level': 'comfortable', 'posture': 'seated'}


def attempt(index, jaw, status='successful'):
    return {'attempt_id': f'attempt-{index}', 'evidence_id': f'evidence-{index}',
        'cue_id': 'jaw-cue', 'cue_version': '1', 'context': CONTEXT, 'mode': 'elicited',
        'observed_at': '2026-01-01T00:00:00Z', 'sensor_status': 'valid' if jaw is not None else 'invalid',
        'sensor_reason': None if jaw is not None else 'occluded', 'execution_status': status,
        'JA': jaw, 'measurement_sigma_deg': .05 if jaw is not None else None,
        'operator_id': 'synthetic-vtl-ja', 'comfortable': True, 'source_kind': 'synthetic',
        'uncertainty_scope': 'synthetic_sensor_sd', 'derived_model_id': None}


def profile(values, statuses=None):
    records = [attempt(i, jaw, statuses[i] if statuses else 'successful') for i, jaw in enumerate(values)]
    return freeze_control_profile(fit_control_profile(records, anatomy_model_id='model',
                                  fitted_at='2026-01-01T00:01:00Z'))


@pytest.fixture
def anatomy():
    with Engine() as engine:
        provenance = engine.provenance
    return freeze_candidates(model_id='model', evidence_ids=['anatomy-fit'], provenance=provenance,
        candidates=[{'candidate_id': 'a', 'anatomy': {'hard_palate_length': 4.3}},
                    {'candidate_id': 'b', 'anatomy': {'hard_palate_length': 4.8}}],
        frozen_at='2026-01-01T00:01:00Z')


def forecast(anatomy, control, **kwargs):
    options = dict(expected_anatomy_digest=anatomy.sha256, expected_control_digest=control.sha256,
        prediction_id='prospective', target_evidence_id='target', generated_at='2026-01-01T00:02:00Z',
        cue_id='jaw-cue', cue_version='1', context=CONTEXT, mode='elicited', bins=128)
    options.update(kwargs)
    return predict_control(anatomy, control, **options)


def test_native_bimodal_control_is_marginalized_not_mean_control(anatomy):
    control = profile([-4., -4., -2., -2.])
    broad = forecast(anatomy, control)
    numeric = broad.data['numeric']
    explicit = []
    with Engine() as engine:
        for candidate in anatomy.data['candidates']:
            engine.set_anatomy(candidate['anatomy'])
            for jaw in [-4., -4., -2., -2.]:
                explicit.append(engine.spectrum('a', {'JA': jaw}, bins=128)[1])
    np.testing.assert_allclose(numeric['measured_support_mean_db'], np.mean(explicit, axis=0))
    deterministic = forecast(anatomy, profile([-3., -3., -3., -3.])).data['numeric']
    assert not np.allclose(numeric['measured_support_mean_db'], deterministic['measured_support_mean_db'])
    assert numeric['native_calls'] == 8
    assert broad.content == forecast(anatomy, control).content


def test_failure_missing_and_unknown_mass_are_retained(anatomy):
    control = profile([-4., -2., -3., None], ['successful', 'unsuccessful', 'unknown', 'unknown'])
    numeric = forecast(anatomy, control).data['numeric']
    assert numeric['measured_execution_mass'] == .75
    assert numeric['missing_execution_mass'] == .25
    assert numeric['execution_failure_probability'] == .25
    assert numeric['unknown_execution_probability'] == .5
    assert numeric['full_unconditional_mean_db'] is None
    np.testing.assert_allclose(numeric['known_unconditional_feature_contribution_db'],
                               .75 * np.array(numeric['measured_support_mean_db']))
    assert any(n['execution_status'] == 'unsuccessful' for n in numeric['nodes'])


@pytest.mark.parametrize('changes', [
    {'expected_control_digest': 'stale'}, {'expected_anatomy_digest': 'stale'},
    {'target_evidence_id': 'evidence-0'}, {'target_evidence_id': 'anatomy-fit'},
    {'cue_version': 'other'}, {'mode': 'recalled'}, {'context': {**CONTEXT, 'vowel': 'i'}},
    {'generated_at': '2025-01-01T00:00:00Z'}, {'max_native_calls': 2},
])
def test_invalid_or_unseen_forecasts_rejected(anatomy, changes):
    with pytest.raises(ValueError):
        forecast(anatomy, profile([-4., -3., -2.]), **changes)


def test_empty_invalid_and_stale_profiles(anatomy):
    with pytest.raises(ValueError):
        profile([])
    with pytest.raises(ValueError):
        profile([float('nan'), -3., -2.])
    with pytest.raises(ValueError):
        forecast(anatomy, profile([-3., -2.]))
    with pytest.raises(ValueError):
        forecast(anatomy, profile([999., -3., -2.]))
    data = profile([-4., -3., -2.]).data
    data['anatomy_model_id'] = 'different'
    with pytest.raises(ValueError):
        forecast(anatomy, freeze_control_profile(data))
    data = profile([-4., -3., -2.]).data
    data['attempts'][0]['JA'] = -1.
    with pytest.raises(ValueError, match='hash'):
        forecast(anatomy, freeze_control_profile(data))
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


def test_conditional_output_cannot_overwrite_or_relabel_prospective(anatomy, tmp_path):
    prior = forecast(anatomy, profile([-4., -3., -2.]))
    original = prior.content
    options = dict(expected_prospective_digest=prior.sha256, expected_anatomy_digest=anatomy.sha256,
        prediction_id='conditional', generated_at='2026-01-01T00:04:00Z', observed_at='2026-01-01T00:03:00Z',
        observed_evidence_id='target', measured_ja_deg=-2.5, measurement_sigma_deg=.1)
    conditional = condition_on_execution(prior, anatomy, **options)
    assert conditional.data['kind'] == 'postcapture_measured_execution_transfer_forecast'
    assert conditional.data['prospective_prediction_sha256'] == hashlib.sha256(original).hexdigest()
    assert prior.content == original
    assert conditional.data['numeric']['execution_failure_probability'] is None
    prior.write(tmp_path / 'prediction.json')
    with pytest.raises(FileExistsError):
        conditional.write(tmp_path / 'prediction.json')
    for bad in ({'prediction_id': 'prospective'}, {'observed_evidence_id': 'unrelated'},
                {'observed_at': '2026-01-01T00:01:00Z'}, {'measurement_sigma_deg': -1}):
        with pytest.raises(ValueError):
            condition_on_execution(prior, anatomy, **{**options, **bad})
    with pytest.raises(ValueError):
        condition_on_execution(conditional, anatomy, **{**options, 'expected_prospective_digest': conditional.sha256})


def test_inferred_point_support_does_not_invent_uncertainty(anatomy):
    attempts = [attempt(i, jaw) for i, jaw in enumerate([-4., -3., -2.])]
    for row in attempts:
        row.update(source_kind='inferred_articulation', derived_model_id='model',
                   uncertainty_scope='point_estimate_only', measurement_sigma_deg=None)
    control = freeze_control_profile(fit_control_profile(attempts, anatomy_model_id='model',
                                                        fitted_at='2026-01-01T00:01:00Z'))
    result = forecast(anatomy, control).data
    assert all(n['measurement_sigma_deg'] is None for n in result['numeric']['nodes'])
    assert result['execution_distribution']['estimated_between_attempt_variance_deg2'] is None


@pytest.mark.parametrize('field,value', [
    ('model_id', 'wrong-model'), ('provenance', {'library_sha256': 'different'}),
    ('anatomy_evidence_ids', ['unrelated']), ('anatomy_frozen_at', '2025-01-01T00:00:00Z'),
    ('control_evidence_ids', ['unrelated']), ('control_profile_sha256', 'different'),
    ('control_fitted_at', '2025-01-01T00:00:00Z'), ('cue_id', 'different'),
    ('context', {**CONTEXT, 'vowel': 'i'}), ('target_evidence_id', 'anatomy-fit'),
])
def test_conditional_rejects_rehashed_inconsistent_lineage_before_native(anatomy, field, value):
    import json

    data = forecast(anatomy, profile([-4., -3., -2.])).data
    data[field] = value
    altered = Artifact(json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
    # Holding native ownership proves rejection happens before any new native work.
    with Engine():
        with pytest.raises(ValueError, match='binding|leaks'):
            condition_on_execution(altered, anatomy,
                expected_prospective_digest=altered.sha256, expected_anatomy_digest=anatomy.sha256,
                prediction_id='conditional', generated_at='2026-01-01T00:04:00Z',
                observed_at='2026-01-01T00:03:00Z', observed_evidence_id=data['target_evidence_id'],
                measured_ja_deg=-2.5, measurement_sigma_deg=.1)
