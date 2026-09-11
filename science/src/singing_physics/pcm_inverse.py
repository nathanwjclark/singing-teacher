"""Conditional finite-candidate inverse fitting through the canonical PCM extractor.

Coarse descriptors cannot identify physiology; this ranks explicit hypotheses
under fixed source physics and scalar gain, not an unknown room transfer filter.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess

import numpy as np
import scipy
from scipy.signal import resample_poly

from .engine import Engine, finite
from .pcm_spectral import COARSE_OBJECTIVE, OPTIONAL_TRIAL_FIELDS, SPECTRAL_OBJECTIVE, objective_policy, extract_spectral, validate_observation, discrepancy

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = ROOT/'science/scripts/extract_pcm.ts'
FEATURES = {'dbfs': ('dBFS', 3.), 'centroidHz': ('Hz', 250.), 'flatness': ('ratio', .1),
            'pitchHz': ('Hz', 20.), 'periodicity': ('ratio', .1)}


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def _bridge(payload, node_binary):
    node = node_binary or shutil.which('node')
    if not node:
        raise RuntimeError('Node with TypeScript stripping is required for the canonical extractor')
    completed = subprocess.run([str(node), '--experimental-strip-types', str(BRIDGE)],
        input=json.dumps(payload, allow_nan=False), capture_output=True, text=True, timeout=30)
    if completed.returncode:
        raise ValueError('Canonical PCM bridge rejected input: '+completed.stderr[-2000:])
    return json.loads(completed.stdout)


def extract_pcm(audio, sample_rate_hz, *, measurement_id, observation_id, artifact_id,
                start_ms=0., source_kind='engine-generated', node_binary=None):
    """Return B's AudioMeasurement for a complete canonical float32 frame."""
    values = np.asarray(audio, dtype=np.float32)
    if values.ndim != 1 or not np.isfinite(values).all():
        raise ValueError('PCM must be finite mono audio')
    if source_kind not in ('engine-generated', 'human-observation', 'development-fixture'):
        raise ValueError('Unsupported PCM source kind')
    return _bridge({'operation': 'extract', 'pcm': values.tolist(), 'sampleRate': sample_rate_hz,
        'metadata': {'id': measurement_id, 'observationId': observation_id, 'artifactId': artifact_id,
            'startMs': start_ms, 'sourceKind': source_kind,
            'timebase': {'clockId': observation_id+'-samples', 'origin': 'session-start', 'unit': 'ms',
                'syncUncertaintyMs': 0 if source_kind == 'engine-generated' else None, 'referenceClockId': None, 'offsetToReferenceMs': None},
            'qualityFlags': ['not-microphone-calibrated'] if source_kind == 'engine-generated' else []}}, node_binary)


def resample_native_pcm(audio, native_rate, target_rate):
    """Resample only generated PCM; preserve observed recording samples untouched."""
    if type(native_rate) is not int or native_rate != 44100 or type(target_rate) is not int or target_rate not in (44100, 48000, 96000):
        raise ValueError('Supported PCM rates are native 44100 and observed 44100/48000/96000 Hz')
    values = np.asarray(audio, dtype=float)
    if values.ndim != 1 or not len(values) or not np.isfinite(values).all():
        raise ValueError('Resampling requires finite mono PCM')
    divisor = math.gcd(native_rate, target_rate)
    up, down = target_rate//divisor, native_rate//divisor
    result = values.copy() if up == down else resample_poly(values, up, down, window=('kaiser', 5.0), padtype='constant')
    return result, {'source_rate_hz': native_rate, 'target_rate_hz': target_rate,
        'up': up, 'down': down, 'method': 'identity' if up == down else 'scipy.signal.resample_poly',
        'window': ['kaiser', 5.0] if up != down else None, 'padtype': 'constant' if up != down else None,
        'scipy_version': scipy.__version__, 'observations_resampled': False}


def _features(record):
    if record.get('method') != 'pcm-blackman-power-yin/1.1.0' or record.get('provenance', {}).get('producerVersion') != '1.1.0':
        raise ValueError('Unsupported canonical extractor version')
    if record['provenance']['kind'] != 'derived-measurement' or record['provenance']['producer'] not in {
            'singing-teacher/audio/'+kind for kind in ('human-observation', 'engine-generated', 'development-fixture')}:
        raise ValueError('Unsupported canonical measurement producer')
    if set(record['provenance']['sourceIds']) != {record['observationId'], record['artifactId']}:
        raise ValueError('Canonical source IDs do not bind the observation and artifact')
    if not record['provenance']['sourceHashes']:
        raise ValueError('Audio observations require source artifact hashes')
    if record['quality']['missingReason'] is not None or set(record['quality']['flags']) & {'clipping', 'invalid', 'dropped', 'low-signal-to-noise'}:
        raise ValueError('Invalid or clipped audio cannot constrain the model')
    features = {}
    for measurement in record['measurements']:
        name = measurement['name']
        if name in features:
            raise ValueError('Duplicate canonical feature')
        if name in FEATURES:
            if measurement['unit'] != FEATURES[name][0]:
                raise ValueError('Canonical feature units mismatch')
            value = measurement['value']
            bounds = {'dbfs': (-100., 0.), 'centroidHz': (80., 10000.),
                      'flatness': (0., 1.), 'pitchHz': (65., 1100.), 'periodicity': (0., 1.)}
            if value is not None and not bounds[name][0] <= value <= bounds[name][1]:
                raise ValueError('Canonical feature outside extractor domain')
            features[name] = measurement
    if set(features) != set(FEATURES):
        raise ValueError('Canonical descriptor fields must be present, with explicit missing reasons')
    return features


