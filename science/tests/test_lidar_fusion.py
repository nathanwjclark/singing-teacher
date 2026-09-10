import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json

import numpy as np
import pytest

from singing_physics.engine import ANATOMY, Engine
from singing_physics.lidar_fusion import VERSION, rank_lidar_hypotheses
from singing_physics.pcm_design import SCHEMA
from singing_physics.prediction import _encode
from test_native_capture_geometry import fixture


def preparation(tmp_path, engine):
    first = engine.anatomy()
    second = engine.set_anatomy({'lip_width': 1.5})
    distance = engine.lip_markers('a', {'JA': -3})['distance_m']
    engine.set_anatomy(first)
    now = datetime.now(timezone.utc).isoformat()
    snapshot = {'schema_version': SCHEMA, 'kind': 'frozen_pcm_hypotheses', 'model_id': 'baseline-model',
        'evidence_ids': ['prior-audio'], 'evidence_hashes': ['a'*64], 'provenance': engine.provenance,
        'hypotheses': [{'hypothesis_id': 'acoustic-first', 'anatomy': first}, {'hypothesis_id': 'depth-match', 'anatomy': second}],
        'frozen_at': now, 'sealed_at': now, 'anatomy_units': {name: unit for name, unit, *_ in ANATOMY}}
    manifest, save = fixture(tmp_path)
    manifest.update(capture_mode='separate-rear-lidar-held-pose', sensor='rear-lidar')
    manifest['device'].update(device_type='AVCaptureDeviceTypeBuiltInLiDARDepthCamera', position='back', sensor='rear-lidar')
    row = manifest['frames'][0]
    raw = np.full((2, 2), .35, dtype='<f4').tobytes()
    (tmp_path/'depth.f32').write_bytes(raw)
    row['depth'].update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    calibration = row['calibration']
    calibration['intrinsics_row_major'] = [[.35/distance, 0, 1], [0, .35/distance, 1], [0, 0, 1]]
    # Synthetic optical fixture is declared; a null physical LUT is never replaced.
    calibration['inverse_lens_distortion_table_base64'] = base64.b64encode(np.zeros(2, dtype='<f4').tobytes()).decode()
    save()
    doc = {'schema_version': VERSION, 'model_id': snapshot['model_id'], 'snapshot_sha256': hashlib.sha256(_encode(snapshot)).hexdigest(),
        'capture_id': manifest['capture_id'], 'manifest_sha256': hashlib.sha256((tmp_path/'manifest.json').read_bytes()).hexdigest(),
        'frame_sequence': 0, 'depth_to_reference': np.eye(3).tolist(), 'reference_mapping_id': 'fixture-exact-identity',
        'registration': {'kind': 'rigid-distance-invariant', 'evidence_id': 'declared-fixture-invariance', 'source_hashes': ['b'*64]},
        'correspondence': {'operator_id': 'vtl-upper4-lower5-vertex89-distance-v1', 'upper_surface_vertex': [4,89], 'lower_surface_vertex': [5,89],
            'evidence_id': 'fixture-source-marker-correspondence', 'source_hashes': ['c'*64], 'upper_uv': [0,0], 'lower_uv': [1,0]},
        'pose': 'a', 'JA_values': [-3.], 'JA_weights': [1.], 'measurement_sigma_m': .0002, 'model_sigma_m': .0002,
        'uncertainty_scope': 'Declared synthetic diagnostic scale, not physical sensor calibration', 'source_kind': 'development-fixture'}
    return snapshot, doc


def test_original_depth_changes_native_support_order_without_mutating_baseline(tmp_path):
    with Engine() as engine:
        snapshot, doc = preparation(tmp_path, engine)
        original = deepcopy(snapshot); anatomy = engine.anatomy()
        result = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True, max_geometry_calls=2)
        assert result['status'] == 'ranked', result
        assert result['without_depth_order'] == ['acoustic-first', 'depth-match']
        assert result['with_depth_order'] == ['depth-match', 'acoustic-first']
        assert result['rankings'][0]['depth_discrepancy'] < 1e-6
        assert result['actual_geometry_calls'] == 2
        assert result['comparison']['native_geometry_calls_shared_by_both_conditions'] == 2
        assert result['projection_lineage']['source_manifest_sha256'] == doc['manifest_sha256']
        assert result['baseline_preserved'] and not result['model_updated']
        assert result['source_capture_created_at'] is None
        assert result['source_artifact_hashes'][result['source_evidence_id']] == result['projection_lineage']['source_artifact_sha256']
        assert snapshot == original and engine.anatomy() == anatomy
        replay = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True, max_geometry_calls=2)
        assert replay == result


