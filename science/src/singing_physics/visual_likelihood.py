"""Conditional native outer-marker projection with annotation-held-out scoring.

Pixel error scales and executed JA are assumptions. No calibrated anatomy claim.
"""
from datetime import datetime, timezone
import hashlib
from pathlib import Path

import numpy as np

from .engine import Engine, finite
from .prediction import Artifact, _encode, _identity, _timestamp

SCHEMA = 'conditional-visual-likelihood/1'
OPERATOR = 'vtl-upper4-lower5-vertex89-distance-v1'
BASE = {'frame_id', 'media_sha256', 'video_frame_index', 'pose', 'assumed_JA'}
ANNOTATION = {'annotation_created_at', 'correspondence_operator_id', 'annotation_method',
              'visibility', 'upper_px', 'lower_px'}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def _policy():
    root = Path(__file__).parent
    return {'version': SCHEMA, 'numpy_version': np.__version__, 'error': 'RMS Euclidean vector residual in pixels across all frames',
            'retention': 'calibration RMS <= best RMS + assumed tolerance; keep all if any missing',
            'source_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest()
                              for name in ('visual_likelihood.py', 'engine.py', 'prediction.py')}}


def _coordinates(value):
    if not isinstance(value, dict) or set(value) != {'id', 'width_px', 'height_px', 'transform'}:
        raise ValueError('Explicit decoded pixel coordinate system required')
    _identity(value['id'], 'coordinate system')
    if value['transform'] != 'decoded-original-pixels':
        raise ValueError('Unsupported coordinate transform; annotate decoded original pixels')
    if any(type(value[k]) is not int or not 1 <= value[k] <= 16384 for k in ('width_px', 'height_px')):
        raise ValueError('Invalid pixel dimensions')


def _frame(row, coordinates, annotation):
    if not isinstance(row, dict) or set(row) != BASE | (ANNOTATION if annotation else set()):
        raise ValueError('Unexpected frame fields or missing frame/annotation metadata')
    _identity(row['frame_id'], 'frame_id')
    sha = row['media_sha256']
    if not isinstance(sha, str) or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha):
        raise ValueError('Original media SHA-256 required')
    if type(row['video_frame_index']) is not int or row['video_frame_index'] < 0:
        raise ValueError('Original decoded frame index required')
    if row['pose'] not in ('a', 'e', 'i', 'o', 'u'):
        raise ValueError('Unsupported declared native pose')
    finite(row['assumed_JA'], 'assumed_JA')
    if annotation:
        if row['correspondence_operator_id'] != OPERATOR or row['annotation_method'] != 'explicit-native-marker-correspondence':
            raise ValueError('Explicit native outer-marker correspondence required; MediaPipe lip indices are not equivalent')
        when = _timestamp(row['annotation_created_at'])
        if when > _timestamp(_now()):
            raise ValueError('Annotation timestamp is in the future')
        if row['visibility'] not in ('visible', 'occluded', 'missing'):
            raise ValueError('Explicit visibility required')
        if row['visibility'] != 'visible':
            if row['upper_px'] is not None or row['lower_px'] is not None:
                raise ValueError('Nonvisible markers must remain null')
        else:
            for name in ('upper_px', 'lower_px'):
                values = row[name]
                if not isinstance(values, list) or len(values) != 2:
                    raise ValueError('Two original pixel coordinates required')
                for i, limit in enumerate((coordinates['width_px'], coordinates['height_px'])):
                    if not 0 <= finite(values[i], name) < limit:
                        raise ValueError('Pixel coordinate outside decoded original frame')
    return (sha, row['video_frame_index'])


def _frames(rows, coordinates, annotation):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 48:
        raise ValueError('Require 1-48 explicitly selected frames')
    keys = [_frame(row, coordinates, annotation) for row in rows]
    if len(set(keys)) != len(keys) or len({row['frame_id'] for row in rows}) != len(rows):
        raise ValueError('Duplicate physical frame or frame identity')
    return keys


