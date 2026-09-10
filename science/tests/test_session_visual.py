from copy import deepcopy
from datetime import datetime,timezone
import pytest
from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_session import send,collect


def setup(controller):
    now=lambda:datetime.now(timezone.utc).isoformat()
    with Engine() as engine:
        anatomy=engine.anatomy();provenance=engine.provenance
        positions=[engine.lip_markers('a',{'JA':ja})['positions_m'] for ja in (-2.,-4.)]
    snapshot=freeze_pcm_hypotheses(model_id='visual-baseline',evidence_ids=['acoustic'],evidence_hashes=['a'*64],provenance=provenance,
        hypotheses=[{'hypothesis_id':'retained','anatomy':anatomy}],frozen_at=now()).data
    send(controller,'register_model',snapshot=snapshot)
    frames=[{'frame_id':f'frame-{i}','media_sha256':'b'*64,'video_frame_index':i,'pose':'a','assumed_JA':ja} for i,ja in enumerate((-2.,-4.))]
    def annotate(frame,position):
        return {**frame,'annotation_created_at':now(),'correspondence_operator_id':'vtl-upper4-lower5-vertex89-distance-v1',
            'annotation_method':'explicit-native-marker-correspondence','visibility':'visible',
            'upper_px':[200+1000*v for v in position['upper'][:2]],'lower_px':[200+1000*v for v in position['lower'][:2]]}
    parameters={'camera_candidates':[{'camera_id':'declared-camera','rotation_3x3':[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]],'scale_px_per_m':1000.}],
        'calibration_frames':[annotate(frames[0],positions[0])],'targets':[frames[1]],
        'coordinate_system':{'id':'original-video','width_px':1000,'height_px':1000,'transform':'decoded-original-pixels'},'max_geometry_calls':2}
    return snapshot,parameters,lambda:annotate(frames[1],positions[1])


def test_native_visual_forecast_holdout_restart_preserves_baseline(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,parameters,annotation=setup(controller)
        send(controller,'forecast_visual',forecast_id='visual-one',parameters=parameters)
        state=collect(controller,service)
        assert state['visual_forecasts']['visual-one']['status']=='committed',state['jobs'][-1]
        assert state['snapshot']==baseline
        frozen=deepcopy(state['visual_forecasts']['visual-one']['artifact'])
        restarted=SessionController(tmp_path/'sessions',service,'session')
        send(restarted,'score_visual',forecast_id='visual-one',parameters={'annotations':[annotation()]})
        state=collect(restarted,service)
        result=state['visual_forecasts']['visual-one']
        assert result['status']=='scored',state['jobs'][-1]
        assert result['artifact']==frozen and state['snapshot']==baseline
        assert result['score_result']['artifact']['scores'][0]['heldout_rms_px']<1e-10
        assert result['score_result']['artifact']['geometry_calls']==0
        with pytest.raises(ValueError,match='already committed'):
            send(restarted,'forecast_visual',forecast_id='reused',parameters=parameters)


def test_missing_stale_and_precommit_annotations_do_not_update_model(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,parameters,annotation=setup(controller)
        early=annotation()
        send(controller,'forecast_visual',forecast_id='visual-one',parameters=parameters)
        state=collect(controller,service)
        with pytest.raises(ValueError,match='follow session'):
            send(controller,'score_visual',forecast_id='visual-one',parameters={'annotations':[early]})
        missing=annotation();missing.update(visibility='occluded',upper_px=None,lower_px=None)
        send(controller,'score_visual',forecast_id='visual-one',parameters={'annotations':[missing]})
        state=collect(controller,service)
        assert state['visual_forecasts']['visual-one']['status']=='unscorable' and state['snapshot']==baseline
        changed=deepcopy(parameters);changed['targets'][0].update(frame_id='new-frame',video_frame_index=2)
        send(controller,'forecast_visual',forecast_id='visual-next',parameters=changed)
        state=collect(controller,service)
        newer=deepcopy(baseline);newer['model_id']='new-baseline'
        send(controller,'register_model',snapshot=newer)
        state=controller.execute({'action':'state'})['state']
        assert state['visual_forecasts']['visual-next']['status']=='stale'
