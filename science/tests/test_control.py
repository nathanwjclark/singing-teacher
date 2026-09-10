from copy import deepcopy
import numpy as np
import pytest
from singing_physics.control import fit_control_profile, execution_distribution

CONTEXT = {'pitch_hz': 160., 'vowel': 'a', 'level': 'comfortable', 'posture': 'seated'}
FREEZE = '2026-01-02T00:00:00Z'


def attempt(index, ja=-3., **changes):
    return {'attempt_id': f'attempt-{index}', 'evidence_id': f'evidence-{index}',
            'cue_id': 'comfortable-opening', 'cue_version': '1', 'context': dict(CONTEXT),
            'mode': 'elicited', 'observed_at': '2026-01-01T00:00:00Z',
            'sensor_status': 'valid', 'sensor_reason': None, 'execution_status': 'successful',
            'JA': ja, 'measurement_sigma_deg': .2, 'operator_id': 'synthetic-ja-v1',
            'comfortable': True, 'source_kind': 'synthetic', 'uncertainty_scope': 'independent_additive_error',
            'derived_model_id': None, **changes}


def fit(records):
    return fit_control_profile(records, anatomy_model_id='stable-anatomy-1', fitted_at=FREEZE)


def distribution(profile, **changes):
    return execution_distribution(profile, **{'cue_id': 'comfortable-opening', 'cue_version': '1',
        'context': CONTEXT, 'mode': 'elicited', **changes})


def test_known_control_variability_and_noise_are_separate():
    rng = np.random.default_rng(24)
    latent = rng.normal(-4, .8, 2500)
    observed = latent + rng.normal(0, .6, len(latent))
    result = distribution(fit([attempt(i, float(ja), measurement_sigma_deg=.6) for i, ja in enumerate(observed)]))
    assert result['mean_JA_deg'] == pytest.approx(-4, abs=.06)
    assert result['estimated_between_attempt_variance_deg2'] == pytest.approx(.8**2, abs=.09)
    assert result['mean_measurement_variance_deg2'] == pytest.approx(.36)
    assert sum(x['weight'] for x in result['samples']) == pytest.approx(1)
    assert result['anatomy_updates'] == {}


def test_measured_failure_missing_occlusion_and_contexts_are_retained():
    records = [attempt(0, -5), attempt(1, 0, execution_status='unsuccessful'), attempt(2, -4),
               attempt(3, None, sensor_status='invalid', sensor_reason='occluded',
                       measurement_sigma_deg=None, execution_status='unknown'),
               attempt(4, -1, mode='recalled'), attempt(5, -2, mode='transfer')]
    profile = fit(records)
    result = distribution(profile)
    assert result['sample_count'] == 4
    assert result['missing_execution_mass'] == .25
    assert result['execution_failure_probability'] == .25
    assert result['sensor_invalid_fraction'] == .25
    assert [x['JA'] for x in result['samples']] == [-5, 0, -4]
    assert sum(x['weight'] for x in result['samples']) == .75
    assert distribution(profile, mode='recalled')['status'] == 'insufficient_data'
    assert distribution(profile, mode='transfer')['status'] == 'insufficient_data'
    assert distribution(profile, cue_version='2')['status'] == 'unsupported_context'
    for key, value in [('pitch_hz', 200.), ('vowel', 'i'), ('level', 'soft'), ('posture', 'standing')]:
        assert distribution(profile, context={**CONTEXT, key: value})['status'] == 'unsupported_context'


def test_inferred_dispersion_is_not_calibrated_motor_variance():
    profile = fit([attempt(i, -i, source_kind='inferred_articulation',
                          uncertainty_scope='conditional_on_model', derived_model_id='fit-1') for i in range(3)])
    result = distribution(profile)
    assert result['estimated_between_attempt_variance_deg2'] is None
    assert result['mean_measurement_variance_deg2'] is None
    assert result['variance_resolution'] == 'unidentified_for_inferred_articulation'
    assert all(s['source_kind'] == 'inferred_articulation' for s in result['samples'])


def test_invalid_duplicate_postfreeze_and_tampering_rejected():
    base = [attempt(i) for i in range(3)]
    for records in [base + [base[0]], [attempt(0, observed_at='2026-02-01T00:00:00Z')],
                    [attempt(0, sensor_status='invalid', sensor_reason='occluded')],
                    [attempt(0, measurement_sigma_deg=0)], [attempt(0, JA=float('nan'))]]:
        with pytest.raises(ValueError):
            fit(records)
    profile = fit(base)
    changed = deepcopy(profile)
    changed['attempts'][0]['JA'] = 12
    with pytest.raises(ValueError, match='hash mismatch'):
        distribution(changed)
    assert distribution(fit([]))['status'] == 'unsupported_context'


def test_sensations_never_change_control_values_or_anatomy_and_small_noise():
    base = [attempt(i, -3.) for i in range(3)]
    previous = deepcopy(base)
    before = distribution(fit(base))
    after = distribution(fit([{**a, 'sensation_report': 'I noticed vibration.'} for a in base]))
    assert before['samples'] == after['samples']
    assert before['anatomy_updates'] == after['anatomy_updates'] == {}
    assert before['variance_resolution'] == 'unresolved_below_measurement_noise'
    assert before['comfortable_observed_envelope_deg'] == [-3, -3]
    assert base == previous


def test_inferred_unknown_uncertainty_is_preserved_without_fabrication():
    result = distribution(fit([attempt(i, -i, source_kind='inferred_articulation',
        measurement_sigma_deg=None, uncertainty_scope='uncalibrated_conditional_on_model_and_observations',
        derived_model_id='fit-1') for i in range(3)]))
    assert result['status'] == 'supported'
    assert result['mean_reported_uncertainty_variance_deg2'] is None
    assert result['estimated_between_attempt_variance_deg2'] is None
    assert all(sample['measurement_sigma_deg'] is None for sample in result['samples'])
