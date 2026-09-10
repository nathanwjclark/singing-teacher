from copy import deepcopy
from datetime import datetime, timezone

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.prediction import Artifact, _encode
from singing_physics.visual_likelihood import OPERATOR, freeze_visual_forecast, score_visual_forecast


COORDINATES = {'id':'synthetic-original-segment', 'width_px':640, 'height_px':480,
               'transform':'decoded-original-pixels'}
CAMERA = {'camera_id':'front', 'rotation_3x3':np.eye(3).tolist(), 'scale_px_per_m':1000.}


def now():
    return datetime.now(timezone.utc).isoformat()


def base(identity, index, jaw):
    return {'frame_id':identity, 'media_sha256':'a'*64, 'video_frame_index':index,
            'pose':'a', 'assumed_JA':jaw}


def annotation(frame, vector=None, offset=(200., 200.)):
    return {**frame, 'annotation_created_at':now(), 'correspondence_operator_id':OPERATOR,
            'annotation_method':'explicit-native-marker-correspondence',
            'visibility':'visible' if vector is not None else 'occluded',
            'upper_px':(np.asarray(offset)+np.asarray(vector)).tolist() if vector is not None else None,
            'lower_px':list(offset) if vector is not None else None}


@pytest.fixture
def fixture():
    hypotheses = [{'hypothesis_id':'first','anatomy':{'lip_width':.8}},
                  {'hypothesis_id':'second','anatomy':{'lip_width':1.3}}]
    calibration = base('calibration',0,-2.)
    target = base('target',10,-4.)
    with Engine() as engine:
        engine.set_anatomy(hypotheses[0]['anatomy'])
        markers = engine.lip_markers('a',{'JA':-2.})
        vector = (np.asarray(markers['positions_m']['upper'])-np.asarray(markers['positions_m']['lower']))[:2]*1000
        provenance = engine.provenance
    kwargs = dict(model_id='synthetic-model',hypotheses=hypotheses,camera_candidates=[CAMERA],
                  calibration_frames=[annotation(calibration,vector)],targets=[target],
                  coordinate_system=COORDINATES,expected_provenance=provenance,
                  calibration_tolerance_px=0.,max_geometry_calls=4)
    return kwargs


def test_actual_native_frozen_projection_scores_translation_invariant_holdout(fixture):
    frozen = freeze_visual_forecast(**fixture)
    data = frozen.data
    assert data['budget']['actual_geometry_calls'] == 4
    assert data['budget']['synthesis_calls'] == 0
    assert data['pairs'][0]['calibration_rms_px'] == pytest.approx(0,abs=1e-12)
    assert data['native_hypotheses'][0]['frames'][1]['applied_articulation']['JA']['applied'] == -4.
    vector = data['pairs'][0]['target_vectors_px'][0]
    target = annotation(data['targets'][0],vector)
    before = frozen.content
    first = score_visual_forecast(frozen,expected_digest=frozen.sha256,annotations=[target]).data
    shifted = annotation(data['targets'][0],vector,offset=(300.,300.))
    second = score_visual_forecast(frozen,expected_digest=frozen.sha256,annotations=[shifted]).data
    assert first['status'] == second['status'] == 'scored'
    assert first['scores'][0]['heldout_rms_px'] == pytest.approx(0,abs=1e-12)
    assert second['scores'][0]['heldout_rms_px'] == pytest.approx(0,abs=1e-12)
    assert frozen.content == before
    assert first['geometry_calls'] == first['synthesis_calls'] == 0
    target['upper_px'][0] += 7
    changed = score_visual_forecast(frozen,expected_digest=frozen.sha256,annotations=[target]).data
    assert changed['scores'][0]['heldout_rms_px'] == pytest.approx(7.)
    assert frozen.content == before


def test_duplicate_geometry_and_camera_ambiguity_are_retained(fixture):
    fixture['hypotheses'][1]['anatomy'] = deepcopy(fixture['hypotheses'][0]['anatomy'])
    fixture['camera_candidates'].append({**CAMERA,'camera_id':'equivalent-fixed-camera'})
    frozen = freeze_visual_forecast(**fixture).data
    assert len(frozen['pairs']) == 4
    assert all(row['retained'] for row in frozen['pairs'])
    assert len({row['hypothesis_id'] for row in frozen['pairs']}) == 2
    # Camera combinations cost no extra native exports.
    assert frozen['budget']['actual_geometry_calls'] == 4


def test_missing_calibration_and_heldout_keep_missing_not_zero(fixture):
    fixture['calibration_frames'][0] = annotation({k:v for k,v in fixture['calibration_frames'][0].items()
                                                 if k in base('x',0,0)})
    frozen = freeze_visual_forecast(**fixture)
    assert frozen.data['calibration_status'] == 'missing_calibration'
    assert all(row['retained'] and row['calibration_rms_px'] is None for row in frozen.data['pairs'])
    result = score_visual_forecast(frozen,expected_digest=frozen.sha256,
                                  annotations=[annotation(frozen.data['targets'][0])]).data
    assert result['status'] == 'missing_required_evidence'
    assert result['missing_frame_ids'] == ['target']
    assert all(row['heldout_rms_px'] is None for row in result['scores'])


def test_budget_correspondence_pixels_camera_and_duplicate_evidence(fixture):
    cases = []
    changed = deepcopy(fixture); changed['max_geometry_calls'] = 3; cases.append(changed)
    changed = deepcopy(fixture); changed['calibration_frames'][0]['correspondence_operator_id'] = 'mediapipe-13-14'; cases.append(changed)
    changed = deepcopy(fixture); changed['calibration_frames'][0]['upper_px'][0] = 640; cases.append(changed)
    changed = deepcopy(fixture); changed['camera_candidates'][0]['rotation_3x3'][0][0] = -1; cases.append(changed)
    changed = deepcopy(fixture); changed['targets'][0]['video_frame_index'] = 0; cases.append(changed)
    changed = deepcopy(fixture); changed['camera_candidates'][0]['scale_px_per_m'] = 0; cases.append(changed)
    # Hold Engine ownership: these failures must precede any attempt to open native.
    with Engine():
        for kwargs in cases:
            with pytest.raises(ValueError):
                freeze_visual_forecast(**kwargs)


def test_digest_policy_version_chronology_and_target_binding(fixture):
    frozen = freeze_visual_forecast(**fixture)
    target = annotation(frozen.data['targets'][0],frozen.data['pairs'][0]['target_vectors_px'][0])
    with pytest.raises(ValueError,match='digest'):
        score_visual_forecast(frozen,expected_digest='b'*64,annotations=[target])
    changed = frozen.data; changed['policy']['version'] = 'old'
    altered = Artifact(_encode(changed))
    with pytest.raises(ValueError,match='policy'):
        score_visual_forecast(altered,expected_digest=altered.sha256,annotations=[target])
    for field,value in [('annotation_created_at',fixture['calibration_frames'][0]['annotation_created_at']),
                        ('video_frame_index',11),('assumed_JA',-1.),('frame_id','renamed')]:
        wrong = {**target,field:value}
        with pytest.raises(ValueError):
            score_visual_forecast(frozen,expected_digest=frozen.sha256,annotations=[wrong])
    changed = frozen.data; changed['provenance']['geometry_basis'] = 'old-basis'
    altered = Artifact(_encode(changed))
    with pytest.raises(ValueError,match='provenance'):
        score_visual_forecast(altered,expected_digest=altered.sha256,annotations=[target])
