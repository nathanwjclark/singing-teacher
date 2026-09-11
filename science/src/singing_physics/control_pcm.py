"""Prospective PCM control alternatives and empirical cue-execution support."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np

from .engine import Engine, finite
from .pcm_design import PROFILE, _snapshot, _profile, _extractor, _scales, _available
from .pcm_inverse import extract_pcm, resample_native_pcm
from .prediction import Artifact, _encode, _identity, _timestamp

VERSION = 'conditional-cue-execution-pcm-1'
MIN_ATTEMPTS = 3
SCALES = {'pitchHz': {'unit': 'Hz', 'scale': 20., 'assumption': 'Engineering descriptor scale, not measured noise'},
          'dbfs': {'unit': 'dBFS', 'scale': 3., 'assumption': 'Engineering descriptor scale, not measured noise'},
          'centroidHz': {'unit': 'Hz', 'scale': 150., 'assumption': 'Engineering descriptor scale, not measured noise'}}


def now(): return datetime.now(timezone.utc).isoformat()
def digest(value): return hashlib.sha256(_encode(value)).hexdigest()
def seal(value): return {'artifact': value, 'sha256': digest(value)}


def policy():
    return {'version': VERSION, 'module_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'minimum_matched_attempts': MIN_ATTEMPTS, 'attempt_weight': 'equal', 'uniform_pseudocount': 1.,
            'control_weight': 'exp(-0.5 * mean standardized squared descriptor residual)',
            'interpretation': 'Ambiguous simulator execution alternatives, not measured movement or a calibrated posterior'}


def anatomy_digest(snapshot):
    return digest(sorted(digest(h['anatomy']) for h in snapshot['hypotheses']))


def _cue(cue):
    fields = {'cue_id', 'cue_version', 'wording', 'wording_sha256', 'mode', 'pose'}
    if not isinstance(cue, dict) or set(cue) != fields: raise ValueError('Complete immutable cue binding required')
    for name in ('cue_id', 'cue_version'): _identity(cue[name], name)
    if not isinstance(cue['wording'], str) or not 1 <= len(cue['wording'].strip()) <= 2000:
        raise ValueError('Cue wording must be explicit and bounded')
    if hashlib.sha256(cue['wording'].encode()).hexdigest() != cue['wording_sha256']:
        raise ValueError('Cue wording digest mismatch')
    if cue['mode'] not in ('elicited', 'recalled', 'transfer') or cue['pose'] not in ('a', 'e', 'i', 'o', 'u'):
        raise ValueError('Unsupported cue mode or vowel')


def _controls(controls):
    if not isinstance(controls, list) or not 2 <= len(controls) <= 16: raise ValueError('Declare 2-16 finite execution alternatives')
    ids = set()
    for control in controls:
        if not isinstance(control, dict) or set(control) != {'control_id', 'JA', 'f0_hz', 'gain'}:
            raise ValueError('Execution alternative requires explicit JA, F0 and gain')
        _identity(control['control_id'], 'control_id')
        if control['control_id'] in ids: raise ValueError('Duplicate execution alternative')
        ids.add(control['control_id'])
        for key, low, high in [('JA', -5., -1.), ('f0_hz', 65., 1000.), ('gain', .001, 100.)]:
            if not low <= finite(control[key], key) <= high: raise ValueError('Execution control outside supported domain')
    if len({digest({k: v for k, v in row.items() if k != 'control_id'}) for row in controls}) != len(controls):
        raise ValueError('Execution alternatives must be physically distinct')


def _read(frozen, kind):
    if not isinstance(frozen, dict) or set(frozen) != {'artifact', 'sha256'} or digest(frozen['artifact']) != frozen['sha256']:
        raise ValueError('Control artifact integrity mismatch')
    value = frozen['artifact']
    if value.get('kind') != kind or value.get('version') != VERSION: raise ValueError('Unsupported control artifact')
    return value


def execution_support(history, compatibility, hypothesis_ids, control_ids):
    """Each distinct eligible attempt contributes equal total mass per anatomy."""
    matched, excluded, seen_ids, seen_hashes = [], [], set(), set()
    for receipt in history:
        row = _read(receipt, 'scored-control-pcm')
        reason = ('incompatible cue, context, anatomy or runtime' if row['compatibility_sha256'] != compatibility else
                  'attempt is not completely scorable' if row['status'] != 'scored' else None)
        if not reason and (row['attempt_id'] in seen_ids or set(row['observation_hashes']) & seen_hashes):
            raise ValueError('Execution history contains repeated physical evidence')
        if reason: excluded.append({'score_sha256': receipt['sha256'], 'reason': reason}); continue
        if set(row['control_support']) != set(hypothesis_ids) or any(set(row['control_support'][h]) != set(control_ids) for h in hypothesis_ids):
            raise ValueError('Execution history omitted declared support')
        seen_ids.add(row['attempt_id']); seen_hashes.update(row['observation_hashes']); matched.append(receipt)
    learned = len(matched) >= MIN_ATTEMPTS
    weights = {h: {c: 1 / len(control_ids) for c in control_ids} for h in hypothesis_ids}
    if learned:
        for h in hypothesis_ids:
            for c in control_ids:
                weights[h][c] = (weights[h][c] + sum(r['artifact']['control_support'][h][c] for r in matched)) / (1 + len(matched))
    result = {'kind': 'empirical-execution-support', 'version': VERSION, 'compatibility_sha256': compatibility,
              'status': 'empirical' if learned else 'uniform_insufficient_matches', 'matched_attempts': len(matched),
              'minimum_attempts': MIN_ATTEMPTS, 'weights': weights, 'training_score_sha256': [r['sha256'] for r in matched],
              'excluded': excluded, 'movement_measured': False, 'anatomy_updated': False}
    result['support_id'] = 'execution-support:' + digest(result)
    return result


def forecast_control_pcm(*, snapshot, cue, context, controls, target_id, source_design_id,
                         history=None, profile=None, feature_scales=None, max_synthesis_calls=96,
                         timeout_s=90., cancelled=None, node_binary=None):
    frozen = Artifact(_encode(snapshot)); data = _snapshot(frozen, frozen.sha256)
    _cue(cue); _controls(controls); _identity(target_id, 'target_id'); _identity(source_design_id, 'source_design_id')
    if target_id in data['evidence_ids']: raise ValueError('Control target aliases fitting evidence')
    if not isinstance(context, dict) or set(context) != {'capture_context_id', 'source_kind'}:
        raise ValueError('Confirm the capture context and evidence kind')
    _identity(context['capture_context_id'], 'capture_context_id')
    if context['source_kind'] not in ('engine-generated', 'human-observation', 'development-fixture'):
        raise ValueError('Unsupported evidence kind')
    profile = _profile(PROFILE if profile is None else profile)
    scales = deepcopy(SCALES if feature_scales is None else feature_scales); _scales(scales)
    if type(max_synthesis_calls) is not int or not 1 <= max_synthesis_calls <= 96:
        raise ValueError('Control synthesis budget must be at most 96')
    total = len(data['hypotheses']) * len(controls)
    if total > max_synthesis_calls: raise ValueError('Control budget cannot cover all anatomy and execution alternatives')
    if not 1 <= finite(timeout_s, 'timeout_s') <= 120: raise ValueError('Invalid control timeout')
    extractor = _extractor(node_binary, profile)
    compatibility = {'anatomy_sha256': anatomy_digest(data), 'native': data['provenance'], 'extractor': extractor,
                     'profile': profile, 'feature_scales': scales, 'cue': cue, 'context': context,
                     'controls': controls, 'policy': policy()}
    key = digest(compatibility)
    # Applied anatomy hashes survive ordinary model-ID changes and hypothesis renaming.
    hypothesis_ids = [digest(h['anatomy']) for h in data['hypotheses']]
    support = execution_support(history or [], key, hypothesis_ids, [c['control_id'] for c in controls])
    evidence_hashes = set(data['evidence_hashes']); evidence_ids = set(data['evidence_ids'])
    for receipt in history or []:
        row = _read(receipt, 'scored-control-pcm'); evidence_hashes.update(row['observation_hashes'])
        evidence_ids.update([row['target_id'], row['attempt_id'], row['artifact_id']])
    if target_id in evidence_ids: raise ValueError('Control target aliases prior execution evidence')
    rows, calls, started = [], 0, time.monotonic()
    with Engine() as engine:
        if engine.provenance != data['provenance']: raise ValueError('Control native provenance changed')
        for hypothesis, anatomy_sha in zip(data['hypotheses'], hypothesis_ids):
            engine.set_anatomy(hypothesis['anatomy'])
            for control in controls:
                row = {'hypothesis_id': hypothesis['hypothesis_id'], 'anatomy_sha256': anatomy_sha,
                       'control_id': control['control_id'], 'controls': deepcopy(control), 'features': None,
                       'weight': support['weights'][anatomy_sha][control['control_id']]}
                if (cancelled and cancelled()) or time.monotonic() - started > timeout_s:
                    row.update(status='stopped', reason='Control forecast cancelled or timed out')
                else:
                    try:
                        calls += 1
                        audio = engine.synthesize(cue['pose'], {'JA': control['JA']}, f0_hz=control['f0_hz'], duration_s=profile['duration_s'])
                        audio, resampling = resample_native_pcm(audio, engine.sample_rate, profile['sample_rate_hz'])
                        start = profile['frame_start_sample']; frame = audio[start:start + profile['frame_size']] * control['gain']
                        canonical = extract_pcm(frame, profile['sample_rate_hz'], measurement_id=target_id + ':' + str(len(rows)),
                                                observation_id=target_id, artifact_id='simulated-control-frame',
                                                start_ms=start / profile['sample_rate_hz'] * 1000, node_binary=node_binary)
                        if any(canonical[k] != extractor[k] for k in extractor): raise ValueError('Control extractor changed during forecast')
                        features, reason = _available(canonical, scales)
                        row.update(status='predicted' if features is not None else 'missing', reason=reason,
                                   features=features, canonical=canonical, resampling=resampling,
                                   applied_native_controls=engine.pose(cue['pose'], {'JA': control['JA']})[1])
                    except (ValueError, RuntimeError) as exc: row.update(status='failed', reason=str(exc))
                rows.append(row)
    predictions = []
    for hypothesis, anatomy_sha in zip(data['hypotheses'], hypothesis_ids):
        subset = [row for row in rows if row['anatomy_sha256'] == anatomy_sha]
        complete = all(row['status'] == 'predicted' for row in subset)
        predictions.append({'hypothesis_id': hypothesis['hypothesis_id'], 'anatomy_sha256': anatomy_sha,
            'status': 'predicted' if complete else 'incomplete',
            'features': {name: sum(row['features'][name] * row['weight'] for row in subset) for name in scales} if complete else None})
    return seal({'kind': 'frozen-control-pcm', 'version': VERSION, 'model_id': data['model_id'],
                 'snapshot_sha256': frozen.sha256, 'anatomy_sha256': anatomy_digest(data), 'source_design_id': source_design_id,
                 'target_id': target_id, 'sealed_at': now(), 'cue': deepcopy(cue), 'context': deepcopy(context),
                 'compatibility': compatibility, 'compatibility_sha256': key, 'profile': profile, 'feature_scales': scales,
                 'evidence_ids': sorted(evidence_ids), 'evidence_hashes': sorted(evidence_hashes),
                 'execution_support': support, 'alternatives': rows, 'conditional_predictions': predictions,
                 'actual_synthesis_calls': calls, 'declared_synthesis_calls': total, 'max_synthesis_calls': max_synthesis_calls,
                 'status': 'available' if all(r['status'] == 'predicted' for r in rows) else 'incomplete',
                 'model_updated': False, 'movement_measured': False})


def score_control_pcm(*, frozen, pcm, metadata, node_binary=None):
    data = _read(frozen, 'frozen-control-pcm'); profile = data['profile']; scales = data['feature_scales']
    if digest(data['compatibility']) != data['compatibility_sha256'] or data['compatibility']['policy'] != policy():
        raise ValueError('Control policy or compatibility binding changed')
    if _extractor(node_binary, profile) != data['compatibility']['extractor']: raise ValueError('Control extractor changed')
    with Engine() as engine:
        if engine.provenance != data['compatibility']['native']: raise ValueError('Control native provenance changed')
    for field in ('observationId', 'attemptId', 'artifactId', 'clockId'): _identity(metadata.get(field), field)
    if metadata['observationId'] != data['target_id']: raise ValueError('Control outcome must match prospective target')
    if metadata.get('sourceKind') != data['context']['source_kind']: raise ValueError('Control evidence kind changed')
    if not _timestamp(data['sealed_at']) < _timestamp(metadata.get('evidenceAt')) <= _timestamp(now()):
        raise ValueError('Control recording must follow forecast commitment')
    hashes = metadata.get('sourceHashes')
    if not isinstance(hashes, list) or not hashes or any(not isinstance(h, str) or len(h) != 64 or any(c not in '0123456789abcdef' for c in h) for h in hashes):
        raise ValueError('Original control source hashes required')
    values = np.asarray(pcm, dtype=np.float32)
    if values.shape != (profile['frame_size'],) or not np.isfinite(values).all(): raise ValueError('Control outcome needs exact finite PCM frame')
    frame_sha = hashlib.sha256(values.astype('<f4').tobytes()).hexdigest()
    if (set(hashes) | {frame_sha}) & set(data['evidence_hashes']) or any(metadata[k] in data['evidence_ids'] for k in ('observationId', 'attemptId', 'artifactId')):
        raise ValueError('Control outcome reuses previous physical evidence')
    canonical = extract_pcm(values, profile['sample_rate_hz'], measurement_id=data['target_id'] + ':control-canonical',
                            observation_id=data['target_id'], artifact_id=metadata['artifactId'],
                            start_ms=profile['frame_start_sample'] / profile['sample_rate_hz'] * 1000,
                            source_kind=metadata['sourceKind'], node_binary=node_binary)
    observed, missing = _available(canonical, scales)
    scores, support, residuals = [], {}, []
    for row in data['alternatives']:
        features = row['features']; complete = observed is not None and row['status'] == 'predicted'
        residual = {k: observed[k] - features[k] for k in scales} if complete else None
        score = float(np.mean([(residual[k] / scales[k]['scale']) ** 2 for k in scales])) if complete else None
        scores.append({'hypothesis_id': row['hypothesis_id'], 'anatomy_sha256': row['anatomy_sha256'],
                       'control_id': row['control_id'], 'status': 'scored' if complete else 'missing',
                       'reason': missing or row.get('reason'), 'standardized_mean_square': score, 'residual': residual})
    for prediction in data['conditional_predictions']:
        residuals.append({'anatomy_sha256': prediction['anatomy_sha256'],
            'residual': {k: observed[k] - prediction['features'][k] for k in scales} if observed is not None and prediction['features'] is not None else None})
        rows = [row for row in scores if row['anatomy_sha256'] == prediction['anatomy_sha256']]
        if all(row['status'] == 'scored' for row in rows):
            errors = np.array([row['standardized_mean_square'] for row in rows]); mass = np.exp(-.5 * (errors - errors.min())); mass /= mass.sum()
            support[prediction['anatomy_sha256']] = {row['control_id']: float(weight) for row, weight in zip(rows, mass)}
    return seal({'kind': 'scored-control-pcm', 'version': VERSION, 'forecast_sha256': frozen['sha256'],
                 'compatibility_sha256': data['compatibility_sha256'], 'model_id': data['model_id'],
                 'target_id': data['target_id'], 'attempt_id': metadata['attemptId'], 'artifact_id': metadata['artifactId'],
                 'observed_at': metadata['evidenceAt'], 'received_at': now(), 'observation_hashes': sorted(set(hashes) | {frame_sha}),
                 'canonical': canonical, 'alternatives': scores, 'control_support': support,
                 'status': 'scored' if all(row['status'] == 'scored' for row in scores) else 'unscorable',
                 'residual_summary': {'by_anatomy': residuals, 'scope': 'Observed minus frozen weighted acoustic prediction; no physical attribution or residual correction'},
                 'actual_synthesis_calls': 0, 'actual_extractions': 1, 'model_updated': False, 'movement_measured': False})
