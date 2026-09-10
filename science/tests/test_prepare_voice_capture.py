import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prepare_voice_capture import prepare
import prepare_voice_capture


def fixture(root):
    identity='00000000-0000-4000-8000-000000000001'
    raw=b'\0\0\0\0'
    manifest={'schema_version':'singing-native-rgbd-1.0.0','capture_id':identity,'frames':[],
        'audio':{'samples':[{'artifact':{'path':'voice.raw','bytes':4,'sha256':hashlib.sha256(raw).hexdigest()}}]}}
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        z.writestr('manifest.json',json.dumps(manifest));z.writestr('voice.raw',raw)
    data=stream.getvalue();name='capture-'+identity+'.zip'
    (root/'usb-imports').mkdir();(root/'usb-imports'/name).write_bytes(data)
    (root/'native-pull-latest.json').write_text(json.dumps({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}))
    return name


def test_archive_to_fixed_calibration_config_and_verified_idempotence(tmp_path):
    fixture(tmp_path)
    first=prepare(tmp_path,'calibration','a',False)
    assert first==prepare(tmp_path,'calibration','a',False)
    config=json.loads((tmp_path/'science-input.json').read_text())
    assert config['evidenceKind']=='human-observation'
    assert (tmp_path/config['sourceDirectory']/'voice.raw').read_bytes()==b'\0\0\0\0'
    (tmp_path/config['sourceDirectory']/'voice.raw').write_bytes(b'bad')
    with pytest.raises(ValueError,match='hash'):prepare(tmp_path,'calibration','a',False)


def test_outcome_requires_frozen_selected_pose(tmp_path):
    fixture(tmp_path)
    (tmp_path/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-test'}))
    run=tmp_path/'science-runs/run-test';run.mkdir(parents=True)
    (run/'summary.json').write_text(json.dumps({'forecast':{'selected_experiment_id':'exp','rankings':[{'experiment':{'experiment_id':'exp','pose':'i'}}]}}))
    with pytest.raises(ValueError,match='frozen'):prepare(tmp_path,'outcome','a',False)
    assert prepare(tmp_path,'outcome','i',False)['prepared']
    c=json.loads((tmp_path/'science-outcome-input.json').read_text())
    assert c['pose']=='i' and c['recording_kind']=='ordinary-singing' and c['segment_index']==0


def test_invalid_claims_probe_receipt_and_archive_hash_rejected(tmp_path):
    name=fixture(tmp_path)
    for purpose,pose,external in [('calibration','i',False),('calibration','a',True),('unknown','a',False)]:
        with pytest.raises(ValueError):prepare(tmp_path,purpose,pose,external)
    receipt=json.loads((tmp_path/'native-pull-latest.json').read_text())
    receipt['name']='probe-'+name[8:];(tmp_path/'native-pull-latest.json').write_text(json.dumps(receipt))
    with pytest.raises(ValueError,match='unsupported'):prepare(tmp_path,'calibration','a',False)
    receipt['name']=name;receipt['sha256']='0'*64;(tmp_path/'native-pull-latest.json').write_text(json.dumps(receipt))
    with pytest.raises(ValueError,match='hash'):prepare(tmp_path,'calibration','a',False)


def test_interrupted_preparation_does_not_block_app_retry(tmp_path,monkeypatch):
    fixture(tmp_path)
    with monkeypatch.context() as patch:
        def interrupted(*args):raise OSError('interrupted publication')
        patch.setattr(prepare_voice_capture.os,'rename',interrupted)
        with pytest.raises(OSError,match='interrupted'):
            prepare(tmp_path,'calibration','a',False)
    assert not (tmp_path/'science-input.json').exists()
    assert prepare(tmp_path,'calibration','a',False)['prepared']
