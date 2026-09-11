"""Retrospective time-resolved comparison against a bounded native forward bank."""
import hashlib
import json
import math

from .pcm_inverse import FEATURES, fit_pcm
from .pcm_spectral import COARSE_OBJECTIVE

VERSION = 'motion-forward-bank-3'
MAX_RECORDING_SECONDS = 30
MAX_WINDOWS = 120
MAX_HYPOTHESES = 3
JA_GRID = (-4., -3., -2.)
GAIN_GRID = (1., 4.)
# Three pitch anchors x (joint + fixed-anatomy comparator) x 3 hypotheses x 3 JA x 2 gains.
MAX_SYNTHESIS_CALLS = 3*2*MAX_HYPOTHESES*len(JA_GRID)*len(GAIN_GRID)
MAX_PITCH_DISTANCE_CENTS = 100.
ANCHOR_PERCENTILES = (10, 50, 90)
# Rescoring always uses the coarse canonical descriptors (COARSE_OBJECTIVE, FEATURES), whatever the baseline fit used.
SCALE_POLICY = ('per window: declared engineering scale, widened only by that window\'s own reported '
                'descriptor uncertainty (the fit_pcm per-trial rule)')


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def window_offsets(sample_count, sample_rate, excerpt_size):
    """A fixed temporal grid spanning the recording, never selected by fit quality."""
    if sample_count > MAX_RECORDING_SECONDS*sample_rate:
        raise ValueError(f'Motion audio is limited to {MAX_RECORDING_SECONDS} seconds')
    if sample_count < excerpt_size:
        return [0]
    count = min(MAX_WINDOWS, max(1, sample_count // excerpt_size))
    if count == 1:
        return [0]
    return [round(i * (sample_count - excerpt_size) / (count - 1)) for i in range(count)]


def select_hypotheses(snapshot):
    """Top retained hypotheses in the frozen snapshot's own rank order.

    Depends only on the frozen baseline snapshot, so the subset is fixed before
    any recording is decoded and no window can choose its own candidate bank.
    """
    hypotheses = snapshot['hypotheses']
    if not hypotheses:
        raise ValueError('Retained model hypotheses unavailable')
    if snapshot.get('probe_ranking'):
        basis, receipt = 'probe-adopted joint discrepancy ranking; unscored geometries follow', snapshot.get('probe_fit_sha256')
    elif snapshot.get('search_result_sha256'):
        basis, receipt = 'baseline search discrepancy ranking', snapshot['search_result_sha256']
    else:
        basis, receipt = 'caller-declared snapshot order; the snapshot declares no ranking', None
    selected = hypotheses[:MAX_HYPOTHESES]
    return selected, {'selectedIds': [h['hypothesis_id'] for h in selected], 'totalRetained': len(hypotheses),
        'selection': f'top-{MAX_HYPOTHESES}-by-frozen-snapshot-rank', 'rankingBasis': basis, 'rankingReceiptSha256': receipt,
        'snapshotSha256': _hash(snapshot), 'declaredBefore': 'recording decode and window scoring',
        'anatomies': {_hash(h['anatomy']): h['anatomy'] for h in selected}}


def pitch_anchors(pitches):
    """Nearest-rank 10th, 50th and 90th percentiles of measured voiced pitch.

    With ten or more measured windows a single octave error or other outlier
    cannot become an anchor; with fewer, the percentiles reach the extremes.
    """
    ordered = sorted(pitches)
    return sorted({ordered[max(0, math.ceil(p*len(ordered)/100)-1)] for p in ANCHOR_PERCENTILES})


def window_scales(measurement):
    values = _values(measurement)
    return {name: {'unit': unit, 'scale': max(scale, values[name].get('uncertainty') or 0.)}
            for name, (unit, scale) in FEATURES.items()}


def _values(measurement):
    return {row['name']: row for row in measurement['measurements'] if row['name'] in FEATURES}


def _bank_table(fitted):
    """Compact predicted descriptors, one row per distinct anatomy/JA/gain.

    The fixed-anatomy comparator repeats the reference anatomy for every
    hypothesis; its duplicates are identical predictions and keep only the first
    candidate ID. The complete fit is retained once as a separate artifact.
    """
    table = {}
    for model in ('joint', 'fixed_anatomy_baseline'):
        rows, seen = [], set()
        for candidate in fitted[model]['candidates']:
            prediction = candidate['predictions'][0] if candidate.get('predictions') else None
            measurement = prediction['canonical']['measurement'] if prediction else None
            predicted = _values(measurement) if measurement else {}
            key = (_hash(candidate['anatomy']), json.dumps(prediction['controls'], sort_keys=True) if prediction else candidate['candidate_id'])
            if key in seen:
                continue
            seen.add(key)
            rows.append({'candidate_id': candidate['candidate_id'], 'anatomySha256': key[0],
                'JA': prediction['controls']['JA'] if prediction else None, 'gain': prediction['controls']['gain'] if prediction else None,
                'status': candidate['status'], 'qualityFlags': sorted(measurement['quality']['flags']) if measurement else ['invalid'],
                'predictedFeatures': {name: predicted.get(name, {}).get('value') for name in FEATURES}})
        table[model] = rows
    return table


def score_forward_bank(engine, windows, hypotheses, pose, sample_rate, frame_start, frame_size, *, fitter=fit_pcm):
    """Build at most three pitch banks once and compare each independently measured frame.

    Bank pitch anchors use this whole recording. These are retrospective
    explanatory scores, not forecasts of held-out singing. Returns the compact
    summary metadata and the complete fitted banks (None where a bank failed).
    """
    usable = [row for row in windows if row['status'] == 'measured']
    metadata = {'kind': VERSION, 'maxWindows': MAX_WINDOWS, 'maxSynthesisCalls': MAX_SYNTHESIS_CALLS,
        'pitchAnchorsHz': [], 'maxPitchDistanceCents': MAX_PITCH_DISTANCE_CENTS,
        'pitchPolicy': 'nearest-rank 10th, 50th and 90th percentiles of measured voiced pitch; each window uses its nearest anchor (lower on ties) only within 100 cents',
        'measurementPolicy': 'disjoint canonical frames on an evenly spaced recording-wide grid; no quality-based window selection',
        'interpretation': 'retrospective fixed-source candidate comparison; not a forecast or recovered movement',
        'objectiveInterpretation': 'per-window-scaled coarse-descriptor discrepancy against a reused fixed-source pitch bank; not a likelihood',
        'objective': COARSE_OBJECTIVE, 'objectiveFeatures': list(FEATURES), 'scalePolicy': SCALE_POLICY,
        'bankSha256Scope': 'canonical JSON (sorted keys, compact separators) of the complete fit in each bank artifact',
        'banks': [], 'synthesisRequests': 0}
    if not usable:
        return metadata, []
    if not hypotheses:
        raise ValueError('Motion forward bank requires declared hypotheses')
    anchors = pitch_anchors([_values(row['measurement'])['pitchHz']['value'] for row in usable])
    per_bank = len(hypotheses)*len(JA_GRID)*len(GAIN_GRID)
    # Declared before any synthesis: the joint and fixed-anatomy models each synthesize every candidate once per anchor.
    requested = 2*per_bank*len(anchors)
    if requested > MAX_SYNTHESIS_CALLS:
        raise ValueError(f'Motion forward bank would request {requested} syntheses; the limit is {MAX_SYNTHESIS_CALLS}')
    metadata.update(pitchAnchorsHz=anchors, synthesisRequests=requested)
    banks = []
    for anchor_index, pitch in enumerate(anchors):
        representative = min(usable, key=lambda row: abs(_values(row['measurement'])['pitchHz']['value'] - pitch))
        identity = f'anchor-{anchor_index}'
        document = {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': [dict(
            id=identity, pose=pose, measurement=representative['measurement'], sample_rate_hz=sample_rate,
            frame_start_sample=frame_start, frame_size=frame_size, duration_s=.25)]}
        candidates = [dict(candidate_id=f'{h["hypothesis_id"]}:JA{ja}:gain{gain}', anatomy=h['anatomy'],
            trials={identity: dict(JA=ja, f0_hz=pitch, gain=gain)})
            for h in hypotheses for ja in JA_GRID for gain in GAIN_GRID]
        row = {'pitchHz': pitch, 'representativeWindow': representative['index']}
        try:
            fitted = fitter(engine, document, candidates=candidates, max_synthesis_calls=2*len(candidates), objective=COARSE_OBJECTIVE)
        except (ValueError, RuntimeError) as error:
            fitted = None
            row.update(status='failed', reason=str(error))
        if fitted is not None and (not fitted.get('canonical_extractor') or not fitted.get('native_provenance')):
            fitted = None
            row.update(status='unverified', reason='Native bank lacks verified canonical prediction provenance')
        if fitted is not None:
            row.update(status='available', sha256=_hash(fitted), artifact=f'bank-{anchor_index}.json', candidates=_bank_table(fitted))
        banks.append(fitted)
        metadata['banks'].append(row)
    available = [fitted for fitted in banks if fitted is not None]
    if available:
        metadata['comparisonSha256'] = _hash([available[0]['canonical_extractor'], available[0]['native_provenance'],
            COARSE_OBJECTIVE, SCALE_POLICY, {name: unit for name, (unit, _) in FEATURES.items()}])
    for row in usable:
        target = _values(row['measurement'])
        pitch = target['pitchHz']['value']
        bank_index = min(range(len(anchors)), key=lambda i: (abs(math.log2(pitch/anchors[i])), anchors[i]))
        distance = 1200 * math.log2(pitch/anchors[bank_index])
        row.update(pitchAnchorHz=anchors[bank_index], pitchDistanceCents=distance)
        bank = metadata['banks'][bank_index]
        if bank['status'] != 'available':
            row.update(status='insufficient-quality' if bank['status'] == 'unverified' else 'unavailable', reason=bank['reason'])
            continue
        if abs(distance) > MAX_PITCH_DISTANCE_CENTS:
            row.update(status='unavailable', reason='Measured pitch outside the one-semitone bank support')
            continue
        scales = window_scales(row['measurement'])
        score = {'kind': banks[bank_index]['kind'], 'identifiability': banks[bank_index]['identifiability'],
            'bankIndex': bank_index, 'bankSha256': bank['sha256'], 'comparisonSha256': metadata['comparisonSha256'],
            'objective': COARSE_OBJECTIVE, 'featureScales': scales}
        for model, table in bank['candidates'].items():
            candidates = []
            # Every comparator row uses the one reference anatomy, stated once per window.
            anatomy = model == 'joint'
            for entry in table:
                predicted = entry['predictedFeatures']
                missing = [{'feature': name, 'reason': 'Unavailable comparable descriptor'}
                           for name in FEATURES if target[name]['value'] is None or predicted[name] is None]
                flags = sorted(set(entry['qualityFlags']) & {'clipping', 'invalid', 'dropped', 'low-signal-to-noise'})
                if flags:
                    missing.append({'feature': 'prediction-quality', 'reason': 'Predicted PCM flagged: ' + ', '.join(flags)})
                candidates.append({'candidate_id': entry['candidate_id'], **({'anatomySha256': entry['anatomySha256']} if anatomy else {}),
                    'JA': entry['JA'], 'gain': entry['gain'], 'status': 'missing_predicted_features' if missing else 'scored',
                    'weighted_mean_square_discrepancy': None if missing else sum(
                        ((predicted[name]-target[name]['value'])/scales[name]['scale'])**2 for name in FEATURES)/len(FEATURES),
                    **({'missing_features': missing} if missing else {})})
            valid = [candidate for candidate in candidates if candidate['status'] == 'scored']
            score[model] = {'candidates': candidates,
                'best': min(valid, key=lambda item: (item['weighted_mean_square_discrepancy'], item['candidate_id'])) if valid else None,
                **({} if anatomy else {'anatomySha256': table[0]['anatomySha256'] if table else None})}
        row.update(fit=score, status='scored' if score['joint']['best'] else 'insufficient-quality',
            reason=None if score['joint']['best'] else 'No complete comparable native predictions')
    return metadata, banks