def _camera(row):
    if not isinstance(row, dict) or set(row) != {'camera_id', 'rotation_3x3', 'scale_px_per_m'}:
        raise ValueError('Explicit fixed rotation and pixel scale camera required')
    _identity(row['camera_id'], 'camera_id')
    rotation = np.asarray(row['rotation_3x3'], dtype=float)
    if rotation.shape != (3, 3) or not np.isfinite(rotation).all() or not np.allclose(rotation.T@rotation, np.eye(3), atol=1e-8, rtol=0) or not np.isclose(np.linalg.det(rotation), 1, atol=1e-8, rtol=0):
        raise ValueError('Camera rotation must be a proper orthonormal 3x3 matrix')
    scale = finite(row['scale_px_per_m'], 'scale_px_per_m')
    if not 0 < scale <= 1e7:
        raise ValueError('Camera pixel scale must be positive and bounded')
    return rotation, scale


def _project(vector, camera):
    rotation, scale = _camera(camera)
    return (scale*(rotation@np.asarray(vector))[:2]).tolist()


def _residual(predictions, annotations):
    if any(row['visibility'] != 'visible' for row in annotations):
        return None
    residuals = [np.asarray(predicted)- (np.asarray(row['upper_px'])-np.asarray(row['lower_px']))
                 for predicted, row in zip(predictions, annotations, strict=True)]
    return float(np.sqrt(np.mean([np.dot(r, r) for r in residuals])))


def freeze_visual_forecast(*, model_id, hypotheses, camera_candidates, calibration_frames,
                           targets, coordinate_system, expected_provenance,
                           calibration_tolerance_px=1., max_geometry_calls=96):
    """Calibrate finite joint candidates and seal target vectors before annotation.

    Each camera is fixed over all frames in one declared coordinate system.
    Target frames may already exist; only their annotations are held out.
    """
    _identity(model_id, 'model_id'); _coordinates(coordinate_system)
    calibration_keys = _frames(calibration_frames, coordinate_system, True)
    target_keys = _frames(targets, coordinate_system, False)
    if set(calibration_keys) & set(target_keys) or {r['frame_id'] for r in calibration_frames} & {r['frame_id'] for r in targets}:
        raise ValueError('Calibration and target physical frames/IDs must be disjoint')
    if not isinstance(hypotheses, list) or not 1 <= len(hypotheses) <= 32:
        raise ValueError('Require 1-32 anatomy hypotheses')
    for row in hypotheses:
        if not isinstance(row, dict) or set(row) != {'hypothesis_id', 'anatomy'} or not isinstance(row['anatomy'], dict) or not row['anatomy']:
            raise ValueError('Explicit hypothesis identity and anatomy required')
        _identity(row['hypothesis_id'], 'hypothesis_id')
    if len({r['hypothesis_id'] for r in hypotheses}) != len(hypotheses):
        raise ValueError('Duplicate hypothesis identity')
    if not isinstance(camera_candidates, list) or not 1 <= len(camera_candidates) <= 16:
        raise ValueError('Require 1-16 fixed camera candidates')
    for camera in camera_candidates:
        _camera(camera)
    if len({c['camera_id'] for c in camera_candidates}) != len(camera_candidates):
        raise ValueError('Duplicate camera identity')
    tolerance = finite(calibration_tolerance_px, 'calibration_tolerance_px')
    if tolerance < 0:
        raise ValueError('Calibration tolerance must be nonnegative')
    required = len(hypotheses)*(len(calibration_frames)+len(targets))
    if type(max_geometry_calls) is not int or not 1 <= max_geometry_calls <= 96 or required > max_geometry_calls:
        raise ValueError('Geometry budget exceeded before native execution')
    frames = calibration_frames+targets
    native = []; calls = 0
    with Engine() as engine:
        if engine.provenance != expected_provenance:
            raise ValueError('Native provenance mismatch')
        provenance = engine.provenance
        for hypothesis in hypotheses:
            engine.set_anatomy(hypothesis['anatomy'])
            anatomy = engine.anatomy()
            rows = []
            for frame in frames:
                marker = engine.lip_markers(frame['pose'], {'JA': frame['assumed_JA']})
                calls += 1
                if marker['operator_id'] != OPERATOR:
                    raise ValueError('Native correspondence operator changed')
                rows.append({'frame_id': frame['frame_id'], 'vector_m': (np.asarray(marker['positions_m']['upper'])-np.asarray(marker['positions_m']['lower'])).tolist(),
                             'marker_sha256': marker['artifact_sha256'], 'applied_articulation': marker['articulation']})
            native.append({'hypothesis_id': hypothesis['hypothesis_id'], 'anatomy': anatomy, 'frames': rows})
    pairs = []
    for hypothesis in native:
        for camera in camera_candidates:
            vectors = [_project(row['vector_m'], camera) for row in hypothesis['frames']]
            score = _residual(vectors[:len(calibration_frames)], calibration_frames)
            pairs.append({'hypothesis_id': hypothesis['hypothesis_id'], 'camera_id': camera['camera_id'],
                          'calibration_rms_px': score, 'target_vectors_px': vectors[len(calibration_frames):]})
    best = min((p['calibration_rms_px'] for p in pairs if p['calibration_rms_px'] is not None), default=None)
    for pair in pairs:
        pair['retained'] = best is None or pair['calibration_rms_px'] <= best+tolerance
    return Artifact(_encode({'schema_version': SCHEMA, 'kind': 'frozen_visual_forecast', 'model_id': model_id,
        'sealed_at': _now(), 'policy': _policy(), 'provenance': provenance, 'operator_id': OPERATOR,
        'coordinate_system': coordinate_system, 'calibration_frames': calibration_frames, 'targets': targets,
        'camera_candidates': camera_candidates, 'native_hypotheses': native, 'pairs': pairs,
        'calibration_tolerance_px': tolerance, 'calibration_status': 'scored' if best is not None else 'missing_calibration',
        'budget': {'max_geometry_calls': max_geometry_calls, 'actual_geometry_calls': calls, 'synthesis_calls': 0},
        'interpretation': 'Conditional annotation holdout; assumed JA and finite fixed cameras, not verified execution, calibrated uncertainty or uniquely recovered anatomy'}))


