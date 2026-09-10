"""Native transfer forecasts integrating empirical cue-execution uncertainty."""
from __future__ import annotations

import math

import numpy as np

from .engine import Engine, finite
from .prediction import Artifact, _encode, _identity, _timestamp, freeze_candidates


def _read(artifact, expected_digest):
    if not isinstance(artifact, Artifact) or artifact.sha256 != expected_digest:
        raise ValueError('Artifact digest mismatch')
    try:
        data = artifact.data
    except (ValueError, UnicodeError) as exc:
        raise ValueError('Invalid artifact JSON') from exc
    if not isinstance(data, dict) or _encode(data) != artifact.content:
        raise ValueError('Artifact must be a canonical JSON object')
    return data


def _candidates(snapshot, expected_digest):
    data = _read(snapshot, expected_digest)
    keys = ('model_id', 'evidence_ids', 'provenance', 'candidates', 'frozen_at')
    if not set(keys) <= set(data):
        raise ValueError('Incomplete candidate snapshot')
    validated = freeze_candidates(**{key: data[key] for key in keys})
    if validated.content != snapshot.content:
        raise ValueError('Invalid candidate snapshot')
    return data


def _nodes(distribution, *, conditional=False):
    if not isinstance(distribution, dict) or distribution.get('status') != 'supported':
        raise ValueError('Execution support is unavailable for this cue/context/mode')
    samples = distribution.get('samples')
    if not isinstance(samples, list) or not samples:
        raise ValueError('Execution support must contain measured samples')
    missing = finite(distribution.get('missing_execution_mass'), 'missing_execution_mass')
    sensor = finite(distribution.get('sensor_invalid_fraction'), 'sensor_invalid_fraction')
    failure = finite(distribution.get('execution_failure_probability'), 'execution_failure_probability')
    if not all(0 <= p <= 1 for p in (missing, sensor, failure)):
        raise ValueError('Execution probabilities must lie in [0, 1]')
    weights = []
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError('Invalid execution sample')
        finite(sample.get('JA'), 'JA')
        weight = finite(sample.get('weight'), 'weight')
        sigma = sample.get('measurement_sigma_deg')
        if sigma is None:
            if sample.get('source_kind') != 'inferred_articulation':
                raise ValueError('Missing uncertainty is supported only for explicitly inferred controls')
        else:
            sigma = finite(sigma, 'measurement_sigma_deg')
        if weight <= 0 or (sigma is not None and sigma < 0) or sample.get('execution_status') not in (('not_assessed',) if conditional else ('successful', 'unsuccessful', 'unknown')):
            raise ValueError('Invalid execution weight, uncertainty or status')
        weights.append(weight)
    mass = math.fsum(weights)
    if not math.isclose(mass + missing, 1., rel_tol=0, abs_tol=1e-9):
        raise ValueError('Measured support weights plus missing mass must sum to one')
    return samples, np.asarray(weights), mass


def _physical(candidate_data, distribution, pose, bins, max_native_calls, *, conditional=False):
    samples, weights, mass = _nodes(distribution, conditional=conditional)
    if type(max_native_calls) is not int or not 1 <= max_native_calls <= 4096:
        raise ValueError('max_native_calls must be an integer in [1, 4096]')
    count = len(samples) * len(candidate_data['candidates'])
    if count > max_native_calls:
        raise ValueError('Candidate/control product exceeds native-call budget')
    records, spectra, joint_weights = [], [], []
    with Engine() as engine:
        if engine.provenance != candidate_data['provenance']:
            raise ValueError('Candidate native provenance is stale')
        for candidate in candidate_data['candidates']:
            anatomy = engine.set_anatomy(candidate['anatomy'])
            for index, sample in enumerate(samples):
                control = {'JA': sample['JA']}
                _, applied = engine.pose(pose, control)
                frequency, magnitude, _ = engine.spectrum(pose, control, bins=bins)
                weight = weights[index] / len(candidate_data['candidates'])
                spectra.append(magnitude)
                joint_weights.append(weight)
                records.append({'candidate_id': candidate['candidate_id'], 'control_node': index,
                    'unconditional_weight': weight, 'execution_status': sample['execution_status'],
                    'anatomy': anatomy, 'requested_ja_deg': sample['JA'], 'measurement_sigma_deg': sample['measurement_sigma_deg'],
                    'applied_ja_deg': applied['JA']['applied'], 'magnitude_db': magnitude.tolist()})
    values = np.asarray(spectra)
    unconditional_weights = np.asarray(joint_weights)
    known_contribution = unconditional_weights @ values
    mean = known_contribution / mass
    variance = (unconditional_weights / mass) @ ((values - mean) ** 2)
    return {'frequency_hz': frequency.tolist(), 'nodes': records, 'native_calls': count,
        'measured_execution_mass': mass, 'missing_execution_mass': distribution['missing_execution_mass'],
        'sensor_invalid_fraction': distribution['sensor_invalid_fraction'],
        'execution_failure_probability': distribution['execution_failure_probability'],
        'unknown_execution_probability': distribution.get('unknown_execution_probability'),
        'measured_support_mean_db': mean.tolist(), 'measured_support_variance_db2': variance.tolist(),
        'known_unconditional_feature_contribution_db': known_contribution.tolist(),
        'full_unconditional_mean_db': mean.tolist() if distribution['missing_execution_mass'] == 0 else None,
        'interpretation': 'expectation_of_dB_transfer_features_not_mean_waveform',
        'candidate_weights': 'uniform_epistemic_support_not_calibrated_posterior',
        'missing_outcomes': 'not_imputed',
        'measurement_uncertainty': 'retained_per_node_not_deconvolved_or_propagated_as_latent_control'}


