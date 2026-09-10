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
