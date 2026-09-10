"""Atomic, additive adoption of experimental depth ordering on retained support."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import math

from observations.geometry.native_capture import read_native_capture
from .prediction import Artifact, _encode
from .pcm_design import _snapshot


def digest(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def prepare(state, parameters):
    if not state['snapshot'] or state['pending']:
        raise ValueError('LiDAR ranking requires an idle current model')
    if not isinstance(parameters, dict) or set(parameters)-{'capture_directory','annotation','enabled','max_geometry_calls'} or not {'capture_directory','annotation'} <= set(parameters):
        raise ValueError('Invalid LiDAR parameters')
    return {**deepcopy(parameters), 'snapshot': deepcopy(state['snapshot'])}


def collect(state, pending, status, result):
    """A failed, disabled, or incomplete result records an attempt without adoption."""
    parent = state['snapshot']
    receipt = {'job_id': pending['job_id'], 'status': status, 'model_updated': False,
               'baseline_model_id': pending['base_model_id'],
               'received_at': datetime.now(timezone.utc).isoformat(),
               'result_sha256': digest(result) if result is not None else None}
    state.setdefault('lidar_fusions', []).append(receipt)
    if status != 'succeeded' or not result or result.get('status') != 'ranked':
        receipt.update(reason=(result or {}).get('reason', status), numerical_status=(result or {}).get('status'))
        return
    try:
        params = pending['request']['parameters']
        if (parent['model_id'] != pending['base_model_id'] or digest(parent) != digest(params['snapshot'])
                or result['baseline_model_id'] != parent['model_id'] or result['baseline_snapshot_sha256'] != digest(parent)
                or result['annotation_sha256'] != digest(params['annotation']) or result['native_provenance'] != parent['provenance']):
            raise ValueError('Stale or incompatible LiDAR result binding')
        capture = read_native_capture(params['capture_directory'], allow_rear_lidar=True)
        if capture.manifest_sha256 != result['source_manifest_sha256']:
            raise ValueError('Original LiDAR archive changed after evaluation')
        original_hashes = {k:a['sha256'] for k,a in capture.artifacts.items()}
        if original_hashes != result['source_artifact_hashes']:
            raise ValueError('Original LiDAR artifact hashes differ from evaluated evidence')
        hashes = set(original_hashes.values())
        ids = set(capture.artifacts) | {capture.capture_id, result['source_evidence_id']}
        # Calibration/reference artifacts may legitimately recur across new scans.
        # Observation reuse is bound to the selected depth bytes and its manifest.
        observation_hashes = {capture.manifest_sha256, result['projection_lineage']['source_artifact_sha256']}
        observation_ids = {capture.capture_id, result['source_evidence_id']}
        if observation_hashes & set(parent['evidence_hashes']) or observation_ids & set(parent['evidence_ids']):
            raise ValueError('LiDAR original evidence already contributed to model')
        by_id = {h['hypothesis_id']: h for h in parent['hypotheses']}
        rows = result['rankings']; order = result['with_depth_order']
        if (len(rows) != len(by_id) or len(order) != len(by_id) or set(order) != set(by_id)
                or [r['hypothesis_id'] for r in rows] != order):
            raise ValueError('Incomplete retained LiDAR support')
        for row in rows:
            if row['anatomy'] != by_id[row['hypothesis_id']]['anatomy'] or not math.isfinite(row['depth_discrepancy']):
                raise ValueError('LiDAR geometry or score changed')
        annotation = params['annotation']
        for role in ('registration', 'correspondence'):
            ids.add(annotation[role]['evidence_id']); hashes.update(annotation[role]['source_hashes'])
        fusion = {key: deepcopy(result[key]) for key in ('baseline_model_id','baseline_snapshot_sha256','annotation_sha256',
            'source_evidence_id','source_manifest_sha256','projection_lineage','timestamp_seconds','timebase_id',
            'observed_distance_m','combined_sigma_m','source_kind','without_depth_order','with_depth_order','rankings','operator_sha256','adapter_source_hashes','limitations')}
        fusion['distance_equivalence']=deepcopy(result.get('distance_equivalence'))
        fusion.update(result_sha256=digest(result), job_id=pending['job_id'], source_artifact_hashes={k:a['sha256'] for k,a in capture.artifacts.items()},
            measurement_sigma_m=annotation['measurement_sigma_m'], model_sigma_m=annotation['model_sigma_m'],
            scan_pose=annotation['pose'], scan_JA_values=annotation['JA_values'], scan_JA_weights=annotation['JA_weights'],
            source_capture_created_at=result.get('source_capture_created_at'),
            scope='Conditional depth ordering; acoustic support retained, no calibrated posterior or simultaneous singing pose')
        now = receipt['received_at']
        updated = {**deepcopy(parent), 'model_id':'lidar-model:'+digest([digest(parent),digest(result)]),
            'parent_snapshot_sha256':digest(parent), 'lidar_fusion':fusion,
            'hypotheses':[deepcopy(by_id[k]) for k in order],
            'evidence_ids': sorted(set(parent['evidence_ids']) | ids), 'evidence_hashes':sorted(set(parent['evidence_hashes']) | hashes),
            'frozen_at':now,'sealed_at':now}
        artifact=Artifact(_encode(updated)); _snapshot(artifact,artifact.sha256)
    except (ValueError, KeyError, TypeError, OSError) as error:
        receipt.update(status='rejected', reason=str(error))
        return
    state['snapshot']=updated
    for design in state['designs'].values():
        if design['status'] in ('committed','unsupported'): design['status']='stale'
    receipt.update(status='adopted', model_updated=True, model_id=updated['model_id'],
                   snapshot_sha256=digest(updated), without_depth_order=result['without_depth_order'],with_depth_order=order)
