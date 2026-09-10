import hashlib
import json
import shutil
import subprocess
import pytest
from science.scripts.app_visual import index_frames,frame_image,visual_frames

@pytest.mark.skipif(not shutil.which('ffmpeg'),reason='Optional decoder unavailable')
@pytest.mark.parametrize('crash_action',[None,'forecast_visual','collect_job'])
def test_native_visual_app_freeze_score_and_recovery(tmp_path,monkeypatch,crash_action):
    from science.scripts import app_visual
    from science.scripts.live_capture_jobs import LocalBackend
    from singing_physics.service import JobService
    from singing_physics.session import SessionController
    from test_session_visual import setup
    video=tmp_path/'synthetic.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=1000x1000:r=3:d=1','-c:v','mpeg4','-an',str(video)],check=True)
    media=video.read_bytes();mh=hashlib.sha256(media).hexdigest();raw=json.dumps({'provenance':{'kind':'development-fixture'},'media':{'sha256':mh}}).encode()
    rh=hashlib.sha256(raw).hexdigest();identity=hashlib.sha256((rh+mh).encode()).hexdigest();folder=tmp_path/'motion-captures'/identity;folder.mkdir(parents=True)
    (folder/'record.json').write_bytes(raw);(folder/'media').write_bytes(media);(folder/'summary.json').write_text(json.dumps({'recordSha256':rh,'mediaSha256':mh,'mediaByteLength':len(media)}))
    voice=tmp_path/'science-runs/voice';voice.mkdir(parents=True)
    (tmp_path/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'voice'}));(voice/'summary.json').write_text(json.dumps({'sessionId':'session'}))
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(service.root/'sessions',service,'session');baseline,params,target=setup(controller)
        def backend(*args):
            value=LocalBackend(service,'session');execute=value.execute
            def fault(command):
                nonlocal crash_action
                result=execute(command)
                if command['action']==crash_action:crash_action=None;raise SystemExit('simulated committed-side-effect process loss')
                return result
            value.execute=fault;return value
        monkeypatch.setattr(app_visual,'HTTPBackend',backend)
        def row(value,index):return {'frameIndex':index,'pose':value['pose'],'assumedJA':value['assumed_JA'],'visibility':value['visibility'],'upperPixel':value['upper_px'],'lowerPixel':value['lower_px']}
        request={'operation':'freeze','captureId':identity,'expectedModelId':baseline['model_id'],'forecastId':'visual','requestId':'freeze','experimentalDeclaration':True,
            'cameraCandidates':params['camera_candidates'],'calibrationTolerancePx':1.,'calibrationFrames':[row(params['calibration_frames'][0],0)],'targets':[{'frameIndex':1,'pose':'a','assumedJA':-4.}]}
        path=tmp_path/'request.json';path.write_text(json.dumps(request));output=tmp_path/'freeze'
        if crash_action:
            with pytest.raises(SystemExit):app_visual.execute_experiment(tmp_path,path,output)
        result=app_visual.execute_experiment(tmp_path,path,output)
        assert result['sourceKind']=='development-fixture'
        frozen=controller.execute({'action':'state'})['state']['visual_forecasts']['visual']['artifact']
        assert app_visual.execute_experiment(tmp_path,path,output)==result
        request={'operation':'score','captureId':identity,'forecastId':'visual','annotations':[row(target(),1)],'requestId':'score','experimentalDeclaration':True}
        path=tmp_path/'score.json';path.write_text(json.dumps(request));app_visual.execute_experiment(tmp_path,path,tmp_path/'score')
        state=controller.execute({'action':'state'})['state'];assert state['snapshot']==baseline
        assert state['visual_forecasts']['visual']['artifact']==frozen
        assert state['visual_forecasts']['visual']['status']=='scored'
        assert state['visual_forecasts']['visual']['score_result']['artifact']['scores'][0]['heldout_rms_px']<1e-10


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'),reason='Optional video decoder unavailable')
def test_exact_encoded_frame_identity_dimensions_pts_and_source_integrity(tmp_path):
    video=tmp_path/'synthetic.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=80x48:r=3:d=1','-c:v','mpeg4','-an',str(video)],check=True)
    media=video.read_bytes();media_hash=hashlib.sha256(media).hexdigest()
    record={'provenance':{'kind':'development-fixture'},'media':{'sha256':media_hash}}
    raw=json.dumps(record).encode();record_hash=hashlib.sha256(raw).hexdigest();identity=hashlib.sha256((record_hash+media_hash).encode()).hexdigest()
    folder=tmp_path/'motion-captures'/identity;folder.mkdir(parents=True)
    (folder/'record.json').write_bytes(raw);(folder/'media').write_bytes(media)
    (folder/'summary.json').write_text(json.dumps({'recordSha256':record_hash,'mediaSha256':media_hash,'mediaByteLength':len(media)}))
    indexed=index_frames(tmp_path,identity)
    assert len(indexed['frames'])==3 and indexed['rotationApplied'] is False
    assert indexed['sourceKind']=='development-fixture'
    assert [r['frameIndex'] for r in indexed['frames']]==[0,1,2]
    assert indexed['frames'][1]['ptsSeconds']==pytest.approx(1/3,abs=1e-5)
    extracted=frame_image(tmp_path,identity,1)
    assert [extracted['width'],extracted['height']]==[80,48]
    png=(tmp_path/'visual-frames'/identity/'frame-1.png').read_bytes()
    assert hashlib.sha256(png).hexdigest()==extracted['pngSha256']
    assert frame_image(tmp_path,identity,1)==extracted
    annotation={'frameIndex':1,'pose':'a','assumedJA':-3.,'visibility':'occluded','upperPixel':None,'lowerPixel':None}
    value=visual_frames([annotation],indexed,True)[0]
    assert value['upper_px'] is None and value['visibility']=='occluded'
    assert value['media_sha256']==media_hash and value['video_frame_index']==1
    with pytest.raises(ValueError,match='reference'):visual_frames([{**annotation,'frameIndex':99}],indexed,True)
    (folder/'media').write_bytes(media[:-1]+bytes([media[-1]^1]))
    with pytest.raises(ValueError,match='integrity'):frame_image(tmp_path,identity,1)
