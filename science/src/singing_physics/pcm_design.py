"""Bounded canonical-PCM experiment discrimination and conditional evidence update."""
from datetime import datetime, timezone
import hashlib
from itertools import combinations
import re

import numpy as np

from .engine import ANATOMY, Engine, finite
from .pcm_inverse import FEATURES, _bridge, _features, extract_pcm, resample_native_pcm
from .prediction import Artifact, _encode, _identity, _timestamp

PROFILE = {'sample_rate_hz': 44100, 'frame_start_sample': 4410, 'frame_size': 4096, 'duration_s': .25}
SCHEMA = 'internal-pcm-design-0.1'


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def _read(artifact, expected, kind):
    if not isinstance(artifact, Artifact) or artifact.sha256 != expected:
        raise ValueError('Artifact digest mismatch')
    try:
        value = artifact.data
    except (ValueError, UnicodeError) as exc:
        raise ValueError('Invalid canonical artifact') from exc
    if not isinstance(value, dict) or value.get('schema_version') != SCHEMA or value.get('kind') != kind or _encode(value) != artifact.content:
        raise ValueError('Invalid artifact kind/schema/canonical encoding')
    return value


def _evidence(ids, hashes):
    if not isinstance(ids, list) or not ids or not isinstance(hashes, list) or not hashes:
        raise ValueError('Fitting evidence IDs and source hashes are required')
    for identity in ids:
        _identity(identity, 'evidence_id')
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate fitting evidence IDs')
    if any(not isinstance(h, str) or re.fullmatch('[a-f0-9]{64}', h) is None for h in hashes):
        raise ValueError('Source hashes must be SHA-256 hex')
    if len(set(hashes)) != len(hashes):
        raise ValueError('Duplicate fitting source hashes')


def freeze_pcm_hypotheses(*, model_id, evidence_ids, evidence_hashes, provenance, hypotheses, frozen_at):
    """Validate and freeze complete applied geometry; duplicate geometries collapse."""
    _identity(model_id, 'model_id'); _evidence(evidence_ids, evidence_hashes)
    if _timestamp(frozen_at) > _timestamp(_now()):
        raise ValueError('Hypothesis freeze timestamp is in the future')
    if not isinstance(hypotheses, list) or not 1 <= len(hypotheses) <= 32:
        raise ValueError('Supply 1-32 finite physical hypotheses')
    ids, retained, duplicates = set(), [], []
    geometries = {}
    with Engine() as engine:
        if provenance != engine.provenance:
            raise ValueError('Native provenance mismatch')
        for row in hypotheses:
            if not isinstance(row, dict) or set(row) != {'hypothesis_id', 'anatomy'}:
                raise ValueError('Hypotheses require hypothesis_id and anatomy')
            identity = _identity(row['hypothesis_id'], 'hypothesis_id')
            if identity in ids:
                raise ValueError('Duplicate hypothesis ID')
            ids.add(identity)
            anatomy = engine.set_anatomy(row['anatomy'])
            key = _hash(anatomy)
            if key in geometries:
                duplicates.append({'hypothesis_id': identity, 'equivalent_to': geometries[key]})
            else:
                geometries[key] = identity
                retained.append({'hypothesis_id': identity, 'anatomy': anatomy})
    return Artifact(_encode({'schema_version': SCHEMA, 'kind': 'frozen_pcm_hypotheses',
        'model_id': model_id, 'evidence_ids': evidence_ids, 'evidence_hashes': evidence_hashes,
        'provenance': provenance, 'hypotheses': retained, 'duplicate_geometries': duplicates,
        'frozen_at': frozen_at, 'sealed_at': _now(),
        'anatomy_units': {name: unit for name, unit, _, _ in ANATOMY},
        'scope': 'Finite geometry support; not posterior samples; identical applied geometries collapsed'}))