def _synthesis_key(candidate, trial):
    control = candidate['trials'][trial['id']]
    return _hash([candidate['anatomy'], trial['pose'], float(control['JA']), float(control['f0_hz']), float(trial['duration_s'])])


def planned_synthesis_calls(document, candidates):
    """Native synthesis calls fit_pcm makes for each model with these candidates.

    Gain multiplies the frame after synthesis, so candidates that differ only by
    gain share one synthesized waveform. The fixed-anatomy baseline reuses exactly
    where the joint model does, which keeps the two models' literal calls equal.
    """
    return len({_synthesis_key(candidate, trial) for candidate in candidates for trial in document['trials']})


def score_prediction(frame, trial, target, *, objective, measurement_id, node_binary=None):
    """Extract one predicted frame and score it against one validated calibration trial.

    `target` is `_features(trial['measurement'])`. Clipped predictions stay missing.
    fit_pcm and independent evaluations use this so both score with the same code.
    """
    start = trial['frame_start_sample']
    canonical = extract_pcm(frame, trial['sample_rate_hz'], measurement_id=measurement_id,
        observation_id=trial['id'], artifact_id='native-pcm',
        start_ms=start/trial['sample_rate_hz']*1000, node_binary=node_binary)
    if 'clipping' in canonical['measurement']['quality']['flags']:
        return {'canonical': canonical, 'clipped': True, 'spectral_observation': None, 'objective_components': None,
                'residuals': [], 'missing': [{'trial_id': trial['id'], 'reason': 'predicted_pcm_clipping'}]}
    predicted = _features(canonical['measurement'])
    spectral, components, residuals, missing = None, None, [], []
    if objective == SPECTRAL_OBJECTIVE:
        try:
            spectral = extract_spectral(frame, trial['sample_rate_hz'],
                source_artifact_hashes=canonical['measurement']['provenance']['sourceHashes'], source_artifact_id='native-pcm', frame_start_sample=start)
            components = discrepancy(spectral, trial['spectral_observation'],
                predicted_features={k: v['value'] for k, v in predicted.items()},
                observed_features={k: v['value'] for k, v in target.items()})
        except ValueError as exc:
            missing.append({'trial_id': trial['id'], 'reason': str(exc)})
    for name, observed in target.items():
        if observed['value'] is None:
            continue
        value = predicted[name]['value']
        if value is None:
            missing.append({'trial_id': trial['id'], 'feature': name, 'reason': predicted[name]['missingReason']})
            continue
        scale = max(FEATURES[name][1], observed['uncertainty'] or 0.)
        residuals.append((value-observed['value'])/scale)
    return {'canonical': canonical, 'clipped': False, 'spectral_observation': spectral,
            'objective_components': components, 'residuals': residuals, 'missing': missing}


def candidate_discrepancy(scored, objective):
    """Combine one candidate's per-trial scores; any missing trial leaves it unscored."""
    missing = [row for item in scored for row in item['missing']]
    if missing:
        return None, missing
    if objective == SPECTRAL_OBJECTIVE:
        return float(np.mean([item['objective_components']['mean_square'] for item in scored])), []
    return float(np.mean(np.square([r for item in scored for r in item['residuals']]))), []


