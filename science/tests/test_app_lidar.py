import hashlib
import json
import zipfile
import numpy as np
import pytest
from science.scripts.app_lidar import prepare,frame_data,annotation_for
from test_native_capture_geometry import fixture


def archived(tmp_path):
    original=tmp_path/'native';original.mkdir();manifest,save=fixture(original)
    identity='12345678-1234-1234-1234-123456789abc'
    manifest.update(capture_id=identity,capture_mode='separate-rear-lidar-held-pose')
    manifest['device'].update(device_type='AVCaptureDeviceTypeBuiltInLiDARDepthCamera',position='back',sensor='rear-lidar');save()
    root=tmp_path/'data';(root/'usb-imports').mkdir(parents=True)
    name='rear-lidar-'+identity+'.zip'
    with zipfile.ZipFile(root/'usb-imports'/name,'w') as z:
        for path in original.iterdir():z.write(path,path.name)
    raw=(root/'usb-imports'/name).read_bytes()
    (root/'native-pull-latest.json').write_text(json.dumps({'name':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}))
    return root,identity,raw


def test_raw_rear_archive_roundtrip_annotation_and_tamper(tmp_path):
    root,identity,raw=archived(tmp_path)
    capture=prepare(root);assert capture['captureId']==identity and capture['separateScan']
    assert capture==prepare(root)
    assert (root/'lidar-imports'/capture['importId']/'original.zip').read_bytes()==raw
    frame=frame_data(root,identity,0)
    assert frame['width']==2 and frame['height']==2
    assert len(frame['depthM'])==4
    with pytest.raises(ValueError,match='changed'):frame_data(root,'different',0)
    declaration={'frameSequence':0,'upperPixel':[0,0],'lowerPixel':[1,0],'depthToReference':np.eye(3).tolist(),
        'referenceMappingExplanation':'Explicit synthetic identity mapping','pose':'a','jawValues':[-3.],'jawWeights':[1.],
        'measurementSigmaM':.001,'modelSigmaM':.002,'uncertaintyExplanation':'Declared experimental scale, not measured uncertainty',
        'correspondenceExplanation':'Hypothesized source outer marker correspondence','registrationExplanation':'Same-frame rigid-distance invariant comparison',
        'experimentalDeclaration':True,'sourceKind':'development-fixture'}
    output=tmp_path/'fit';output.mkdir()
    result=annotation_for(declaration,{'model_id':'fixture-model'},capture,output)
    assert result['registration']['source_hashes']==result['correspondence']['source_hashes']
    assert result['registration']['source_hashes'][0]==hashlib.sha256((output/'experimental-declaration.json').read_bytes()).hexdigest()
    assert result['manifest_sha256']==capture['manifestSha256']
    assert result['source_kind']=='development-fixture'
    archive=root/'usb-imports'/('rear-lidar-'+identity+'.zip');changed=bytearray(raw);changed[-1]^=1;archive.write_bytes(changed)
    with pytest.raises(ValueError,match='hash mismatch'):prepare(root)


def test_unapproved_annotation_never_gets_evidence_binding(tmp_path):
    with pytest.raises(ValueError,match='experimental geometry'):
        annotation_for({'experimentalDeclaration':False},{},{},tmp_path)
    assert not (tmp_path/'experimental-declaration.json').exists()


@pytest.mark.parametrize('numerical_status,adoption_status',[('ranked','rejected'),('rejected','succeeded')])
def test_ranked_numerical_result_rejected_by_session_is_not_included(tmp_path,numerical_status,adoption_status):
    from science.scripts.app_lidar import finish,digest
    from singing_physics.service import canonical
    intent={'sessionId':'session','parentModelId':'parent','captureId':'capture','importId':'import','archiveSha256':'a'*64,
        'command':{'command_id':'fit-command'}}
    key='session:'+digest(canonical(['session','fit-command']).encode())
    state={'jobs':[{'key':key,'job_id':'job','status':'succeeded','result':{'status':numerical_status,'with_depth_order':['first']}}],
        'pending':None,'lidar_fusions':[{'job_id':'job','status':adoption_status,'reason':'source evidence changed','model_updated':False,'model_id':'parent'}]}
    class Backend:
        def execute(self,command):return {'state':state} if command['action']=='state' else {'events':[]}
    answer=finish(Backend(),intent,tmp_path)
    assert answer['status']=='rejected' and answer['includedInFit'] is False
    assert answer['reason']=='source evidence changed' and answer['modelId']=='parent'
    assert answer['result']['status']==numerical_status
    assert answer['geometry'] is None