def freeze_control_profile(profile):
    """Freeze exact motor-model output; its internal digest is validated at use."""
    if not isinstance(profile, dict) or profile.get('schema_version') != 'internal-control-0.1.0':
        raise ValueError('Unsupported control profile')
    for key in ('anatomy_model_id', 'profile_sha256'):
        _identity(profile.get(key), key)
    _timestamp(profile.get('fitted_at'))
    evidence = profile.get('evidence_ids')
    if not isinstance(evidence, list) or not evidence:
        raise ValueError('Control profile needs distinct evidence IDs')
    for item in evidence:
        _identity(item, 'control evidence ID')
    if len(set(evidence)) != len(evidence):
        raise ValueError('Control profile needs distinct evidence IDs')
    return Artifact(_encode(profile))


def predict_control(snapshot, control_profile, *, expected_anatomy_digest, expected_control_digest,
                    prediction_id, target_evidence_id, generated_at, cue_id, cue_version,
                    context, mode, bins=512, max_native_calls=256):
    """Prospective cue forecast from frozen anatomy and observed execution history."""
    from .control import execution_distribution

    anatomy = _candidates(snapshot, expected_anatomy_digest)
    profile = _read(control_profile, expected_control_digest)
    freeze_control_profile(profile)
    if profile['anatomy_model_id'] != anatomy['model_id']:
        raise ValueError('Control profile anatomy model is stale')
    _identity(prediction_id, 'prediction_id')
    _identity(target_evidence_id, 'target_evidence_id')
    if target_evidence_id in anatomy['evidence_ids'] + profile['evidence_ids']:
        raise ValueError('Target evidence leaks into a frozen model')
    generated = _timestamp(generated_at)
    if generated < max(_timestamp(anatomy['frozen_at']), _timestamp(profile['fitted_at'])):
        raise ValueError('Prediction precedes frozen evidence cutoff')
    distribution = execution_distribution(profile, cue_id=cue_id, cue_version=cue_version,
                                          context=context, mode=mode)
    numeric = _physical(anatomy, distribution, context['vowel'], bins, max_native_calls)
    return Artifact(_encode({'schema_version': 'internal-control-forecast-0.1.0',
        'kind': 'prospective_empirical_execution_transfer_forecast', 'prediction_id': prediction_id,
        'target_evidence_id': target_evidence_id, 'model_id': anatomy['model_id'],
        'anatomy_snapshot_sha256': snapshot.sha256, 'control_snapshot_sha256': control_profile.sha256,
        'control_profile_sha256': profile['profile_sha256'], 'generated_at': generated_at,
        'anatomy_frozen_at': anatomy['frozen_at'], 'control_fitted_at': profile['fitted_at'],
        'anatomy_evidence_ids': anatomy['evidence_ids'], 'control_evidence_ids': profile['evidence_ids'],
        'provenance': anatomy['provenance'], 'cue_id': cue_id, 'cue_version': cue_version,
        'context': context, 'mode': mode, 'bins': bins, 'execution_distribution': distribution,
        'quantity': 'simulated_tract_transfer_magnitude_db', 'numeric': numeric,
        'limitations': ['Not microphone audio', 'Empirical execution support, not calibrated latent motor posterior',
                        'Commit-before-capture enforced by external coordinator']}))