def test_missing_invalid_disabled_and_tampered_evidence_preserve_baseline(tmp_path):
    with Engine() as engine:
        snapshot, doc = preparation(tmp_path, engine)
        anatomy = engine.anatomy()
        disabled = rank_lidar_hypotheses(engine, snapshot, '/absent', None)
        assert disabled['status'] == 'disabled' and disabled['actual_geometry_calls'] == 0
        edits = [lambda d: d.update(snapshot_sha256='d'*64), lambda d: d.update(measurement_sigma_m=0),
            lambda d: d.update(measurement_sigma_m=1e-250), lambda d: d.update(JA_weights=[.5]), lambda d: d['correspondence'].update(upper_surface_vertex=[4,88]),
            lambda d: d['correspondence'].update(upper_uv=[20,20]), lambda d: d['registration'].update(kind='guessed-camera-pose')]
        for edit in edits:
            invalid = deepcopy(doc); edit(invalid)
            result = rank_lidar_hypotheses(engine, snapshot, tmp_path, invalid, enabled=True)
            assert result['status'] == 'rejected' and result['actual_geometry_calls'] == 0, result
        budget = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True, max_geometry_calls=1)
        assert budget['status'] == 'rejected' and budget['actual_geometry_calls'] == 0
        (tmp_path/'depth.f32').write_bytes(b'altered')
        result = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True)
        assert result['status'] == 'rejected' and result['actual_geometry_calls'] == 0
        assert engine.anatomy() == anatomy


def test_nuisance_mixture_and_native_failure_are_bounded(tmp_path, monkeypatch):
    with Engine() as engine:
        snapshot, doc = preparation(tmp_path, engine)
        doc.update(JA_values=[-4., -3., -2.], JA_weights=[.2,.5,.3])
        original = engine.anatomy()
        result = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True, max_geometry_calls=6)
        assert result['status'] == 'ranked' and result['actual_geometry_calls'] == 6
        assert all(len(r['predictions']) == 3 for r in result['rankings'])
        for row in result['rankings']:
            terms = [p['weight'] * np.exp(-.5*p['standardized_residual']**2) for p in row['predictions']]
            assert row['depth_discrepancy'] == pytest.approx(-2*np.log(sum(terms)))
        def fail(*args, **kwargs):
            raise RuntimeError('native export unavailable')
        monkeypatch.setattr(engine, 'lip_markers', fail)
        result = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True)
        assert result['status'] == 'failed' and result['actual_geometry_calls'] == 1 and not result['rankings']
        assert engine.anatomy() == original


@pytest.mark.parametrize('change', [
    lambda row: row.update(depth_filtered=True),
    lambda row: row.update(depth_accuracy_label='relative'),
    lambda row: row['calibration'].update(inverse_lens_distortion_table_base64=None),
])
def test_unmeasured_or_uncalibrated_pixels_do_not_enter_likelihood(tmp_path, change):
    with Engine() as engine:
        snapshot, doc = preparation(tmp_path, engine)
        manifest = json.loads((tmp_path/'manifest.json').read_text())
        change(manifest['frames'][0])
        (tmp_path/'manifest.json').write_text(json.dumps(manifest))
        doc['manifest_sha256'] = hashlib.sha256((tmp_path/'manifest.json').read_bytes()).hexdigest()
        result = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True)
        assert result['status'] == 'rejected' and result['actual_geometry_calls'] == 0
        assert result['baseline_preserved'] and not result['model_updated']


def test_numerically_indistinguishable_markers_preserve_acoustic_order(tmp_path, monkeypatch):
    with Engine() as engine:
        snapshot, doc = preparation(tmp_path, engine)
        snapshot['hypotheses'][1]['anatomy'] = engine.set_anatomy({'hard_palate_length': 4.8})
        doc['snapshot_sha256'] = hashlib.sha256(_encode(snapshot)).hexdigest()
        native = engine.lip_markers
        def limited_precision(*args, **kwargs):
            result = native(*args, **kwargs)
            if engine.anatomy()['hard_palate_length'] > 4.7:
                result['distance_m'] += 1e-8
            return result
        monkeypatch.setattr(engine, 'lip_markers', limited_precision)
        result = rank_lidar_hypotheses(engine, snapshot, tmp_path, doc, enabled=True, max_geometry_calls=2)
        assert result['status'] == 'ranked'
        assert result['with_depth_order'] == result['without_depth_order']
        assert len(result['tied_best_hypotheses']) == 2
        assert result['distance_equivalence']['tolerance_m'] == 1e-6
        assert len(result['distance_equivalence']['groups']) == 1
        assert result['rankings'][0]['depth_discrepancy'] == result['rankings'][1]['depth_discrepancy']