def score_visual_forecast(forecast, *, expected_digest, annotations):
    """Compare only the frozen retained joint hypotheses; never refit cameras."""
    if not isinstance(forecast, Artifact) or forecast.sha256 != expected_digest or _encode(forecast.data) != forecast.content:
        raise ValueError('Frozen forecast digest/canonical bytes mismatch')
    frozen = forecast.data
    if frozen['schema_version'] != SCHEMA or frozen['kind'] != 'frozen_visual_forecast' or frozen['policy'] != _policy() or frozen['operator_id'] != OPERATOR:
        raise ValueError('Frozen visual policy/version mismatch')
    _coordinates(frozen['coordinate_system'])
    keys = _frames(annotations, frozen['coordinate_system'], True)
    if len(annotations) != len(frozen['targets']):
        raise ValueError('Require all target annotations, including explicit missing frames')
    if set(keys) & set(_frames(frozen['calibration_frames'], frozen['coordinate_system'], True)):
        raise ValueError('Held-out annotation reuses calibration evidence')
    by_id = {row['frame_id']: row for row in annotations}
    ordered = []
    for target in frozen['targets']:
        if target['frame_id'] not in by_id:
            raise ValueError('Missing frozen target identity')
        row = by_id[target['frame_id']]
        if {key: row[key] for key in BASE} != target:
            raise ValueError('Target source/frame/articulation metadata changed')
        if _timestamp(row['annotation_created_at']) <= _timestamp(frozen['sealed_at']):
            raise ValueError('Held-out annotation must be created after forecast seal')
        ordered.append(row)
    with Engine() as engine:
        if engine.provenance != frozen['provenance']:
            raise ValueError('Frozen native provenance mismatch')
    scores = [{**{k: pair[k] for k in ('hypothesis_id', 'camera_id', 'calibration_rms_px')},
               'heldout_rms_px': _residual(pair['target_vectors_px'], ordered)}
              for pair in frozen['pairs'] if pair['retained']]
    usable = bool(scores) and all(row['heldout_rms_px'] is not None for row in scores)
    return Artifact(_encode({'schema_version': SCHEMA, 'kind': 'visual_forecast_score', 'forecast_sha256': forecast.sha256,
        'model_id': frozen['model_id'], 'received_at': _now(), 'annotation_sha256': _hash(annotations),
        'annotations': annotations, 'scores': scores,
        'status': 'scored' if usable and frozen['calibration_status'] == 'scored' else 'missing_required_evidence',
        'calibration_status': frozen['calibration_status'],
        'missing_frame_ids': [r['frame_id'] for r in ordered if r['visibility'] != 'visible'],
        'geometry_calls': 0, 'synthesis_calls': 0, 'baseline_unchanged': True,
        'interpretation': frozen['interpretation']}))
