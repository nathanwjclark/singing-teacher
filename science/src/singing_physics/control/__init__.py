"""Empirical cue-conditioned motor observations, separate from stable anatomy."""
from __future__ import annotations

from collections import Counter
from datetime import datetime
import hashlib
import json
import math

import numpy as np

_MODES = {'elicited', 'recalled', 'transfer'}
_CONTEXT = {'pitch_hz', 'vowel', 'level', 'posture'}


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label} must be nonempty text')


def _number(value, label, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{label} must be finite')
    if positive and value <= 0:
        raise ValueError(f'{label} must be positive')


def _context(value):
    if not isinstance(value, dict) or set(value) != _CONTEXT:
        raise ValueError('context requires pitch_hz, vowel, level and posture')
    _number(value['pitch_hz'], 'pitch_hz', positive=True)
    for name in ('vowel', 'level', 'posture'):
        _text(value[name], name)
    return {**value, 'pitch_hz': float(value['pitch_hz'])}


def _key(cue_id, cue_version, context, mode):
    _text(cue_id, 'cue_id')
    _text(cue_version, 'cue_version')
    if not isinstance(mode, str) or mode not in _MODES:
        raise ValueError('mode must be elicited, recalled or transfer')
    return json.dumps([cue_id, cue_version, _context(context), mode], sort_keys=True)


def _copy(value):
    try:
        return json.loads(json.dumps(value, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise ValueError('profile inputs must be finite JSON') from exc


def fit_control_profile(attempts, *, anatomy_model_id, fitted_at):
    """Retain every attempt and derive no anatomical values from cue execution.

    JA is externally measured/inferred jaw angle in degrees under a declared
    operator. Sensor uncertainty is supplied as one-standard-deviation error.
    Caller owns alignment, operator validity and the reviewed cue library.
    """
    _text(anatomy_model_id, 'anatomy_model_id')
    try:
        freeze = datetime.fromisoformat(fitted_at.replace('Z', '+00:00'))
        if freeze.utcoffset() is None:
            raise ValueError()
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError('fitted_at requires an ISO timestamp with timezone') from exc
    if not isinstance(attempts, list):
        raise ValueError('attempts must be a list')
    required = {'attempt_id', 'evidence_id', 'cue_id', 'cue_version', 'context', 'mode',
                'observed_at', 'sensor_status', 'sensor_reason', 'execution_status',
                'JA', 'measurement_sigma_deg', 'operator_id', 'comfortable',
                'source_kind', 'uncertainty_scope', 'derived_model_id'}
    ids, records = set(), []
    for attempt in _copy(attempts):
        if not isinstance(attempt, dict) or set(attempt) - (required | {'sensation_report'}) or not required <= set(attempt):
            raise ValueError('attempt has missing or unsupported fields')
        for field in ('attempt_id', 'evidence_id', 'operator_id'):
            _text(attempt[field], field)
        if attempt['attempt_id'] in ids:
            raise ValueError('duplicate attempt_id')
        ids.add(attempt['attempt_id'])
        _key(attempt['cue_id'], attempt['cue_version'], attempt['context'], attempt['mode'])
        attempt['context'] = _context(attempt['context'])
        try:
            timestamp = datetime.fromisoformat(attempt['observed_at'].replace('Z', '+00:00'))
            if timestamp.utcoffset() is None:
                raise ValueError()
        except (ValueError, AttributeError, TypeError) as exc:
            raise ValueError('observed_at requires an ISO timestamp with timezone') from exc
        if timestamp > freeze:
            raise ValueError('attempt occurs after profile freeze')
        if attempt['source_kind'] not in {'direct_measurement', 'inferred_articulation', 'synthetic'}:
            raise ValueError('invalid source_kind')
        _text(attempt['uncertainty_scope'], 'uncertainty_scope')
        if attempt['source_kind'] == 'inferred_articulation':
            _text(attempt['derived_model_id'], 'derived_model_id')
        elif attempt['derived_model_id'] is not None:
            _text(attempt['derived_model_id'], 'derived_model_id')
        if type(attempt['comfortable']) is not bool:
            raise ValueError('comfortable must be boolean')
        if attempt['execution_status'] not in {'successful', 'unsuccessful', 'unknown'}:
            raise ValueError('invalid execution_status')
        if attempt['sensor_status'] not in {'valid', 'invalid'}:
            raise ValueError('sensor_status must be valid or invalid')
        if attempt['sensor_status'] == 'invalid':
            _text(attempt['sensor_reason'], 'invalid sensor_reason')
            if attempt['JA'] is not None or attempt['measurement_sigma_deg'] is not None:
                raise ValueError('invalid sensor cannot supply a JA measurement')
        elif attempt['sensor_reason'] is not None:
            raise ValueError('valid sensor_reason must be null')
        if attempt['JA'] is None:
            if attempt['measurement_sigma_deg'] is not None:
                raise ValueError('missing JA cannot have measurement uncertainty')
        else:
            _number(attempt['JA'], 'JA')
            if attempt['measurement_sigma_deg'] is not None or attempt['source_kind'] != 'inferred_articulation':
                _number(attempt['measurement_sigma_deg'], 'measurement_sigma_deg', positive=True)
        if 'sensation_report' in attempt and not isinstance(attempt['sensation_report'], str):
            raise ValueError('sensation_report must be subjective text')
        records.append(attempt)
    content = {'schema_version': 'internal-control-0.1.0', 'kind': 'empirical_cue_control_profile',
               'anatomy_model_id': anatomy_model_id, 'attempts': records, 'fitted_at': fitted_at,
               'evidence_ids': sorted({a['evidence_id'] for a in records}),
               'anatomy_updates': {}, 'sensations_used_for_anatomy': False}
    content['profile_sha256'] = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return content


def execution_distribution(profile, *, cue_id, cue_version, context, mode):
    """Return exact-context empirical JA support, preserving unobserved mass.

    These atoms include measurement noise, not latent posterior samples. Population
    variance estimates assume independent zero-mean supplied measurement errors.
    With fewer than three measured attempts no forecast support is returned.
    """
    if not isinstance(profile, dict) or profile.get('schema_version') != 'internal-control-0.1.0':
        raise ValueError('unsupported control profile')
    validated = fit_control_profile(profile.get('attempts'), anatomy_model_id=profile.get('anatomy_model_id'), fitted_at=profile.get('fitted_at'))
    if profile != validated:
        raise ValueError('control profile content/hash mismatch')
    key = _key(cue_id, cue_version, context, mode)
    records = [a for a in validated['attempts'] if _key(a['cue_id'], a['cue_version'], a['context'], a['mode']) == key]
    result = {'schema_version': 'internal-control-distribution-0.1.0',
              'profile_sha256': profile['profile_sha256'], 'anatomy_model_id': profile['anatomy_model_id'],
              'evidence_ids': profile['evidence_ids'], 'fitted_at': profile['fitted_at'],
              'cue_id': cue_id, 'cue_version': cue_version, 'context': _context(context), 'mode': mode,
              'sample_count': len(records), 'frequency_interpretation': 'empirical_recorded_attempts_not_established_unconditional_success_rate', 'samples': [], 'support_interpretation': 'empirical_measured_JA_not_latent_posterior',
              'anatomy_updates': {}, 'limitations': ['Exact observed contexts only', 'No physiological maximum inferred',
                  'Small-sample empirical frequencies are not calibrated future probabilities',
                  'Correlated measurement error can invalidate variance decomposition']}
    if not records:
        return {**result, 'status': 'unsupported_context', 'reason': 'No matching observed attempts'}
    counts = Counter(a['execution_status'] for a in records)
    measured = [a for a in records if a['JA'] is not None]
    total = len(records)
    result.update({'execution_counts': dict(counts),
        'execution_failure_probability': counts['unsuccessful']/total,
        'unknown_execution_probability': counts['unknown']/total,
        'sensor_invalid_fraction': sum(a['sensor_status'] == 'invalid' for a in records)/total,
        'missing_execution_mass': 1-len(measured)/total,
        'retained_attempt_ids': [a['attempt_id'] for a in records],
        'operator_ids': sorted({a['operator_id'] for a in records}),
        'source_kinds': sorted({a['source_kind'] for a in records}),
        'measurement_count': len(measured)})
    if len(result['operator_ids']) != 1:
        return {**result, 'status': 'unsupported_operator_mixture', 'reason': 'Measurement operators cannot be silently pooled'}
    if len(result['source_kinds']) != 1:
        return {**result, 'status': 'unsupported_source_mixture', 'reason': 'Measurement and inference support cannot be silently pooled'}
    if len(measured) < 3:
        return {**result, 'status': 'insufficient_data', 'reason': 'At least three measured attempts are required'}
    values = np.array([a['JA'] for a in measured], dtype=float)
    measurement_variance = (float(np.mean([a['measurement_sigma_deg']**2 for a in measured]))
                            if all(a['measurement_sigma_deg'] is not None for a in measured) else None)
    observed_variance = float(np.var(values, ddof=1))
    inferred = result['source_kinds'] == ['inferred_articulation']
    intrinsic = None if inferred else max(0., observed_variance-measurement_variance)
    comfortable = [a['JA'] for a in measured if a['comfortable']]
    successful = [a['JA'] for a in measured if a['comfortable'] and a['execution_status'] == 'successful']
    result.update({'status': 'supported',
        'samples': [{'JA': a['JA'], 'weight': 1/total, 'measurement_sigma_deg': a['measurement_sigma_deg'],
                     'execution_status': a['execution_status'], 'attempt_id': a['attempt_id'],
                     'source_kind': a['source_kind'], 'uncertainty_scope': a['uncertainty_scope'],
                     'derived_model_id': a['derived_model_id']} for a in measured],
        'mean_JA_deg': float(values.mean()), 'observed_variance_deg2': observed_variance,
        'mean_measurement_variance_deg2': None if inferred else measurement_variance,
        'mean_reported_uncertainty_variance_deg2': measurement_variance,
        'estimated_between_attempt_variance_deg2': intrinsic,
        'variance_resolution': ('unidentified_for_inferred_articulation' if inferred else
            'unresolved_below_measurement_noise' if observed_variance <= measurement_variance else 'resolved_under_independent_error_assumption'),
        'comfortable_observed_envelope_deg': [min(comfortable), max(comfortable)] if comfortable else None,
        'intentional_reproduction': {'mode': mode, 'successful_comfortable_count': len(successful),
            'observed_states_deg': successful, 'repeat_evidence': len(successful) >= 3,
            'interpretation': 'observed_attempts_not_guaranteed_reachability'}})
    return result
