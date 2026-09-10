"""Experimental original rear-depth distance likelihood on retained native geometries.

Distance is invariant to rigid camera/model registration. Only explicitly annotated
outer-lip marker correspondence is compared; no hidden surfaces are reconstructed.
"""
from copy import deepcopy
import hashlib
import math
import os
import json
from pathlib import Path

import numpy as np
from scipy.special import logsumexp

from observations.geometry.native_capture import read_native_capture
from observations.geometry.rectification import rectify_depth_points
from observations.geometry.lips import OPERATOR_ID
from .pcm_design import _snapshot
from .prediction import Artifact, _encode, _timestamp

VERSION = 'experimental-rear-lidar-lip-1'


def _hash(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def _positive(value, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not 1e-6 <= value <= 1:
        raise ValueError(f'{name} must be finite meters in [1e-6,1]')
    return float(value)


def _identity(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 512:
        raise ValueError(f'{name} must be an explicit bounded identity')
    return value


def _evidence(value, label):
    if not isinstance(value, dict):
        raise ValueError(f'{label} evidence is required')
    _identity(value.get('evidence_id'), label)
    hashes = value.get('source_hashes')
    if (not isinstance(hashes, list) or not 1 <= len(hashes) <= 16 or len(set(hashes)) != len(hashes)
            or any(not isinstance(h, str) or len(h) != 64 or any(c not in '0123456789abcdef' for c in h) for h in hashes)):
        raise ValueError(f'{label} requires unique SHA-256 source hashes')


def rank_lidar_hypotheses(engine, snapshot, capture_directory, annotation, *, enabled=False, max_geometry_calls=96):
    """Rank all retained hypotheses under one declared scan, leaving baseline intact.

    Caller owns optional adoption and session chronology. Returned likelihood scores
    are conditional on declared uncertainty and JA prior, not calibrated probability.
    Original archives are verified; annotation evidence hashes are declarations, not
    independently authenticated reference measurements. No native call on rejection.
    """
    result = {'kind': VERSION, 'status': 'disabled', 'model_updated': False,
              'actual_geometry_calls': 0, 'baseline_preserved': True, 'rankings': [],
              'reason': 'Experimental rear LiDAR fusion is disabled'}
    if enabled is not True:
        return result
    try:
        if type(max_geometry_calls) is not int or not 1 <= max_geometry_calls <= 96:
            raise ValueError('max_geometry_calls must be 1..96')
        artifact = Artifact(_encode(snapshot))
        frozen = _snapshot(artifact, artifact.sha256)
        doc = deepcopy(annotation)
        if not isinstance(doc, dict) or doc.get('schema_version') != VERSION:
            raise ValueError('Unsupported experimental LiDAR annotation')
        if doc.get('model_id') != frozen['model_id'] or doc.get('snapshot_sha256') != artifact.sha256:
            raise ValueError('Annotation does not bind the frozen baseline model')
        if frozen['provenance'] != engine.provenance:
            raise ValueError('Frozen baseline native provenance changed')
        if doc.get('source_kind') not in ('human-observation', 'development-fixture'):
            raise ValueError('Explicit source_kind required')
        registration, correspondence = doc.get('registration'), doc.get('correspondence')
        _evidence(registration, 'registration'); _evidence(correspondence, 'correspondence')
        if registration.get('kind') != 'rigid-distance-invariant':
            raise ValueError('Only rigid-registration-invariant marker distance is supported')
        if (correspondence.get('operator_id') != OPERATOR_ID or correspondence.get('upper_surface_vertex') != [4, 89]
                or correspondence.get('lower_surface_vertex') != [5, 89]):
            raise ValueError('Expected source-defined outer-lip marker correspondence')
        _identity(doc.get('reference_mapping_id'), 'reference_mapping_id')
        _identity(doc.get('uncertainty_scope'), 'uncertainty_scope')
        sigma_measurement = _positive(doc.get('measurement_sigma_m'), 'measurement_sigma_m')
        sigma_model = _positive(doc.get('model_sigma_m'), 'model_sigma_m')
        sigma = math.hypot(sigma_measurement, sigma_model)
        pose = doc.get('pose')
        if not isinstance(pose, str) or pose not in engine.poses:
            raise ValueError('Explicit supported held-scan pose required')
        values, weights = doc.get('JA_values'), doc.get('JA_weights')
        if (not isinstance(values, list) or not 1 <= len(values) <= 3
                or any(type(v) not in (int, float) or not math.isfinite(v) or not -5 <= v <= -1 for v in values)
                or len(set(values)) != len(values)):
            raise ValueError('Supply 1..3 unique scan JA values in [-5,-1] degrees')
        if (not isinstance(weights, list) or len(weights) != len(values)
                or any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in weights)
                or not math.isclose(sum(weights), 1., rel_tol=0, abs_tol=1e-12)):
            raise ValueError('Explicit positive JA mixture weights must sum to one')
        required_calls = len(frozen['hypotheses']) * len(values)
        if required_calls > max_geometry_calls:
            raise ValueError('Complete retained support exceeds declared geometry call budget')
        capture = read_native_capture(capture_directory, allow_rear_lidar=True)
        if capture.capture_id != doc.get('capture_id') or capture.manifest_sha256 != doc.get('manifest_sha256'):
            raise ValueError('Annotation does not bind original capture manifest')
        if capture.manifest_sha256 in frozen['evidence_hashes']:
            raise ValueError('Depth capture has already contributed to the baseline')
        manifest_artifact = capture.artifacts[f'{capture.capture_id}/artifact/manifest.json']
        descriptor = os.open(Path(capture_directory) / 'manifest.json', os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as source:
            raw_manifest = source.read(manifest_artifact['bytes'] + 1)
        if hashlib.sha256(raw_manifest).hexdigest() != capture.manifest_sha256:
            raise ValueError('Native manifest changed during annotation binding')
        created_at = json.loads(raw_manifest).get('created_at')
        if created_at is not None:
            _timestamp(created_at)
        sequence = doc.get('frame_sequence')
        if type(sequence) is not int or sequence < 0:
            raise ValueError('Explicit source frame_sequence required')
        matches = [f for f in capture.frames if f.sequence == sequence]
        if len(matches) != 1 or matches[0].readiness.get('sensor') != 'rear-lidar':
            raise ValueError('Expected one original rear LiDAR frame')
        frame = matches[0]
        if frame.evidence_id in frozen['evidence_ids'] or (frame.source_metadata.get('depth') or {}).get('sha256') in frozen['evidence_hashes']:
            raise ValueError('Depth artifact has already contributed to the baseline')
        projected = rectify_depth_points(frame, depth_to_reference=doc.get('depth_to_reference'), reference_mapping_id=doc['reference_mapping_id'])
        points = []
        for label in ('upper_uv', 'lower_uv'):
            uv = correspondence.get(label)
            if not isinstance(uv, list) or len(uv) != 2 or any(type(v) is not int or v < 0 for v in uv):
                raise ValueError('Correspondence requires exact integer original depth pixels')
            found = np.flatnonzero(np.all(projected['pixels_depth_uv'] == uv, axis=1))
            if len(found) != 1:
                raise ValueError('Corresponding depth pixel is missing or outside calibrated projection')
            points.append(projected['points_camera_m'][found[0]])
        distance = float(np.linalg.norm(points[0] - points[1]))
        if not 0 < distance <= .2:
            raise ValueError('Distinct visible outer-lip endpoints require distance in (0,.2] meters')
        result.update(status='ready', reason=None, baseline_model_id=frozen['model_id'],
            baseline_snapshot_sha256=artifact.sha256, source_kind=doc['source_kind'],
            annotation_sha256=_hash(doc), annotation=doc,
            source_evidence_id=frame.evidence_id, source_manifest_sha256=capture.manifest_sha256,
            source_artifact_hashes={identity: value['sha256'] for identity, value in capture.artifacts.items()},
            source_capture_created_at=created_at,
            projection_lineage=projected['lineage'], timestamp_seconds=frame.timestamp_seconds,
            timebase_id=frame.timebase_id, observed_distance_m=distance,
            observed_endpoints_camera_m=[p.tolist() for p in points], combined_sigma_m=sigma,
            native_provenance=engine.provenance,
            operator_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            adapter_source_hashes={name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in {
                'engine': Path(__file__).with_name('engine.py'),
                'native_capture': Path(__file__).resolve().parents[3] / 'observations/geometry/native_capture.py',
                'rectification': Path(__file__).resolve().parents[3] / 'observations/geometry/rectification.py'}.items()},
            without_depth_order=[h['hypothesis_id'] for h in frozen['hypotheses']],
            comparison={'native_geometry_calls_shared_by_both_conditions': required_calls,
                        'additional_calls_for_without_depth_reference': 0,
                        'without_depth': 'Original acoustic support ordering; no invented acoustic probabilities'},
            limitations=['Conditional single outer-lip distance only; no hidden anatomy measured.',
                'Rigid-distance invariance does not establish landmark correspondence.',
                'JA prior and distance/model uncertainty are declared assumptions, not calibrated posterior.',
                'Separate held scan: no audio/visual synchronization or pose equality with earlier singing.',
                'All retained support kept. Source annotation evidence authenticity is not independently verified.'])
    except (ValueError, TypeError, KeyError, OSError) as error:
        return {**result, 'status': 'rejected', 'reason': str(error)}

    original = engine.anatomy()
    try:
        for hypothesis in frozen['hypotheses']:
            engine.set_anatomy(hypothesis['anatomy'])
            predictions = []
            for ja, weight in zip(values, weights):
                result['actual_geometry_calls'] += 1
                native = engine.lip_markers(pose, {'JA': ja})
                prediction = native.get('distance_m')
                if native.get('operator_id') != OPERATOR_ID or type(prediction) not in (float, int) or not math.isfinite(prediction) or prediction < 0:
                    raise ValueError('Native marker operator returned invalid distance')
                z = (prediction - distance) / sigma
                predictions.append({'JA_requested': ja, 'weight': weight, 'distance_m': prediction,
                                    'standardized_residual': z, 'native': native})
            log_components = [math.log(p['weight']) - .5*p['standardized_residual']**2 for p in predictions]
            cost = float(-2 * logsumexp(log_components))
            if not math.isfinite(cost):
                raise ValueError('Nonfinite native distance discrepancy')
            result['rankings'].append({'hypothesis_id': hypothesis['hypothesis_id'], 'anatomy': hypothesis['anatomy'],
                'depth_discrepancy': cost, 'predictions': predictions})
        order = {v: i for i, v in enumerate(result['without_depth_order'])}
        result['rankings'].sort(key=lambda r: (r['depth_discrepancy'], order[r['hypothesis_id']]))
        result['tied_best_hypotheses'] = [r['hypothesis_id'] for r in result['rankings'] if r['depth_discrepancy'] == result['rankings'][0]['depth_discrepancy']]
        result.update(status='ranked', with_depth_order=[r['hypothesis_id'] for r in result['rankings']],
                      scope='Experimental depth-conditional ranking of existing physical support; caller owns optional adoption')
    except (ValueError, RuntimeError, OSError) as error:
        result.update(status='failed', reason=str(error), rankings=[])
    finally:
        engine.set_anatomy(original)
    return result
