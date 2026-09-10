"""Conditional finite-candidate inverse fitting through the canonical PCM extractor.

Coarse descriptors cannot identify physiology; this ranks explicit hypotheses
under fixed source physics and scalar gain, not an unknown room transfer filter.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np

from .engine import Engine, finite

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
                'syncUncertaintyMs': 0, 'referenceClockId': None, 'offsetToReferenceMs': None},
            'qualityFlags': ['not-microphone-calibrated'] if source_kind == 'engine-generated' else []}}, node_binary)


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


def fit_pcm(engine: Engine, document, *, candidates, max_synthesis_calls=128, node_binary=None):
    """Rank finite hypotheses and a fixed-anatomy baseline at equal actual compute.

    Each candidate supplies global anatomy overrides plus per-trial JA, f0_hz and
    positive scalar gain. Inputs contain calibration trials only. Freeze this result
    before independently extracting/scoring held-out evidence.
    """
    document, candidates = deepcopy(document), deepcopy(candidates)
    if not isinstance(document, dict) or set(document) != {'schema_version', 'kind', 'trials'} or document.get('schema_version') != '0.1.0' or document.get('kind') != 'canonical_pcm_observations':
        raise ValueError('Unsupported PCM observation document')
    trials = document['trials']
    if not isinstance(trials, list) or not 1 <= len(trials) <= 10:
        raise ValueError('Require 1-10 calibration trials')
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 32:
        raise ValueError('Require 1-32 predeclared candidates')
    if type(max_synthesis_calls) is not int or not 1 <= max_synthesis_calls <= 640:
        raise ValueError('Invalid synthesis budget')
    required_calls = 2*len(candidates)*len(trials)
    if required_calls > max_synthesis_calls:
        raise ValueError('Predeclared candidates exceed equal-model synthesis budget')
    ids, evidence_ids, targets = [], [], {}
    for trial in trials:
        if not isinstance(trial, dict) or set(trial) != {'id', 'pose', 'measurement', 'sample_rate_hz', 'frame_start_sample', 'frame_size', 'duration_s'}:
            raise ValueError('Invalid PCM trial fields')
        if not isinstance(trial['id'], str) or not trial['id'].strip() or trial['pose'] not in engine.poses:
            raise ValueError('Invalid trial ID or pose')
        ids.append(trial['id'])
        if trial['sample_rate_hz'] != engine.sample_rate or type(trial['sample_rate_hz']) is not int:
            raise ValueError('Current PCM profile requires native 44100 Hz; resampling is unsupported')
        if type(trial['frame_size']) is not int or trial['frame_size'] != 4096:
            raise ValueError('44100 Hz canonical frame requires 4096 samples')
        start = trial['frame_start_sample']
        duration = finite(trial['duration_s'], 'duration_s')
        if type(start) is not int or start < 0 or not .1 <= duration <= 5 or start+4096 > round(duration*engine.sample_rate):
            raise ValueError('PCM frame lies outside synthesis duration')
        record = trial['measurement']
        evidence_ids.append(record.get('id') if isinstance(record, dict) else None)
    if len(set(ids)) != len(ids) or len(set(evidence_ids)) != len(evidence_ids):
        raise ValueError('Duplicate trial or measurement ID')
    extractor = _bridge({'operation': 'validate', 'records': [t['measurement'] for t in trials]}, node_binary)
    intervals = set()
    for trial in trials:
        record = trial['measurement']
        window = record['window']
        if not np.isclose(window['endMs']-window['startMs'], 4096/engine.sample_rate*1000, rtol=0, atol=1e-6):
            raise ValueError('Canonical observation window length mismatch')
        if not np.isclose(window['startMs'], trial['frame_start_sample']/engine.sample_rate*1000, rtol=0, atol=1e-6):
            raise ValueError('Canonical observation window offset mismatch')
        interval = (tuple(sorted(record['provenance']['sourceHashes'])), window['startMs'], window['endMs'])
        if interval in intervals:
            raise ValueError('Duplicate source audio interval')
        intervals.add(interval)
        targets[trial['id']] = _features(record)
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
    saved = engine.anatomy()
    results = {'joint': [], 'fixed_anatomy_baseline': []}
    calls = 0
    try:
        # Validate all geometry proposals before consuming compute.
        for candidate in candidates:
            engine.set_anatomy(candidate['anatomy'])
        for model, rows in results.items():
            for candidate in candidates:
                engine.set_anatomy(candidate['anatomy'] if model == 'joint' else {})
                residuals, predictions, missing = [], [], []
                for trial in trials:
                    if calls >= max_synthesis_calls:
                        raise RuntimeError('Hard native synthesis budget exhausted')
                    control = candidate['trials'][trial['id']]
                    calls += 1
                    pcm = engine.synthesize(trial['pose'], {'JA': control['JA']},
                        f0_hz=control['f0_hz'], duration_s=trial['duration_s'])
                    start = trial['frame_start_sample']
                    frame = pcm[start:start+4096]*control['gain']
                    canonical = extract_pcm(frame, engine.sample_rate,
                        measurement_id=f'{model}-{candidate["candidate_id"]}-{trial["id"]}',
                        observation_id=trial['id'], artifact_id='native-pcm',
                        start_ms=start/engine.sample_rate*1000, node_binary=node_binary)
                    if any(canonical[k] != extractor[k] for k in ('extractorSha256', 'contractsSha256', 'extractorVersion', 'contractVersion')):
                        raise RuntimeError('Canonical extractor changed during fitting')
                    if 'clipping' in canonical['measurement']['quality']['flags']:
                        missing.append({'trial_id': trial['id'], 'reason': 'predicted_pcm_clipping'})
                        predictions.append({'trial_id': trial['id'], 'canonical': canonical, 'controls': control})
                        continue
                    predicted = _features(canonical['measurement'])
                    for name, target in targets[trial['id']].items():
                        if target['value'] is None:
                            continue
                        value = predicted[name]['value']
                        if value is None:
                            missing.append({'trial_id': trial['id'], 'feature': name, 'reason': predicted[name]['missingReason']})
                            continue
                        scale = max(FEATURES[name][1], target['uncertainty'] or 0.)
                        residuals.append((value-target['value'])/scale)
                    predictions.append({'trial_id': trial['id'], 'canonical': canonical,
                        'controls': control, 'applied_articulation': engine.pose(trial['pose'], {'JA': control['JA']})[1]})
                rows.append({'candidate_id': candidate['candidate_id'], 'anatomy': engine.anatomy(),
                    'status': 'missing_predicted_features' if missing else 'scored',
                    'weighted_mean_square_discrepancy': None if missing else float(np.mean(np.square(residuals))),
                    'missing_features': missing, 'predictions': predictions})
    finally:
        engine.set_anatomy(saved)
    for model, rows in results.items():
        ranked = sorted([r for r in rows if r['status'] == 'scored'], key=lambda r: r['weighted_mean_square_discrepancy'])
        results[model] = {'candidates': rows, 'best': ranked[0] if ranked else None,
                          'actual_synthesis_calls': len(candidates)*len(trials)}
    return {'schema_version': '0.1.0', 'kind': 'conditional_pcm_candidate_fit', **results,
        'observation_sha256': _hash(document), 'candidate_grid_sha256': _hash(candidates),
        'evidence_ids': evidence_ids, 'actual_synthesis_calls': calls, 'max_synthesis_calls': max_synthesis_calls,
        'canonical_extractor': extractor, 'native_provenance': dict(engine.provenance),
        'feature_scales': {k: {'unit': unit, 'scale': scale} for k, (unit, scale) in FEATURES.items()},
        'objective_interpretation': 'weighted coarse-descriptor discrepancy, not calibrated likelihood',
        'identifiability': 'not_established', 'human_interpretation': 'conditional_physiological_hypotheses_only',
        'unsupported': ['unknown_room_filter', 'unknown_microphone_response', 'physiology_identification', 'calibrated_posterior'],
        'source_artifact_bytes_verified': False,
        'source_assumptions': 'native geometric glottis; explicit F0 and JA; stationary vowel; scalar gain only'}