def condition_on_execution(prospective, snapshot, *, expected_prospective_digest,
                           expected_anatomy_digest, prediction_id, generated_at,
                           observed_at, observed_evidence_id, measured_ja_deg,
                           measurement_sigma_deg, bins=None, max_native_calls=256):
    """Separate post-capture prediction; never updates prospective artifact bytes."""
    prior = _read(prospective, expected_prospective_digest)
    if prior.get('kind') != 'prospective_empirical_execution_transfer_forecast':
        raise ValueError('Conditional output requires a prospective parent')
    anatomy = _candidates(snapshot, expected_anatomy_digest)
    if snapshot.sha256 != prior.get('anatomy_snapshot_sha256'):
        raise ValueError('Conditional anatomy differs from frozen prospective model')
    anatomy_bindings = {'model_id': 'model_id', 'provenance': 'provenance',
                        'anatomy_evidence_ids': 'evidence_ids', 'anatomy_frozen_at': 'frozen_at'}
    if any(prior.get(key) != anatomy[value] for key, value in anatomy_bindings.items()):
        raise ValueError('Prospective anatomy identity, provenance or evidence binding mismatch')
    distribution = prior.get('execution_distribution')
    if not isinstance(distribution, dict):
        raise ValueError('Prospective control evidence binding is missing')
    control_bindings = {'anatomy_model_id': 'model_id', 'profile_sha256': 'control_profile_sha256',
                        'evidence_ids': 'control_evidence_ids', 'fitted_at': 'control_fitted_at',
                        'cue_id': 'cue_id', 'cue_version': 'cue_version', 'context': 'context', 'mode': 'mode'}
    if any(key not in distribution or value not in prior or distribution[key] != prior[value]
           for key, value in control_bindings.items()):
        raise ValueError('Prospective control identity or evidence binding mismatch')
    control_ids = prior['control_evidence_ids']
    if not isinstance(control_ids, list) or not control_ids:
        raise ValueError('Prospective control evidence IDs are required')
    for identity in control_ids:
        _identity(identity, 'control evidence ID')
    if len(set(control_ids)) != len(control_ids):
        raise ValueError('Duplicate prospective control evidence IDs')
    if prior.get('target_evidence_id') in anatomy['evidence_ids'] + control_ids:
        raise ValueError('Prospective target leaks into frozen evidence')
    if _timestamp(prior['generated_at']) < max(_timestamp(anatomy['frozen_at']),
                                              _timestamp(prior['control_fitted_at'])):
        raise ValueError('Prospective prediction precedes frozen evidence cutoff')
    _identity(prediction_id, 'prediction_id')
    if prediction_id == prior['prediction_id']:
        raise ValueError('Conditional prediction needs its own identity')
    if observed_evidence_id != prior['target_evidence_id']:
        raise ValueError('Measured execution must belong to prospective target')
    if not _timestamp(prior['generated_at']) <= _timestamp(observed_at) <= _timestamp(generated_at):
        raise ValueError('Conditional observation timing is invalid')
    sigma = finite(measurement_sigma_deg, 'measurement_sigma_deg')
    if sigma < 0:
        raise ValueError('Measurement uncertainty cannot be negative')
    node = {'JA': finite(measured_ja_deg, 'JA'), 'weight': 1., 'measurement_sigma_deg': sigma,
            'execution_status': 'not_assessed'}
    support = {'status': 'supported', 'samples': [node], 'missing_execution_mass': 0.,
               'sensor_invalid_fraction': 0., 'execution_failure_probability': 0.}
    numeric = _physical(anatomy, support, prior['context']['vowel'], prior['bins'] if bins is None else bins,
                        max_native_calls, conditional=True)
    numeric['execution_failure_probability'] = None
    return Artifact(_encode({'schema_version': 'internal-control-forecast-0.1.0',
        'kind': 'postcapture_measured_execution_transfer_forecast', 'prediction_id': prediction_id,
        'prospective_prediction_sha256': prospective.sha256,
        'anatomy_snapshot_sha256': snapshot.sha256,
        'control_snapshot_sha256': prior['control_snapshot_sha256'],
        'control_profile_sha256': prior['control_profile_sha256'], 'model_id': prior['model_id'],
        'anatomy_evidence_ids': prior['anatomy_evidence_ids'], 'control_evidence_ids': prior['control_evidence_ids'],
        'observed_evidence_id': observed_evidence_id, 'observed_at': observed_at, 'generated_at': generated_at,
        'measurement_sigma_deg': sigma, 'numeric': numeric,
        'limitations': ['Conditional measured-control prediction; not a prospective outcome forecast',
                        'Measurement uncertainty retained, not propagated as a latent distribution']}))