def test_adoption_receipt_survives_subsequent_geometry_export_failure(tmp_path):
    from science.scripts.app_lidar import finish,digest
    from singing_physics.service import canonical
    intent={'sessionId':'session','parentModelId':'parent','captureId':'capture','importId':'import','archiveSha256':'a'*64,
        'parentSnapshot':{'hypotheses':[{'hypothesis_id':'first','anatomy':{}}]},
        'command':{'command_id':'fit-command','parameters':{'annotation':{'pose':'a','JA_values':[-3.]}}}}
    key='session:'+digest(canonical(['session','fit-command']).encode())
    state={'jobs':[{'key':key,'job_id':'job','status':'succeeded','result':{'status':'ranked','with_depth_order':['first']}}],
        'snapshot':{'model_id':'adopted'},'pending':None,
        'lidar_fusions':[{'job_id':'job','status':'adopted','model_updated':True,'model_id':'adopted'}]}
    class Backend:
        def execute(self,command):return {'state':state} if command['action']=='state' else {'events':[]}
        def submit(self,*args):raise RuntimeError('export temporarily unavailable')
    with pytest.raises(RuntimeError,match='export temporarily unavailable'):finish(Backend(),intent,tmp_path)
    receipt=json.loads((tmp_path/'adoption-summary.json').read_text())
    assert receipt['modelId']=='adopted' and receipt['includedInFit'] is True
    assert receipt['geometry'] is None and not (tmp_path/'summary.json').exists()


def test_geometry_terminal_failure_gets_new_identity_without_repeating_success(tmp_path, monkeypatch):
    from science.scripts import app_lidar
    submitted = {}
    calls = []
    class Backend:
        def submit(self, request, key):
            calls.append(key)
            return submitted.setdefault(key, 'job-' + str(len(submitted)))
    def terminal(backend, job):
        return {'status': 'failed' if job == 'job-0' else 'succeeded',
                'error': 'scheduler_interrupted' if job == 'job-0' else None}
    monkeypatch.setattr(app_lidar, 'wait', terminal)
    backend=Backend();request={'operation':'forward'}
    with pytest.raises(ValueError, match='new export attempt'):
        app_lidar.geometry_export_job(backend,request,tmp_path)
    failed=(tmp_path/'geometry-attempt-00.terminal.json').read_bytes()
    assert app_lidar.geometry_export_job(backend,request,tmp_path)=='job-1'
    assert app_lidar.geometry_export_job(backend,request,tmp_path)=='job-1'
    assert len(submitted)==2 and calls[-1]==calls[-2]
    assert (tmp_path/'geometry-attempt-00.terminal.json').read_bytes()==failed
    assert json.loads((tmp_path/'geometry-attempt-01.terminal.json').read_text())['status']=='succeeded'


def test_geometry_lost_submit_response_resumes_same_identity(tmp_path, monkeypatch):
    from science.scripts import app_lidar
    keys=[]
    class Backend:
        def submit(self, request, key):
            keys.append(key)
            if len(keys)==1:raise OSError('accepted response lost')
            return 'accepted-job'
    monkeypatch.setattr(app_lidar,'wait',lambda backend,job:{'status':'succeeded'})
    backend=Backend()
    with pytest.raises(OSError):app_lidar.geometry_export_job(backend,{},tmp_path)
    assert app_lidar.geometry_export_job(backend,{},tmp_path)=='accepted-job'
    assert keys[0]==keys[1]