def fit_pcm(engine: Engine, document, *, candidates, max_synthesis_calls=128, node_binary=None, objective=COARSE_OBJECTIVE):
    """Rank finite hypotheses and a fixed-anatomy baseline at equal actual compute.

    Each candidate supplies global anatomy overrides plus per-trial JA, f0_hz and
    positive scalar gain. Inputs contain calibration trials only. Freeze this result
    before independently extracting/scoring held-out evidence.
    """
    document, candidates = deepcopy(document), deepcopy(candidates)
    policy = objective_policy(objective)
    if not isinstance(document, dict) or set(document) != {'schema_version', 'kind', 'trials'} or document.get('schema_version') != '0.1.0' or document.get('kind') != 'canonical_pcm_observations':
        raise ValueError('Unsupported PCM observation document')
    trials = document['trials']
    if not isinstance(trials, list) or not 1 <= len(trials) <= 10:
        raise ValueError('Require 1-10 calibration trials')
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 32:
        raise ValueError('Require 1-32 predeclared candidates')
    if type(max_synthesis_calls) is not int or not 1 <= max_synthesis_calls <= 640:
        raise ValueError('Invalid synthesis budget')
    ids, evidence_ids, targets = [], [], {}
    for trial in trials:
        if not isinstance(trial, dict) or set(trial)-OPTIONAL_TRIAL_FIELDS != {'id', 'pose', 'measurement', 'sample_rate_hz', 'frame_start_sample', 'frame_size', 'duration_s'}:
            raise ValueError('Invalid PCM trial fields')
        if not isinstance(trial['id'], str) or not trial['id'].strip() or trial['pose'] not in engine.poses:
            raise ValueError('Invalid trial ID or pose')
        ids.append(trial['id'])
        if type(trial['sample_rate_hz']) is not int or trial['sample_rate_hz'] not in (44100, 48000, 96000):
            raise ValueError('Supported observation rates are 44100, 48000 and 96000 Hz')
        if type(trial['frame_size']) is not int or not 256 <= trial['frame_size'] <= 32768:
            raise ValueError('Invalid canonical frame size')
        start = trial['frame_start_sample']
        duration = finite(trial['duration_s'], 'duration_s')
        if type(start) is not int or start < 0 or not .1 <= duration <= 5 or start+trial['frame_size'] > round(duration*trial['sample_rate_hz']):
            raise ValueError('PCM frame lies outside synthesis duration')
        record = trial['measurement']
        evidence_ids.append(record.get('id') if isinstance(record, dict) else None)
    if len(set(ids)) != len(ids) or len(set(evidence_ids)) != len(evidence_ids):
        raise ValueError('Duplicate trial or measurement ID')
    extractor = _bridge({'operation': 'validate', 'records': [t['measurement'] for t in trials],
        'sampleRates': sorted({t['sample_rate_hz'] for t in trials})}, node_binary)
    frame_sizes = {p['sampleRate']: p['frameSize'] for p in extractor['audioProfiles']}
    intervals = set()
    for trial in trials:
        record = trial['measurement']
        window = record['window']
        if trial['frame_size'] != frame_sizes[trial['sample_rate_hz']]:
            raise ValueError('Frame size does not match canonical audioFrameSize for sample rate')
        if not np.isclose(window['endMs']-window['startMs'], trial['frame_size']/trial['sample_rate_hz']*1000, rtol=0, atol=1e-6):
            raise ValueError('Canonical observation window length mismatch')
        if not np.isclose(window['startMs'], trial['frame_start_sample']/trial['sample_rate_hz']*1000, rtol=0, atol=1e-6):
            raise ValueError('Canonical observation window offset mismatch')
        interval_keys = {('hash', digest, window['startMs'], window['endMs'])
                         for digest in record['provenance']['sourceHashes']}
        interval_keys.add(('artifact', record['artifactId'], window['startMs'], window['endMs']))
        if 'frame_sha256' in trial:
            interval_keys.add(('frame', trial['frame_sha256']))
        if intervals.intersection(interval_keys):
            raise ValueError('Duplicate source audio interval')
        intervals.update(interval_keys)
        targets[trial['id']] = _features(record)
        validate_observation(trial)
        if objective == SPECTRAL_OBJECTIVE and 'spectral_observation' not in trial:
            raise ValueError('Spectral objective requires exact-frame spectral observations; reimport original PCM')
        if sum(m['value'] is not None for m in targets[trial['id']].values()) < 3:
            raise ValueError('Insufficient observed canonical descriptors')
    candidate_ids = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or set(candidate) != {'candidate_id', 'anatomy', 'trials'}:
            raise ValueError('Invalid candidate fields')
        if not isinstance(candidate['candidate_id'], str) or not candidate['candidate_id'].strip():
            raise ValueError('Invalid candidate ID')
        candidate_ids.append(candidate['candidate_id'])
        if not isinstance(candidate['anatomy'], dict) or set(candidate['trials']) != set(ids):
            raise ValueError('Candidate must declare anatomy and controls for each trial')
        for control in candidate['trials'].values():
            if not isinstance(control, dict) or set(control) != {'JA', 'f0_hz', 'gain'}:
                raise ValueError('Explicit JA, f0_hz and gain are required')
            ja, pitch, gain = [finite(control[k], k) for k in ('JA', 'f0_hz', 'gain')]
            if not -5 <= ja <= -1 or not 65 <= pitch <= 1000 or not .001 <= gain <= 100:
                raise ValueError('PCM controls outside bounded supported domain')
    if len(set(candidate_ids)) != len(candidate_ids):
        raise ValueError('Duplicate candidate IDs')
    per_model = planned_synthesis_calls(document, candidates)
    if 2*per_model > max_synthesis_calls:
        raise ValueError('Predeclared candidates exceed equal-model synthesis budget')
    saved = engine.anatomy()
    results = {'joint': [], 'fixed_anatomy_baseline': []}
    calls, model_calls = 0, {}
    try:
        # Validate all geometry proposals before consuming compute.
        for candidate in candidates:
            engine.set_anatomy(candidate['anatomy'])
        for model, rows in results.items():
            waveforms = {}
            model_calls[model] = 0
            for candidate in candidates:
                engine.set_anatomy(candidate['anatomy'] if model == 'joint' else {})
                scored, predictions = [], []
                for trial in trials:
                    control = candidate['trials'][trial['id']]
                    key = _synthesis_key(candidate, trial)
                    if key not in waveforms:
                        if calls >= max_synthesis_calls:
                            raise RuntimeError('Hard native synthesis budget exhausted')
                        calls += 1
                        model_calls[model] += 1
                        waveforms[key] = engine.synthesize(trial['pose'], {'JA': control['JA']},
                            f0_hz=control['f0_hz'], duration_s=trial['duration_s'])
                    pcm, resampling = resample_native_pcm(waveforms[key], engine.sample_rate, trial['sample_rate_hz'])
                    start = trial['frame_start_sample']
                    frame = pcm[start:start+trial['frame_size']]*control['gain']
                    item = score_prediction(frame, trial, targets[trial['id']], objective=objective, node_binary=node_binary,
                        measurement_id=f'{model}-{candidate["candidate_id"]}-{trial["id"]}')
                    if any(item['canonical'][k] != extractor[k] for k in ('extractorSha256', 'contractsSha256', 'extractorVersion', 'contractVersion')):
                        raise RuntimeError('Canonical extractor changed during fitting')
                    scored.append(item)
                    prediction = {'trial_id': trial['id'], 'canonical': item['canonical'], 'controls': control, 'resampling': resampling}
                    if not item['clipped']:
                        prediction.update(spectral_observation=item['spectral_observation'], objective_components=item['objective_components'],
                                          applied_articulation=engine.pose(trial['pose'], {'JA': control['JA']})[1])
                    predictions.append(prediction)
                discrepancy_value, missing = candidate_discrepancy(scored, objective)
                rows.append({'candidate_id': candidate['candidate_id'], 'anatomy': engine.anatomy(),
                    'status': 'missing_predicted_features' if missing else 'scored',
                    'weighted_mean_square_discrepancy': discrepancy_value,
                    'missing_features': missing, 'predictions': predictions})
    finally:
        engine.set_anatomy(saved)
    for model, rows in results.items():
        ranked = sorted([r for r in rows if r['status'] == 'scored'], key=lambda r: r['weighted_mean_square_discrepancy'])
        results[model] = {'candidates': rows, 'best': ranked[0] if ranked else None,
                          'actual_synthesis_calls': model_calls[model], 'evaluated_predictions': len(candidates)*len(trials)}
    return {'schema_version': '0.1.0', 'kind': 'conditional_pcm_candidate_fit', **results,
        'observation_sha256': _hash(document), 'candidate_grid_sha256': _hash(candidates),
        'evidence_ids': evidence_ids, 'actual_synthesis_calls': calls, 'max_synthesis_calls': max_synthesis_calls,
        'canonical_extractor': extractor, 'native_provenance': dict(engine.provenance),
        'feature_scales': {k: {'unit': unit, 'scale': scale} for k, (unit, scale) in FEATURES.items()},
        'synthesis_reuse': 'One native waveform per candidate anatomy, pose, JA, F0 and duration; gain-only variants reuse it and scale the frame after synthesis',
        'objective':objective, 'objective_policy':policy,
        'objective_interpretation': 'bounded spectral shape/level/pitch/periodicity discrepancy, not calibrated likelihood' if objective == SPECTRAL_OBJECTIVE else 'weighted coarse-descriptor discrepancy, not calibrated likelihood',
        'identifiability': 'not_established', 'human_interpretation': 'conditional_physiological_hypotheses_only',
        'unsupported': ['unknown_room_filter', 'unknown_microphone_response', 'physiology_identification', 'calibrated_posterior'],
        'source_artifact_bytes_verified': False,
        'source_assumptions': 'native geometric glottis; explicit F0 and JA; stationary vowel; bounded empirical gain/tilt nuisance' if objective == SPECTRAL_OBJECTIVE else 'native geometric glottis; explicit F0 and JA; stationary vowel; scalar gain only'}
