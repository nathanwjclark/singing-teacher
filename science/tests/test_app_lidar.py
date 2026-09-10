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