def _snapshot(snapshot, expected):
    value = _read(snapshot, expected, 'frozen_pcm_hypotheses')
    _identity(value.get('model_id'), 'model_id')
    _evidence(value.get('evidence_ids'), value.get('evidence_hashes'))
    if not _timestamp(value['frozen_at']) <= _timestamp(value['sealed_at']) <= _timestamp(_now()):
        raise ValueError('Invalid hypothesis receipt chronology')
    if not isinstance(value.get('hypotheses'), list) or not 1 <= len(value['hypotheses']) <= 32:
        raise ValueError('Empty or excessive physical support')
    ids, geometry = set(), set()
    for row in value['hypotheses']:
        if not isinstance(row, dict) or set(row) != {'hypothesis_id', 'anatomy'}:
            raise ValueError('Invalid frozen hypothesis')
        identity = _identity(row['hypothesis_id'], 'hypothesis_id')
        if identity in ids or not isinstance(row['anatomy'], dict) or set(row['anatomy']) != {r[0] for r in ANATOMY}:
            raise ValueError('Duplicate identity or incomplete applied anatomy')
        ids.add(identity)
        for name, _, low, high in ANATOMY:
            if not low <= finite(row['anatomy'][name], name) <= high:
                raise ValueError('Frozen anatomy outside native bounds')
        key = _hash(row['anatomy'])
        if key in geometry:
            raise ValueError('Repeated physical support must be collapsed')
        geometry.add(key)
    return value


def _profile(value):
    if not isinstance(value, dict) or set(value) != set(PROFILE):
        raise ValueError('PCM profile requires sample_rate_hz, frame_start_sample, frame_size and duration_s')
    rate, start, size = (value[k] for k in ('sample_rate_hz', 'frame_start_sample', 'frame_size'))
    if any(type(x) is not int for x in (rate, start, size)) or rate not in (44100, 48000, 96000) or size != (8192 if rate == 96000 else 4096):
        raise ValueError('Unsupported canonical PCM frame profile')
    duration = finite(value['duration_s'], 'duration_s')
    if start < 0 or not .1 <= duration <= 5 or start+size > min(round(duration*rate), int(np.ceil(round(duration*44100)*rate/44100))):
        raise ValueError('PCM profile frame lies outside synthesis duration')
    return dict(value)


def _extractor(node_binary, profile):
    rate = profile['sample_rate_hz']
    result = _bridge({'operation': 'validate', 'records': [], 'sampleRates': [rate]}, node_binary)
    if result['audioProfiles'] != [{'sampleRate': rate, 'frameSize': profile['frame_size']}]:
        raise ValueError('Canonical PCM profile changed')
    return {k: result[k] for k in ('extractorSha256', 'contractsSha256', 'extractorVersion', 'contractVersion')}


def _scales(scales):
    if not isinstance(scales, dict) or not 3 <= len(scales) <= len(FEATURES) or set(scales)-set(FEATURES):
        raise ValueError('Predeclare 3-5 supported canonical feature scales')
    for name, item in scales.items():
        if not isinstance(item, dict) or set(item) != {'unit', 'scale', 'assumption'} or item['unit'] != FEATURES[name][0]:
            raise ValueError('Feature units or scale fields mismatch')
        if finite(item['scale'], 'scale') <= 0:
            raise ValueError('Feature scales must be positive')
        _identity(item['assumption'], 'scale assumption')


def _available(canonical, scales):
    record = canonical['measurement']
    try:
        features = _features(record)
    except ValueError as exc:
        return None, str(exc)
    missing = [name for name in scales if features[name]['value'] is None]
    if missing:
        return None, 'Required canonical features missing: '+', '.join(missing)
    return {name: features[name]['value'] for name in scales}, None


