"""Frozen external-drive forecasts using the shared explicit oral probe operator."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import math

import numpy as np

from .acoustic_probe import OPERATOR_VERSION, predict_external_probe
from .engine import Engine, finite
from .pcm_design import _snapshot
from .prediction import Artifact, _encode, _identity, _timestamp


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def predict_probe(snapshot, *, expected_digest, prediction_id, target_evidence_id, generated_at,
                  pose, frequency_hz, placement, calibration, calibration_evidence_ids,
                  calibration_frozen_at, articulation=None, channel='oral_external',
                  comparison='magnitude', timing=None, termination='rigid',
                  termination_resistance_pa_s_m3=None, attenuation_np_per_m=.5,
                  max_operator_calls=32):
    """Forecast external source -> oral scattering + direct path, never glottal drive.

    Instrument/placement/boundary validation belongs to predict_external_probe.
    This layer binds frozen anatomy, calibration, target identity and timing.
    """
    data = _snapshot(snapshot, expected_digest)
    _identity(prediction_id, 'prediction_id'); _identity(target_evidence_id, 'target_evidence_id')
    _identity(pose, 'pose')
    if channel != 'oral_external':
        raise ValueError('Only oral_external is supported; nasal channels require a branched operator')
    if comparison not in ('magnitude', 'complex'):
        raise ValueError('Comparison must be magnitude or complex')
    if not isinstance(calibration, dict) or not isinstance(placement, dict):
        raise ValueError('Calibration and placement must be mappings')
    if not isinstance(calibration_evidence_ids, list) or not calibration_evidence_ids:
        raise ValueError('Explicit calibration source evidence IDs required')
    calibration_evidence_ids = list(calibration_evidence_ids)
    for identity in calibration_evidence_ids:
        _identity(identity, 'calibration evidence ID')
    if len(set(calibration_evidence_ids)) != len(calibration_evidence_ids):
        raise ValueError('Duplicate calibration evidence IDs')
    reserved = data['evidence_ids']+calibration_evidence_ids+[calibration.get('calibration_id')]
    if target_evidence_id in reserved:
        raise ValueError('Target evidence overlaps fitting or calibration evidence')
    generated = _timestamp(generated_at)
    if not max(_timestamp(data['sealed_at']), _timestamp(calibration_frozen_at)) <= generated <= _timestamp(_now()):
        raise ValueError('Forecast must follow model/calibration freeze and cannot be future dated')
    if articulation is not None and not isinstance(articulation, dict):
        raise ValueError('Articulation must be an explicit mapping')
    if type(max_operator_calls) is not int or not 1 <= max_operator_calls <= 32 or len(data['hypotheses']) > max_operator_calls:
        raise ValueError('External operator budget exceeded or invalid')
    # Inputs become owned immutable JSON before crossing the native boundary.
    config = deepcopy({'pose': pose, 'frequency_hz': frequency_hz, 'placement': placement,
        'calibration': calibration, 'articulation': articulation, 'termination': termination,
        'termination_resistance_pa_s_m3': termination_resistance_pa_s_m3,
        'attenuation_np_per_m': attenuation_np_per_m})
    _encode(config)
    timing = deepcopy(timing if timing is not None else {'phase_verified': False, 'uncertainty_s': None})
    if not isinstance(timing, dict) or set(timing) != {'phase_verified', 'uncertainty_s'} or type(timing['phase_verified']) is not bool:
        raise ValueError('Timing requires explicit phase_verified and uncertainty_s')
    uncertainty = timing['uncertainty_s']
    if uncertainty is not None and finite(uncertainty, 'timing uncertainty') < 0:
        raise ValueError('Timing uncertainty cannot be negative')
    if comparison == 'complex' and (not timing['phase_verified'] or uncertainty is None):
        raise ValueError('Complex comparison requires verified timing uncertainty')
    predictions = []
    with Engine() as engine:
        if engine.provenance != data['provenance']:
            raise ValueError('Frozen anatomy native provenance or geometry basis is stale')
        for candidate in data['hypotheses']:
            applied = engine.set_anatomy(candidate['anatomy'])
            response = predict_external_probe(engine, **config)
            if response['operator_version'] != OPERATOR_VERSION or response['native_provenance'] != data['provenance']:
                raise RuntimeError('External operator provenance changed during prediction')
            valid = np.asarray(response['valid_mask'], dtype=bool)
            if comparison == 'complex' and valid.any():
                maximum = float(np.asarray(response['frequency_hz'])[valid].max())
                if 2*math.pi*maximum*uncertainty > .1:
                    raise ValueError('Phase uncertainty exceeds 0.1 radians on a supported band')
            magnitude = [float(math.hypot(real, imag)) if ok else None for real, imag, ok in
                         zip(response['response_real'], response['response_imag'], valid)]
            predictions.append({'hypothesis_id': candidate['hypothesis_id'], 'anatomy': applied,
                'response_magnitude': magnitude, 'operator_prediction': response})
    common = np.all([p['operator_prediction']['valid_mask'] for p in predictions], axis=0)
    native_frequencies = predictions[0]['operator_prediction']['frequency_hz']
    return Artifact(_encode({'schema_version': 'internal-probe-prediction-0.1',
        'kind': 'frozen_external_probe_prediction', 'prediction_id': prediction_id,
        'target_evidence_id': target_evidence_id, 'model_id': data['model_id'],
        'hypothesis_snapshot_sha256': snapshot.sha256, 'fitting_evidence_ids': data['evidence_ids'],
        'fitting_evidence_hashes': data['evidence_hashes'], 'native_provenance': data['provenance'],
        'model_sealed_at': data['sealed_at'], 'calibration_frozen_at': calibration_frozen_at,
        'generated_at': generated_at, 'sealed_at': _now(), 'operator_version': OPERATOR_VERSION,
        'channel': channel, 'quantity': 'recorded_pcm_per_digital_drive', 'comparison': comparison,
        'timing': timing, 'phase_comparison_supported': comparison == 'complex',
        'configuration': config, 'configuration_sha256': _hash(config),
        'calibration_sha256': _hash(config['calibration']), 'calibration_evidence_ids': calibration_evidence_ids,
        'calibration_evidence_hashes': config['calibration']['source_hashes'],
        'calibration_evidence_authenticated': False, 'placement_sha256': _hash(config['placement']),
        'frequency_hz': native_frequencies, 'requested_band_hz': [native_frequencies[0], native_frequencies[-1]],
        'common_valid_mask': common.tolist(), 'predictions': predictions,
        'availability': 'available' if common.any() else 'unavailable',
        'missing_reason': None if common.any() else 'no_common_supported_frequency_band',
        'actual_operator_calls': len(predictions), 'max_operator_calls': max_operator_calls,
        'limitations': ['Conditional external monopole/compact-mouth oral-tube prediction, not glottal transfer',
            'Magnitude comparison does not authorize phase or propagation-delay inference',
            'Calibration capture time and source authenticity require external attestation',
            'Commit this exact artifact before target capture; server seal alone does not authenticate physical capture',
            'Candidate spread is not calibrated posterior uncertainty; no nasal topology or tissue recovery']}))
