"""Prospective PCM control banks and repeated-attempt execution support for delivered cues.

A bank is a finite set of simulator execution alternatives (jaw angle JA and F0)
declared for one exact delivered cue wording and context. Gain is one declared
acquisition nuisance for the whole bank, never an execution alternative. Control
weights are standardized-descriptor affinities under engineering scales; they are
not execution probabilities, measured movement or evidence about anatomy.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
import time

import numpy as np

from .control import _context as _conditions
from .engine import Engine, finite
from .pcm_design import PROFILE, SCORER_PIN, _available, _extractor, _hash as digest, _profile, _scales, _snapshot
from .pcm_inverse import FEATURES, extract_pcm, resample_native_pcm
from .prediction import _identity, _timestamp

VERSION = 'conditional-cue-execution-pcm-2'
MIN_ATTEMPTS = 3
MAX_SYNTHESIS_CALLS = 96
SOURCE_KINDS = ('engine-generated', 'human-observation', 'development-fixture')
# dBFS is deliberately absent: gain is fixed for the bank as an acquisition
# nuisance, so a level mismatch would otherwise be attributed to JA or F0.
SCALES = {name: {'unit': FEATURES[name][0], 'scale': FEATURES[name][1],
                 'assumption': 'Engineering descriptor scale, not measured noise'} for name in ('pitchHz', 'centroidHz', 'flatness')}
# Hashed once at import, like pcm_design.SCORER_PIN: the pin names the code this
# process runs. Any edit to this file changes the policy and so the compatibility
# key; earlier attempts are then excluded from learning rather than silently reused.
MODULE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def now(): return datetime.now(timezone.utc).isoformat()
def seal(value): return {'artifact': value, 'sha256': digest(value)}


def policy():
    return {'version': VERSION, 'module_sha256': MODULE_SHA256, 'scorer_implementation_pin': SCORER_PIN,
            'minimum_matched_attempts': MIN_ATTEMPTS, 'history_match': 'per applied-anatomy SHA-256 within one compatibility key',
            'attempt_weight': 'equal', 'uniform_pseudocount': 1.,
            'control_affinity': 'per anatomy, softmax over alternatives of -0.5 * sum of standardized squared descriptor residuals',
            'gain': 'one declared acquisition nuisance for the whole bank; not an execution alternative',
            'interpretation': 'Standardized-descriptor affinities under engineering scales; not execution probabilities, measured movement or a calibrated posterior'}


def _cue(cue):
    if not isinstance(cue, dict) or set(cue) != {'cue_id', 'cue_version', 'wording', 'wording_sha256', 'mode'}:
        raise ValueError('Complete immutable cue binding required')
    for name in ('cue_id', 'cue_version'): _identity(cue[name], name)
    if not isinstance(cue['wording'], str) or not 1 <= len(cue['wording'].strip()) <= 2000:
        raise ValueError('Cue wording must be explicit and bounded')
    if hashlib.sha256(cue['wording'].encode()).hexdigest() != cue['wording_sha256']:
        raise ValueError('Cue wording digest mismatch')
    if cue['mode'] not in ('elicited', 'recalled', 'transfer'): raise ValueError('Unsupported cue mode')
    return dict(cue)


def _context(context):
    if not isinstance(context, dict) or set(context) != {'capture_context_id', 'source_kind', 'pitch_hz', 'vowel', 'level', 'posture'}:
        raise ValueError('Context requires capture_context_id, source_kind, pitch_hz, vowel, level and posture')
    _identity(context['capture_context_id'], 'capture_context_id')
    if context['source_kind'] not in SOURCE_KINDS: raise ValueError('Unsupported evidence kind')
    conditions = _conditions({k: context[k] for k in ('pitch_hz', 'vowel', 'level', 'posture')})
    if conditions['vowel'] not in ('a', 'e', 'i', 'o', 'u'): raise ValueError('Unsupported vowel')
    return {**context, **conditions}


def bank_binding(*, cue, context, controls, gain):
    """Validate and normalize one immutable cue/context/bank declaration."""
    if not isinstance(controls, list) or not 2 <= len(controls) <= 16: raise ValueError('Declare 2-16 finite execution alternatives')
    bank, ids = [], set()
    for control in controls:
        if not isinstance(control, dict) or set(control) != {'control_id', 'JA', 'f0_hz'}:
            raise ValueError('Execution alternative requires only control_id, JA and F0; gain is a bank-wide nuisance')
        _identity(control['control_id'], 'control_id')
        if control['control_id'] in ids: raise ValueError('Duplicate execution alternative')
        ids.add(control['control_id'])
        row = {'control_id': control['control_id'], 'JA': finite(control['JA'], 'JA'), 'f0_hz': finite(control['f0_hz'], 'f0_hz')}
        if not -5. <= row['JA'] <= -1. or not 65. <= row['f0_hz'] <= 1000.: raise ValueError('Execution control outside supported domain')
        bank.append(row)
    if len({(row['JA'], row['f0_hz']) for row in bank}) != len(bank): raise ValueError('Execution alternatives must be physically distinct')
    if not .001 <= finite(gain, 'gain') <= 100.: raise ValueError('Declared gain outside supported domain')
    return {'cue': _cue(cue), 'context': _context(context), 'controls': bank, 'gain': float(gain)}


def _read(frozen, kind):
    if not isinstance(frozen, dict) or set(frozen) != {'artifact', 'sha256'} or digest(frozen['artifact']) != frozen['sha256']:
        raise ValueError('Control artifact integrity mismatch')
    value = frozen['artifact']
    if value.get('kind') != kind or value.get('version') != VERSION: raise ValueError('Unsupported control artifact')
    return value


def _eligible(history, compatibility):
    """Split sealed score receipts into matching and excluded; repeated evidence is an error."""
    if not isinstance(history, list): raise ValueError('Execution history must be a list of sealed score receipts')
    eligible, excluded, ids, hashes = [], [], set(), set()
    for receipt in history:
        row = _read(receipt, 'scored-control-pcm')
        if row['attempt_id'] in ids or set(row['observation_hashes']) & hashes:
            raise ValueError('Execution history contains repeated physical evidence')
        ids.add(row['attempt_id']); hashes.update(row['observation_hashes'])
        reason = ('incompatible cue, context, bank, gain, extractor, native runtime or policy' if row['compatibility_sha256'] != compatibility else
                  'no complete anatomy support: ' + str(row['reason']) if not row['control_support'] else None)
        if reason: excluded.append({'score_sha256': receipt['sha256'], 'attempt_id': row['attempt_id'], 'reason': reason})
        else: eligible.append(receipt)
    return eligible, excluded


def execution_support(history, compatibility, anatomy_shas, control_ids):
    """The only execution-frequency model: equal-weight averaging with one uniform pseudocount per anatomy."""
    eligible, excluded = _eligible(history, compatibility)
    uniform, anatomies = 1 / len(control_ids), {}
    for anatomy in anatomy_shas:
        rows = [r for r in eligible if anatomy in r['artifact']['control_support']]
        for r in rows:
            mass = r['artifact']['control_support'][anatomy]
            if set(mass) != set(control_ids) or any(finite(v, 'support') < 0 for v in mass.values()) or not np.isclose(sum(mass.values()), 1., rtol=0, atol=1e-9):
                raise ValueError('Execution history omitted or distorted declared support')
        learned = len(rows) >= MIN_ATTEMPTS
        weights = {c: (uniform + sum(r['artifact']['control_support'][anatomy][c] for r in rows)) / (1 + len(rows)) if learned else uniform for c in control_ids}
        top = max(weights.values())
        anatomies[anatomy] = {'status': 'empirical' if learned else 'uniform_insufficient_matches', 'matched_attempts': len(rows),
                              'weights': weights, 'leading_control_ids': sorted(c for c, w in weights.items() if w == top),
                              'training_score_sha256': [r['sha256'] for r in rows]}
    learned = [a for a in anatomies.values() if a['status'] == 'empirical']
    return {'kind': 'empirical-execution-support', 'version': VERSION, 'compatibility_sha256': compatibility,
            'status': 'empirical' if len(learned) == len(anatomies) else 'partially_empirical' if learned else 'uniform_insufficient_matches',
            'minimum_attempts': MIN_ATTEMPTS, 'eligible_attempts': len(eligible), 'by_anatomy': anatomies,
            # Different anatomies preferring different controls means JA/F0 trade off against anatomy.
            'anatomy_control_tradeoff': len({tuple(a['leading_control_ids']) for a in learned}) > 1,
            'excluded': excluded, 'movement_measured': False, 'anatomy_updated': False}


def residual_calibration(history, compatibility, anatomy_shas, scales):
    """Observed minus earlier frozen weighted predictions; reported only, never applied."""
    eligible, _ = _eligible(history, compatibility)
    anatomies = {}
    for anatomy in anatomy_shas:
        residuals = [row['residual'] for r in eligible for row in r['artifact']['residual_summary']['by_anatomy']
                     if row['anatomy_sha256'] == anatomy and row['residual'] is not None]
        count = len(residuals)
        anatomies[anatomy] = {'status': 'empirical' if count >= MIN_ATTEMPTS else 'insufficient', 'count': count,
            'features': {name: {'unit': scales[name]['unit'], 'mean': float(np.mean([r[name] for r in residuals])) if count else None,
                                'sd': float(np.std([r[name] for r in residuals], ddof=1)) if count >= 2 else None} for name in scales}}
    return {'kind': 'empirical-residual-calibration', 'version': VERSION, 'compatibility_sha256': compatibility,
            'minimum_attempts': MIN_ATTEMPTS, 'by_anatomy': anatomies, 'applied_to_weights': False, 'applied_to_predictions': False,
            'scope': 'Microphone descriptor residuals against earlier frozen weighted predictions. Those forecasts used different '
                     'execution weights, so this is not stationary measurement noise and it is not inferred physical execution.'}


def forecast_control_pcm(snapshot, *, expected_digest, cue, context, controls, gain, target_id, history,
                         profile=None, feature_scales=None, max_synthesis_calls=MAX_SYNTHESIS_CALLS, timeout_s=90., node_binary=None):
    """Freeze every anatomy x execution alternative before the attempt, weighted by matched history."""
    data = _snapshot(snapshot, expected_digest)
    binding = bank_binding(cue=cue, context=context, controls=controls, gain=gain)
    _identity(target_id, 'target_id')
    profile = _profile(PROFILE if profile is None else profile)
    scales = deepcopy(SCALES if feature_scales is None else feature_scales); _scales(scales)
    if type(max_synthesis_calls) is not int or not 1 <= max_synthesis_calls <= MAX_SYNTHESIS_CALLS:
        raise ValueError(f'Control synthesis budget must be an integer from 1 to {MAX_SYNTHESIS_CALLS}')
    total = len(data['hypotheses']) * len(binding['controls'])
    if total > max_synthesis_calls: raise ValueError('Control budget cannot cover every retained anatomy and execution alternative')
    if not 1 <= finite(timeout_s, 'timeout_s') <= 120: raise ValueError('Invalid control timeout')
    extractor = _extractor(node_binary, profile)
    compatibility = {'native': data['provenance'], 'extractor': extractor, 'profile': profile, 'feature_scales': scales, **binding, 'policy': policy()}
    key = digest(compatibility)
    # Applied-anatomy hashes survive model-ID changes, hypothesis renaming and pruning.
    anatomy_shas = [digest(h['anatomy']) for h in data['hypotheses']]
    control_ids = [c['control_id'] for c in binding['controls']]
    support = execution_support(history, key, anatomy_shas, control_ids)
    calibration = residual_calibration(history, key, anatomy_shas, scales)
    evidence_ids, evidence_hashes = set(data['evidence_ids']), set(data['evidence_hashes'])
    for receipt in history:
        row = receipt['artifact']; evidence_hashes.update(row['observation_hashes'])
        evidence_ids.update([row['target_id'], row['attempt_id'], row['artifact_id']])
    if target_id in evidence_ids: raise ValueError('Control target aliases fitting or prior execution evidence')
    pose, rows, calls, started = binding['context']['vowel'], [], 0, time.monotonic()
    with Engine() as engine:
        if engine.provenance != data['provenance']: raise ValueError('Control native provenance changed')
        if pose not in engine.poses: raise ValueError('Unsupported native vowel pose')
        for hypothesis, anatomy_sha in zip(data['hypotheses'], anatomy_shas):
            engine.set_anatomy(hypothesis['anatomy'])
            for control in binding['controls']:
                row = {'alternative_id': anatomy_sha + ':' + control['control_id'], 'hypothesis_id': hypothesis['hypothesis_id'],
                       'anatomy_sha256': anatomy_sha, 'control_id': control['control_id'], 'controls': dict(control),
                       'features': None, 'weight': support['by_anatomy'][anatomy_sha]['weights'][control['control_id']]}
                if time.monotonic() - started > timeout_s:
                    row.update(status='stopped', reason='Control forecast timed out before this alternative was synthesized')
                    rows.append(row); continue
                try:
                    calls += 1
                    audio = engine.synthesize(pose, {'JA': control['JA']}, f0_hz=control['f0_hz'], duration_s=profile['duration_s'])
                    audio, resampling = resample_native_pcm(audio, engine.sample_rate, profile['sample_rate_hz'])
                    start = profile['frame_start_sample']; frame = audio[start:start + profile['frame_size']] * binding['gain']
                    canonical = extract_pcm(frame, profile['sample_rate_hz'], measurement_id=f'{target_id}:{len(rows)}',
                                            observation_id=target_id, artifact_id='simulated-control-frame',
                                            start_ms=start / profile['sample_rate_hz'] * 1000, node_binary=node_binary)
                    if any(canonical[k] != extractor[k] for k in extractor): raise ValueError('Control extractor changed during forecast')
                    features, reason = _available(canonical, scales)
                    row.update(status='predicted' if features is not None else 'missing', reason=reason, features=features,
                               canonical=canonical, resampling=resampling,
                               applied_native_controls=engine.pose(pose, {'JA': control['JA']})[1])
                except (ValueError, RuntimeError) as exc: row.update(status='failed', reason=str(exc))
                rows.append(row)
    predictions = []
    for hypothesis, anatomy_sha in zip(data['hypotheses'], anatomy_shas):
        subset = [row for row in rows if row['anatomy_sha256'] == anatomy_sha]
        complete = all(row['status'] == 'predicted' for row in subset)
        predictions.append({'hypothesis_id': hypothesis['hypothesis_id'], 'anatomy_sha256': anatomy_sha,
            'status': 'predicted' if complete else 'incomplete',
            'features': {name: float(sum(row['features'][name] * row['weight'] for row in subset)) for name in scales} if complete else None})
    return seal({'kind': 'frozen-control-pcm', 'version': VERSION, 'model_id': data['model_id'], 'snapshot_sha256': expected_digest,
                 'target_id': target_id, 'sealed_at': now(), **deepcopy(binding),
                 'compatibility': compatibility, 'compatibility_sha256': key, 'profile': profile, 'feature_scales': scales,
                 'evidence_ids': sorted(evidence_ids), 'evidence_hashes': sorted(evidence_hashes),
                 'execution_support': support, 'empirical_residual_calibration': calibration,
                 'alternatives': rows, 'conditional_predictions': predictions,
                 'actual_synthesis_calls': calls, 'declared_synthesis_calls': total, 'max_synthesis_calls': max_synthesis_calls,
                 'status': 'available' if all(r['status'] == 'predicted' for r in rows) else 'incomplete',
                 'model_updated': False, 'movement_measured': False,
                 'interpretation': policy()['interpretation']})


def score_control_pcm(*, frozen, pcm, metadata, node_binary=None):
    """Score one later original frame against every frozen alternative; never updates a model."""
    data = _read(frozen, 'frozen-control-pcm'); profile = _profile(data['profile']); scales = data['feature_scales']
    if digest(data['compatibility']) != data['compatibility_sha256'] or data['compatibility']['policy'] != policy():
        raise ValueError('Control policy or compatibility binding changed')
    if _extractor(node_binary, profile) != data['compatibility']['extractor']: raise ValueError('Control extractor changed')
    with Engine() as engine:
        if engine.provenance != data['compatibility']['native']: raise ValueError('Control native provenance changed')
    if not isinstance(metadata, dict): raise ValueError('Control outcome metadata required')
    for field in ('observationId', 'attemptId', 'artifactId', 'clockId'): _identity(metadata.get(field), field)
    if metadata['observationId'] != data['target_id']: raise ValueError('Control outcome must match prospective target')
    if metadata.get('sourceKind') != data['context']['source_kind']: raise ValueError('Control evidence kind changed')
    received = now()
    if not _timestamp(data['sealed_at']) < _timestamp(metadata.get('evidenceAt')) <= _timestamp(received):
        raise ValueError('Control recording must follow forecast commitment')
    hashes = metadata.get('sourceHashes')
    if not isinstance(hashes, list) or not hashes or len(set(hashes)) != len(hashes) or any(not isinstance(h, str) or re.fullmatch('[a-f0-9]{64}', h) is None for h in hashes):
        raise ValueError('Original control source hashes required')
    values = np.asarray(pcm, dtype=np.float32)
    if values.shape != (profile['frame_size'],) or not np.isfinite(values).all(): raise ValueError('Control outcome needs exact finite PCM frame')
    frame_sha = hashlib.sha256(values.astype('<f4').tobytes()).hexdigest()
    if (set(hashes) | {frame_sha}) & set(data['evidence_hashes']) or any(metadata[k] in data['evidence_ids'] for k in ('attemptId', 'artifactId')):
        raise ValueError('Control outcome reuses previous physical evidence')
    canonical = extract_pcm(values, profile['sample_rate_hz'], measurement_id=data['target_id'] + ':control-canonical',
                            observation_id=data['target_id'], artifact_id=metadata['artifactId'],
                            start_ms=profile['frame_start_sample'] / profile['sample_rate_hz'] * 1000,
                            source_kind=metadata['sourceKind'], node_binary=node_binary)
    observed, missing = _available(canonical, scales)
    scores, support, residuals = [], {}, []
    for row in data['alternatives']:
        complete = observed is not None and row['status'] == 'predicted'
        residual = {k: observed[k] - row['features'][k] for k in scales} if complete else None
        scores.append({'alternative_id': row['alternative_id'], 'hypothesis_id': row['hypothesis_id'], 'anatomy_sha256': row['anatomy_sha256'],
                       'control_id': row['control_id'], 'status': 'scored' if complete else 'unscorable',
                       'reason': None if complete else missing or row.get('reason'), 'residual': residual,
                       'standardized_square_sum': float(sum((residual[k] / scales[k]['scale']) ** 2 for k in scales)) if complete else None})
    for prediction in data['conditional_predictions']:
        rows = [row for row in scores if row['anatomy_sha256'] == prediction['anatomy_sha256']]
        available = observed is not None and prediction['features'] is not None
        residuals.append({'anatomy_sha256': prediction['anatomy_sha256'],
                          'residual': {k: observed[k] - prediction['features'][k] for k in scales} if available else None})
        if available and all(row['status'] == 'scored' for row in rows):
            # A sum, not a mean, so declaring an uninformative descriptor does not flatten every affinity.
            errors = np.array([row['standardized_square_sum'] for row in rows]); mass = np.exp(-.5 * (errors - errors.min())); mass /= mass.sum()
            support[prediction['anatomy_sha256']] = {row['control_id']: float(weight) for row, weight in zip(rows, mass)}
    status = 'scored' if len(support) == len(data['conditional_predictions']) else 'partial' if support else 'unscorable'
    return seal({'kind': 'scored-control-pcm', 'version': VERSION, 'forecast_sha256': frozen['sha256'],
                 'compatibility_sha256': data['compatibility_sha256'], 'model_id': data['model_id'],
                 'target_id': data['target_id'], 'attempt_id': metadata['attemptId'], 'artifact_id': metadata['artifactId'],
                 'observed_at': metadata['evidenceAt'], 'received_at': received, 'observation_hashes': sorted(set(hashes) | {frame_sha}),
                 'canonical': canonical, 'alternatives': scores, 'control_support': support, 'status': status,
                 'reason': None if status == 'scored' else missing or 'Some frozen anatomy predictions are incomplete',
                 'residual_summary': {'by_anatomy': residuals, 'scope': 'Observed minus frozen weighted acoustic prediction; reported separately, never a correction or physical attribution'},
                 'actual_synthesis_calls': 0, 'actual_extractions': 1, 'model_updated': False, 'movement_measured': False})