def design_pcm(snapshot, *, expected_digest, design_id, target_observation_id, generated_at,
               experiments, feature_scales, minimum_separation=1., retention_margin=1.,
               maximum_discrepancy=2., max_synthesis_calls=64, node_binary=None, profile=None):
    """Freeze conservative pair discrimination using actual synthesized PCM features."""
    data = _snapshot(snapshot, expected_digest)
    profile = _profile(PROFILE if profile is None else profile)
    _identity(design_id, 'design_id'); _identity(target_observation_id, 'target_observation_id')
    if target_observation_id in data['evidence_ids'] or target_observation_id+':canonical' in data['evidence_ids']:
        raise ValueError('Target observation leaks into fitting evidence')
    if not _timestamp(data['sealed_at']) <= _timestamp(generated_at) <= _timestamp(_now()):
        raise ValueError('Design timestamp must follow hypothesis receipt and not be future')
    _scales(feature_scales)
    for name, value in [('minimum_separation', minimum_separation), ('retention_margin', retention_margin), ('maximum_discrepancy', maximum_discrepancy)]:
        if finite(value, name) <= 0:
            raise ValueError('Separation and retention thresholds must be positive')
    if not isinstance(experiments, list) or not 1 <= len(experiments) <= 16:
        raise ValueError('Supply 1-16 predeclared experiments')
    ids = set()
    for item in experiments:
        if not isinstance(item, dict) or set(item) != {'experiment_id', 'pose', 'JA', 'f0_hz', 'gain'}:
            raise ValueError('Supported experiment requires pose, JA, F0 and gain')
        identity = _identity(item['experiment_id'], 'experiment_id')
        if identity in ids:
            raise ValueError('Duplicate experiment ID')
        ids.add(identity); _identity(item['pose'], 'pose')
        for name, low, high in [('JA', -5., -1.), ('f0_hz', 65., 1000.), ('gain', .001, 100.)]:
            if not low <= finite(item[name], name) <= high:
                raise ValueError('Experiment control outside supported bounds')
    calls = len(experiments)*len(data['hypotheses'])
    if type(max_synthesis_calls) is not int or not 1 <= max_synthesis_calls <= 512 or calls > max_synthesis_calls:
        raise ValueError('Native synthesis budget exceeded or invalid')
    extractor = _extractor(node_binary, profile)
    rankings = []
    with Engine() as engine:
        if engine.provenance != data['provenance']:
            raise ValueError('Stale native provenance')
        if any(item['pose'] not in engine.poses for item in experiments):
            raise ValueError('Unsupported native vowel pose')
        for experiment in experiments:
            predictions = []
            for hypothesis in data['hypotheses']:
                engine.set_anatomy(hypothesis['anatomy'])
                audio = engine.synthesize(experiment['pose'], {'JA': experiment['JA']},
                    f0_hz=experiment['f0_hz'], duration_s=profile['duration_s'])
                audio, resampling = resample_native_pcm(audio, engine.sample_rate, profile['sample_rate_hz'])
                start = profile['frame_start_sample']
                frame = audio[start:start+profile['frame_size']]*experiment['gain']
                canonical = extract_pcm(frame, profile['sample_rate_hz'], measurement_id=f"{design_id}:{experiment['experiment_id']}:{hypothesis['hypothesis_id']}",
                    observation_id=design_id, artifact_id='simulated-design-frame', start_ms=start/profile['sample_rate_hz']*1000, node_binary=node_binary)
                if any(canonical[k] != extractor[k] for k in extractor):
                    raise ValueError('Extractor changed during design')
                features, reason = _available(canonical, feature_scales)
                predictions.append({'hypothesis_id': hypothesis['hypothesis_id'],
                                    'native_controls': engine.pose(experiment['pose'], {'JA': experiment['JA']})[1], 'features': features,
                                    'missing_reason': reason, 'canonical': canonical, 'resampling': resampling})
            pairs = []
            if all(p['features'] is not None for p in predictions):
                for left, right in combinations(predictions, 2):
                    score = float(np.sqrt(np.mean([((left['features'][name]-right['features'][name])/scale['scale'])**2
                                                   for name, scale in feature_scales.items()])))
                    pairs.append({'hypothesis_ids': [left['hypothesis_id'], right['hypothesis_id']], 'standardized_rms': score})
            score = min((p['standardized_rms'] for p in pairs), default=None)
            status = ('missing_predicted_features' if any(p['features'] is None for p in predictions) else
                      'insufficient_distinct_hypotheses' if not pairs else
                      'separated_at_assumed_threshold' if score >= minimum_separation else 'no_separation_at_assumed_threshold')
            rankings.append({'experiment': experiment, 'predictions': predictions, 'pairs': pairs,
                             'worst_pair_standardized_rms': score, 'status': status})
    rankings.sort(key=lambda r: (r['status'] != 'separated_at_assumed_threshold',
        -(r['worst_pair_standardized_rms'] if r['worst_pair_standardized_rms'] is not None else -1), r['experiment']['experiment_id']))
    chosen = rankings[0]['experiment']['experiment_id'] if rankings[0]['status'] == 'separated_at_assumed_threshold' else None
    return Artifact(_encode({'schema_version': SCHEMA, 'kind': 'frozen_pcm_experiment_design',
        'design_id': design_id, 'model_id': data['model_id'], 'hypothesis_snapshot_sha256': snapshot.sha256,
        'evidence_ids': data['evidence_ids'], 'evidence_hashes': data['evidence_hashes'],
        'provenance': data['provenance'], 'extractor': extractor, 'generated_at': generated_at, 'sealed_at': _now(),
        'target_observation_id': target_observation_id, 'profile': profile, 'feature_scales': feature_scales,
        'minimum_separation': minimum_separation, 'retention_margin': retention_margin,
        'maximum_discrepancy': maximum_discrepancy, 'rankings': rankings,
        'selected_experiment_id': chosen, 'actual_synthesis_calls': calls,
        'claim': 'Finite-support standardized descriptor separation, not information gain/posterior or human cue reliability'}))



