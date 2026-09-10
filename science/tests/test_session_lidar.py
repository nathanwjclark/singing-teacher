from copy import deepcopy
import pytest
from singing_physics.engine import Engine
from singing_physics.service import JobService
from singing_physics.session import SessionController
from singing_physics.session_lidar import digest
from test_session import send, collect
from test_lidar_fusion import preparation


def setup(tmp_path, controller):
    directory=tmp_path/'capture';directory.mkdir()
    with Engine() as engine: snapshot, annotation=preparation(directory,engine)
    send(controller,'register_model',snapshot=snapshot)
    return snapshot,{'capture_directory':str(directory),'annotation':annotation,'enabled':True,'max_geometry_calls':2}


def test_native_adoption_preserves_support_and_replays(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,parameters=setup(tmp_path,controller)
        send(controller,'fit_lidar',parameters=parameters)
        state=collect(controller,service)
        assert state['lidar_fusions'][-1]['status']=='adopted',state['jobs'][-1]
        current=state['snapshot']
        assert current['hypotheses']==list(reversed(baseline['hypotheses']))
        assert set(baseline['evidence_hashes'])<=set(current['evidence_hashes'])
        assert current['lidar_fusion']['scan_pose']=='a'
        assert current['lidar_fusion']['result_sha256']==digest(state['jobs'][-1]['result'])
        restarted=SessionController(tmp_path/'sessions',service,'session')
        assert restarted.execute({'action':'replay'})['state']==state
        repeated=deepcopy(parameters)
        repeated['annotation'].update(model_id=current['model_id'],snapshot_sha256=digest(current))
        send(controller,'fit_lidar',parameters=repeated)
        after=collect(controller,service)
        assert after['snapshot']==current
        assert not after['lidar_fusions'][-1]['model_updated']


def test_disabled_stale_and_changed_archive_preserve_baseline(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,parameters=setup(tmp_path,controller)
        send(controller,'fit_lidar',parameters={**parameters,'enabled':False})
        state=collect(controller,service)
        assert state['snapshot']==baseline and not state['lidar_fusions'][-1]['model_updated']
        with pytest.raises(ValueError,match='stale_session_version'):
            controller.execute({'action':'fit_lidar','parameters':parameters,'command_id':'stale','expected_version':0})
        send(controller,'fit_lidar',parameters=parameters)
        pending=controller.execute({'action':'state'})['state']['pending']
        service.wait(pending['job_id'],timeout_s=30)
        (tmp_path/'capture'/'depth.f32').write_bytes(b'changed after worker completed')
        state=collect(controller,service)
        assert state['snapshot']==baseline
        assert state['lidar_fusions'][-1]['status']=='rejected'


def test_adoption_rejects_partial_support_and_stales_committed_design(tmp_path):
    from singing_physics.lidar_fusion import rank_lidar_hypotheses
    from singing_physics.session_lidar import collect as adopt
    directory=tmp_path/'capture';directory.mkdir()
    with Engine() as engine:
        baseline,annotation=preparation(directory,engine)
        result=rank_lidar_hypotheses(engine,baseline,directory,annotation,enabled=True,max_geometry_calls=2)
    pending={'job_id':'checked-job','base_model_id':baseline['model_id'], 'request':{'parameters':{
        'snapshot':baseline,'capture_directory':str(directory),'annotation':annotation}}}
    state={'snapshot':deepcopy(baseline),'designs':{'old':{'status':'committed'}}}
    partial=deepcopy(result);partial['rankings'].pop()
    adopt(state,pending,'succeeded',partial)
    assert state['snapshot']==baseline and state['lidar_fusions'][-1]['status']=='rejected'
    adopt(state,pending,'succeeded',result)
    assert state['designs']['old']['status']=='stale'
    assert state['snapshot']['lidar_fusion']['observed_distance_m']==result['observed_distance_m']


def test_distinct_scans_share_calibration_but_not_depth_observations(tmp_path):
    import hashlib
    import json
    import numpy as np
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,parameters=setup(tmp_path,controller)
        first=tmp_path/'capture'
        manifest=json.loads((first/'manifest.json').read_text())
        calibration=json.dumps(manifest['frames'][0]['calibration']).encode()
        calibration_hash=hashlib.sha256(calibration).hexdigest()
        (first/'calibration.json').write_bytes(calibration)
        manifest['calibration_artifact']={'path':'calibration.json','bytes':len(calibration),'sha256':calibration_hash}
        (first/'manifest.json').write_text(json.dumps(manifest))
        parameters['annotation']['manifest_sha256']=hashlib.sha256((first/'manifest.json').read_bytes()).hexdigest()
        send(controller,'fit_lidar',parameters=parameters)
        state=collect(controller,service)
        assert state['lidar_fusions'][-1]['status']=='adopted'
        assert calibration_hash in state['snapshot']['evidence_hashes']
        second=tmp_path/'second';second.mkdir()
        (second/'calibration.json').write_bytes(calibration)
        (second/'audio.pcm').write_bytes((first/'audio.pcm').read_bytes())
        # Different observed depth at the same calibrated pixel locations.
        depth=np.full((2,2),.36,dtype='<f4').tobytes()
        (second/'depth.f32').write_bytes(depth)
        manifest['capture_id']='independent-second-scan'
        manifest['frames'][0]['depth']['sha256']=hashlib.sha256(depth).hexdigest()
        (second/'manifest.json').write_text(json.dumps(manifest))
        next_parameters=deepcopy(parameters)
        next_parameters['capture_directory']=str(second)
        next_parameters['annotation'].update(model_id=state['snapshot']['model_id'],snapshot_sha256=digest(state['snapshot']),
            capture_id=manifest['capture_id'],manifest_sha256=hashlib.sha256((second/'manifest.json').read_bytes()).hexdigest())
        send(controller,'fit_lidar',parameters=next_parameters)
        second_state=collect(controller,service)
        assert second_state['lidar_fusions'][-1]['status']=='adopted',second_state['lidar_fusions'][-1]
        assert second_state['snapshot']['model_id']!=state['snapshot']['model_id']
        assert second_state['snapshot']['lidar_fusion']['projection_lineage']['calibration_sha256']==state['snapshot']['lidar_fusion']['projection_lineage']['calibration_sha256']
        # Relabeling the exact depth bytes still cannot add another likelihood.
        manifest['capture_id']='relabelled-second-scan'
        (second/'manifest.json').write_text(json.dumps(manifest))
        next_parameters['annotation'].update(model_id=second_state['snapshot']['model_id'],snapshot_sha256=digest(second_state['snapshot']),
            capture_id=manifest['capture_id'],manifest_sha256=hashlib.sha256((second/'manifest.json').read_bytes()).hexdigest())
        send(controller,'fit_lidar',parameters=next_parameters)
        rejected=collect(controller,service)
        assert rejected['snapshot']==second_state['snapshot']
        assert not rejected['lidar_fusions'][-1]['model_updated']
