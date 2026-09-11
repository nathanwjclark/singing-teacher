"""Retrospective time-resolved comparison against a bounded native forward bank."""
from copy import deepcopy
import hashlib
import json
import math

from .pcm_inverse import FEATURES, fit_pcm

VERSION = 'motion-forward-bank-2'
MAX_WINDOWS = 120
MAX_SYNTHESIS_CALLS = 108
MAX_PITCH_DISTANCE_CENTS = 100.


def window_offsets(sample_count, sample_rate, excerpt_size):
    """A fixed temporal grid spanning the recording, never selected by fit quality."""
    if sample_count < excerpt_size:
        return [0]
    count = min(MAX_WINDOWS, max(1, sample_count // excerpt_size))
    if count == 1:
        return [0]
    return [round(i * (sample_count - excerpt_size) / (count - 1)) for i in range(count)]


def _values(measurement):
    return {row['name']: row for row in measurement['measurements'] if row['name'] in FEATURES}


def score_forward_bank(engine, windows, hypotheses, pose, sample_rate, frame_start, frame_size,
                       *, fitter=fit_pcm):
    """Build at most three pitch banks once and compare each independently measured frame.

    Bank pitch anchors and objective scales use this whole recording. These are
    retrospective explanatory scores, not forecasts of held-out singing.
    """
    usable = [row for row in windows if row['status'] == 'measured']
    metadata = {'kind': VERSION, 'maxWindows': MAX_WINDOWS, 'maxSynthesisCalls': MAX_SYNTHESIS_CALLS,
        'pitchAnchorsHz': [], 'maxPitchDistanceCents': MAX_PITCH_DISTANCE_CENTS,
        'pitchPolicy': 'minimum, median and maximum measured voiced pitch; nearest anchor, lower tie',
        'measurementPolicy': 'disjoint canonical frames on an evenly spaced recording-wide grid; no quality-based window selection',
        'interpretation': 'retrospective fixed-source candidate comparison; not a forecast or recovered movement',
        'banks': [], 'synthesisRequests': 0}
    if not usable:
        return metadata
    pitches = sorted(_values(row['measurement'])['pitchHz']['value'] for row in usable)
    anchors = sorted(set((pitches[0], pitches[(len(pitches)-1)//2], pitches[-1])))
    metadata['pitchAnchorsHz'] = anchors
    # One scale vector for all windows: no per-window renormalization hides gaps.
    scales = {name: {'unit': unit, 'scale': max([scale] + [
        _values(row['measurement'])[name].get('uncertainty') or 0. for row in usable])}
        for name, (unit, scale) in FEATURES.items()}
    metadata['featureScales'] = scales
    banks = []
    for anchor_index, pitch in enumerate(anchors):
        representative = min(usable, key=lambda row: abs(_values(row['measurement'])['pitchHz']['value'] - pitch))
        identity = f'anchor-{anchor_index}'
        document = {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': [dict(
            id=identity, pose=pose, measurement=representative['measurement'], sample_rate_hz=sample_rate,
            frame_start_sample=frame_start, frame_size=frame_size, duration_s=.25)]}
        candidates = [dict(candidate_id=f'{h["hypothesis_id"]}:JA{ja}:gain{gain}', anatomy=h['anatomy'],
            trials={identity: dict(JA=ja, f0_hz=pitch, gain=gain)})
            for h in hypotheses for ja in (-4., -3., -2.) for gain in (1., 4.)]
        try:
            fitted = fitter(engine, document, candidates=candidates, max_synthesis_calls=len(candidates)*2)
            metadata['synthesisRequests'] += fitted.get('actual_synthesis_calls', 0)
            if metadata['synthesisRequests'] > MAX_SYNTHESIS_CALLS:
                raise RuntimeError('Motion forward-bank synthesis request budget exceeded')
            banks.append(fitted)
            digest = hashlib.sha256(json.dumps(fitted, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
            metadata['banks'].append({'pitchHz': pitch, 'status': 'available', 'sha256': digest, 'predictions': fitted})
        except (ValueError, RuntimeError) as error:
            banks.append(None)
            metadata['banks'].append({'pitchHz': pitch, 'status': 'failed', 'reason': str(error)})
    for row in usable:
        target = _values(row['measurement'])
        pitch = target['pitchHz']['value']
        bank_index = min(range(len(anchors)), key=lambda i: (abs(math.log2(pitch/anchors[i])), anchors[i]))
        distance = 1200 * math.log2(pitch/anchors[bank_index])
        row.update(pitchAnchorHz=anchors[bank_index], pitchDistanceCents=distance)
        fitted = banks[bank_index]
        if abs(distance) > MAX_PITCH_DISTANCE_CENTS or fitted is None:
            row.update(status='unavailable', reason='Measured pitch outside the one-semitone bank support' if fitted else 'Native pitch bank unavailable')
            continue
        if not fitted.get('canonical_extractor') or not fitted.get('native_provenance'):
            row.update(status='insufficient-quality', reason='Native bank lacks verified canonical prediction provenance')
            continue
        score = {key: deepcopy(fitted[key]) for key in ('kind', 'canonical_extractor', 'native_provenance', 'identifiability')}
        score.update(feature_scales=scales, actual_synthesis_calls=0, bank_sha256=metadata['banks'][bank_index]['sha256'],
            objective_interpretation='shared-scale coarse-descriptor discrepancy against a reused fixed-source pitch bank')
        for model in ('joint', 'fixed_anatomy_baseline'):
            candidates = []
            for candidate in fitted[model]['candidates']:
                comparison = deepcopy(candidate)
                prediction = comparison['predictions'][0]['canonical']['measurement'] if comparison.get('predictions') else None
                predicted = _values(prediction) if prediction else {}
                missing = [name for name in FEATURES if target.get(name, {}).get('value') is None or predicted.get(name, {}).get('value') is None]
                flags = set(prediction['quality']['flags']) if prediction else {'invalid'}
                if flags & {'clipping', 'invalid', 'dropped', 'low-signal-to-noise'}:
                    missing.append('invalid-prediction-quality')
                comparison['predictions'] = [{'controls': item['controls'], 'bankSha256': metadata['banks'][bank_index]['sha256']} for item in comparison.get('predictions', [])]
                comparison['predictedFeatures'] = {name: predicted.get(name, {}).get('value') for name in FEATURES}
                comparison['missing_features'] = [{'feature': name, 'reason': 'Unavailable comparable descriptor'} for name in missing]
                comparison['status'] = 'missing_predicted_features' if missing else 'scored'
                comparison['weighted_mean_square_discrepancy'] = None if missing else sum(
                    ((predicted[name]['value']-target[name]['value'])/scales[name]['scale'])**2 for name in FEATURES)/len(FEATURES)
                candidates.append(comparison)
            valid = [candidate for candidate in candidates if candidate['status'] == 'scored']
            score[model] = {'candidates': candidates, 'best': min(valid, key=lambda item: item['weighted_mean_square_discrepancy']) if valid else None,
                'actual_synthesis_calls': 0}
        row.update(fit=score, status='scored' if score['joint']['best'] else 'insufficient-quality',
            reason=None if score['joint']['best'] else 'No complete comparable native predictions')
    return metadata