def select_pcm_experiment(design, snapshot, *, expected_design_digest, expected_snapshot_digest,
                          design_id, target_observation_id, experiment_id, selection_reason):
    """Commit a declared choice among complete forecasts without changing scores."""
    frozen = _read(design, expected_design_digest, 'frozen_pcm_experiment_design')
    data = _snapshot(snapshot, expected_snapshot_digest)
    if frozen.get('hypothesis_snapshot_sha256') != snapshot.sha256 or any(frozen.get(k) != data[k] for k in ('model_id','provenance','evidence_ids','evidence_hashes')):
        raise ValueError('Selection requires matching current forecast and snapshot')
    for value, label in ((design_id,'design_id'),(target_observation_id,'target_observation_id'),(experiment_id,'experiment_id')):
        _identity(value,label)
    if design_id == frozen['design_id'] or target_observation_id == frozen['target_observation_id'] or target_observation_id in data['evidence_ids'] or target_observation_id+':canonical' in data['evidence_ids']:
        raise ValueError('Selection requires fresh design and target identities')
    if not isinstance(selection_reason,str) or not 1 <= len(selection_reason.strip()) <= 2000:
        raise ValueError('A bounded selection reason is required')
    rows = [r for r in frozen['rankings'] if r['experiment']['experiment_id']==experiment_id]
    if len(rows)!=1 or len(rows[0]['predictions'])!=len(data['hypotheses']) or any(p.get('features') is None or p.get('missing_reason') is not None for p in rows[0]['predictions']):
        raise ValueError('Selected experiment lacks complete numerical predictions')
    now=_now()
    if _timestamp(frozen['sealed_at']) > _timestamp(now):
        raise ValueError('Source forecast is in the future')
    return Artifact(_encode({**frozen,'design_id':design_id,'target_observation_id':target_observation_id,
        'selected_experiment_id':experiment_id,'generated_at':now,'sealed_at':now,
        'source_design_sha256':design.sha256,'source_design_id':frozen['design_id'],
        'selection_policy':'explicit_choice_among_complete_numerical_forecasts',
        'selection_reason':selection_reason,'additional_synthesis_calls':0,
        'selection_scope':'Declared action choice, not verified execution or additional anatomical evidence'}))


def update_pcm(design, snapshot, *, expected_design_digest, expected_snapshot_digest,
               experiment_id, observation_id, artifact_id, observed_at, pcm,
               sample_rate_hz=44100, frame_start_sample=4410, frame_size=4096, source_kind='engine-generated', node_binary=None):
    """Receive an actual frame, seal its receipt and update finite conditional support."""
    received_at = _now()
    frozen = _read(design, expected_design_digest, 'frozen_pcm_experiment_design')
    if 'selection_policy' in frozen:
        if frozen['selection_policy'] != 'explicit_choice_among_complete_numerical_forecasts' or frozen.get('selected_experiment_id') != experiment_id:
            raise ValueError('Outcome differs from explicitly committed selection')
        if not isinstance(frozen.get('source_design_sha256'),str) or re.fullmatch('[a-f0-9]{64}',frozen['source_design_sha256']) is None or not isinstance(frozen.get('selection_reason'),str) or not frozen['selection_reason'].strip():
            raise ValueError('Invalid explicit selection lineage')
    data = _snapshot(snapshot, expected_snapshot_digest)
    if frozen.get('hypothesis_snapshot_sha256') != snapshot.sha256 or any(frozen.get(key) != data[key] for key in ('model_id', 'provenance', 'evidence_ids', 'evidence_hashes')):
        raise ValueError('Design/hypothesis model or evidence binding mismatch')
    if not _timestamp(frozen['sealed_at']) < _timestamp(observed_at) <= _timestamp(received_at):
        raise ValueError('Observation must follow sealed design and precede server receipt')
    _identity(observation_id, 'observation_id'); _identity(artifact_id, 'artifact_id')
    if observation_id != frozen['target_observation_id'] or any(identity in data['evidence_ids'] for identity in (observation_id, artifact_id, observation_id+':canonical')):
        raise ValueError('Observation identity is not disjoint prospective target')
    profile = _profile(frozen.get('profile'))
    if any(type(x) is not int for x in (sample_rate_hz, frame_start_sample, frame_size)) or (sample_rate_hz, frame_start_sample, frame_size) != tuple(profile[k] for k in ('sample_rate_hz', 'frame_start_sample', 'frame_size')):
        raise ValueError('Unsupported or mismatched canonical PCM frame profile')
    if source_kind not in ('engine-generated', 'human-observation'):
        raise ValueError('Observation source kind must be explicit synthetic or human evidence')
    if observation_id == artifact_id:
        raise ValueError('Observation and artifact IDs must be distinct')
    values = np.asarray(pcm, dtype=np.float32)
    if values.shape != (frame_size,) or not np.isfinite(values).all():
        raise ValueError(f'Actual PCM must contain exactly {frame_size} finite mono samples')
    frame_hash = hashlib.sha256(values.astype('<f4').tobytes()).hexdigest()
    if frame_hash in data['evidence_hashes']:
        raise ValueError('Repeated physical source frame despite observation identity')
    if _extractor(node_binary, profile) != frozen.get('extractor'):
        raise ValueError('Canonical extractor source hashes changed')
    selected = [r for r in frozen['rankings'] if r['experiment']['experiment_id'] == experiment_id]
    if len(selected) != 1:
        raise ValueError('Experiment was not predeclared')
    selected = selected[0]
    _scales(frozen['feature_scales'])
    for key in ('minimum_separation', 'retention_margin', 'maximum_discrepancy'):
        if finite(frozen[key], key) <= 0:
            raise ValueError('Invalid frozen design threshold')
    predictions = selected.get('predictions')
    if not isinstance(predictions, list) or [p.get('hypothesis_id') for p in predictions] != [h['hypothesis_id'] for h in data['hypotheses']]:
        raise ValueError('Prediction support differs from frozen hypotheses')
    for prediction in predictions:
        canonical_prediction = prediction.get('canonical')
        if not isinstance(canonical_prediction, dict) or any(canonical_prediction.get(k) != frozen['extractor'][k] for k in frozen['extractor']):
            raise ValueError('Prediction extractor lineage mismatch')
        conversion = prediction.get('resampling')
        if (conversion is None and profile != PROFILE) or (conversion is not None and (
                not isinstance(conversion, dict) or conversion.get('target_rate_hz') != sample_rate_hz
                or conversion.get('source_rate_hz') != 44100 or conversion.get('observations_resampled') is not False)):
            raise ValueError('Prediction resampling profile binding mismatch')
        window = canonical_prediction.get('measurement', {}).get('window', {})
        expected_start = frame_start_sample/sample_rate_hz*1000
        expected_end = (frame_start_sample+frame_size)/sample_rate_hz*1000
        if window.get('startMs') != expected_start or not np.isclose(window.get('endMs', float('nan')), expected_end, rtol=0, atol=1e-6):
            raise ValueError('Prediction frame profile binding mismatch')
        predicted_features, predicted_reason = _available(canonical_prediction, frozen['feature_scales'])
        if prediction.get('features') != predicted_features or prediction.get('missing_reason') != predicted_reason:
            raise ValueError('Prediction feature binding mismatch')
    pair_scores = [float(np.sqrt(np.mean([((left['features'][name]-right['features'][name])/scale['scale'])**2
        for name, scale in frozen['feature_scales'].items()]))) for left, right in combinations(predictions, 2)] if all(p['features'] is not None for p in predictions) else []
    worst = min(pair_scores, default=None)
    expected_status = ('missing_predicted_features' if any(p['features'] is None for p in predictions) else
        'insufficient_distinct_hypotheses' if not pair_scores else
        'separated_at_assumed_threshold' if worst >= frozen['minimum_separation'] else 'no_separation_at_assumed_threshold')
    if selected.get('status') != expected_status or selected.get('worst_pair_standardized_rms') != worst:
        raise ValueError('Frozen discrimination score/status binding mismatch')
    canonical = extract_pcm(values, sample_rate_hz, measurement_id=observation_id+':canonical',
        observation_id=observation_id, artifact_id=artifact_id, start_ms=frame_start_sample/sample_rate_hz*1000, source_kind=source_kind, node_binary=node_binary)
    if any(canonical[k] != frozen['extractor'][k] for k in frozen['extractor']):
        raise ValueError('Extractor changed during observation receipt')
    features, reason = _available(canonical, frozen['feature_scales'])
    receipt = {'observation_id': observation_id, 'artifact_id': artifact_id, 'observed_at': observed_at,
        'received_at': received_at, 'frame_sha256': frame_hash, 'hash_scope': 'little-endian-float32-frame-bytes',
        'design_sha256': design.sha256, 'profile': profile, 'canonical': canonical,
        'capture_time_attestation': 'caller-declared capture time; server-attested local receipt only',
        'window_provenance': 'caller-supplied crop; start offset declared, not independently recovered from source recording'}
    scores = []
    if features is not None and all(p['features'] is not None for p in selected['predictions']):
        for predicted in selected['predictions']:
            score = float(np.sqrt(np.mean([((predicted['features'][name]-features[name])/scale['scale'])**2
                                           for name, scale in frozen['feature_scales'].items()])))
            scores.append({'hypothesis_id': predicted['hypothesis_id'], 'standardized_rms': score})
    scores.sort(key=lambda row: (row['standardized_rms'], row['hypothesis_id']))
    status = ('missing_required_features' if not scores else 'model_mismatch' if scores[0]['standardized_rms'] > frozen['maximum_discrepancy'] else
              'no_design_separation' if selected['status'] != 'separated_at_assumed_threshold' else 'conditional_support_updated')
    keep = {r['hypothesis_id'] for r in scores if r['standardized_rms'] <= scores[0]['standardized_rms']+frozen['retention_margin']} if status == 'conditional_support_updated' else {h['hypothesis_id'] for h in data['hypotheses']}
    model_identity = _hash({'parent_snapshot_sha256': snapshot.sha256, 'design_sha256': design.sha256,
        'experiment_id': experiment_id, 'receipt_sha256': _hash(receipt),
        'retained_hypothesis_ids': sorted(keep), 'status': status})
    updated = {**data, 'model_id': 'pcm-model:'+model_identity,
        'parent_snapshot_sha256': snapshot.sha256, 'design_sha256': design.sha256,
        'hypotheses': [h for h in data['hypotheses'] if h['hypothesis_id'] in keep],
        'evidence_ids': data['evidence_ids']+[observation_id, artifact_id, observation_id+':canonical'],
        'evidence_hashes': data['evidence_hashes']+[frame_hash], 'frozen_at': received_at, 'sealed_at': _now()}
    return Artifact(_encode({'schema_version': SCHEMA, 'kind': 'conditional_pcm_support_update',
        'design_sha256': design.sha256, 'parent_snapshot_sha256': snapshot.sha256,
        'status': status, 'scores': scores, 'missing_reason': reason,
        'observation_receipt': receipt, 'observation_receipt_sha256': _hash(receipt),
        'updated_snapshot': updated, 'updated_snapshot_sha256': _hash(updated),
        'limitations': ['Conditional on declared executed JA/F0/gain and finite retained geometry space',
            'Not a calibrated posterior or anatomical identification', 'Exact frame-byte reuse detected; overlapping crops may not be detectable']}))
