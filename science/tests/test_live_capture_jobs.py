"""Actual native capture-import pipeline through local and existing HTTP owners."""
import hashlib
import importlib.util
import json
from pathlib import Path
import threading

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_inverse import resample_native_pcm
from singing_physics.service import JobService
from singing_physics.session import SessionController

SCRIPT=Path(__file__).parents[1]/'scripts/live_capture_jobs.py'
spec=importlib.util.spec_from_file_location('live_capture_jobs',SCRIPT)
live=importlib.util.module_from_spec(spec);spec.loader.exec_module(live)


def capture(tmp_path):
    directory=tmp_path/'capture';directory.mkdir()
    with Engine() as engine:
        audio=engine.synthesize('a',{'JA':-3.},f0_hz=180.,duration_s=.6)
        samples,_=resample_native_pcm(audio,44100,48000)
    raw=samples.astype('<f4').tobytes();(directory/'audio.pcm.raw').write_bytes(raw)
    stamp=lambda n:dict(value=n,timescale=48000,epoch=0,flags=1,seconds=n/48000)
    manifest={'schema_version':'singing-native-rgbd-1.0.0','capture_mode':'one-held-pose',
        'capture_id':'native-generated-software-test','created_at':'2026-01-01T00:00:00Z',
        'task':'Explicit native synthesizer fixture, not human evidence',
        'device':{'device_type':'AVCaptureDeviceTypeBuiltInTrueDepthCamera','position':'front','output_mirrored':False},
        'frames':[],'audio':{'reason':'Native-generated software fixture','samples':[{
            'presentation_timestamp':stamp(48000),'duration':stamp(len(samples)),'num_samples':len(samples),'gap_before_seconds':None,
            'artifact':{'path':'audio.pcm.raw','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},
            'asbd':{'sample_rate':48000,'format_id':1819304813,'format_flags':9,'bytes_per_packet':4,'frames_per_packet':1,
                    'bytes_per_frame':4,'channels_per_frame':1,'bits_per_channel':32}}]}}
    (directory/'manifest.json').write_text(json.dumps(manifest));return directory


@pytest.mark.parametrize('remote',[False,True])
def test_native_capture_freezes_authoritative_session_and_verified_export(tmp_path,monkeypatch,remote):
    source=capture(tmp_path);output=tmp_path/'run'
    monkeypatch.delenv('SCIENCE_URL',raising=False);monkeypatch.delenv('SCIENCE_TOKEN',raising=False)
    server=None;thread=None
    if remote:
        from singing_physics.http_service import ScientificHTTPServer
        server=ScientificHTTPServer(tmp_path/'shared-jobs','t'*48,port=0)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        monkeypatch.setenv('SCIENCE_URL',f'http://127.0.0.1:{server.server_port}')
        monkeypatch.setenv('SCIENCE_TOKEN','t'*48)
    try:
        summary=live.run(source,output,development_fixture=True)
        assert summary['source']=='development-fixture' and not summary['anatomyValidated']
        assert len(summary['jobs'])==3 and summary['nativeCalls']==46
        assert summary['modelId']==summary['forecast']['model_id']
        receipt=json.loads((output/'session-ledger.json').read_text())
        state=receipt['state'];design=state['designs'][summary['designId']]
        assert state['snapshot']['model_id']==summary['modelId']
        assert design['status'] in ('committed','unsupported')
        assert len(state['jobs'])==2
        for name,details in summary['files'].items():
            assert hashlib.sha256((output/name).read_bytes()).hexdigest()==details['sha256']
        if remote:
            assert not (output/'jobs').exists()
            authoritative=live.HTTPBackend(f'http://127.0.0.1:{server.server_port}','t'*48,summary['sessionId']).execute({'action':'state'})
            assert authoritative['state']==state
        else:
            with JobService(output/'jobs') as service:
                assert SessionController(service.root/'sessions',service,summary['sessionId']).execute({'action':'state'})['state']==state
    finally:
        if server: server.shutdown();thread.join();server.server_close()


def test_http_configuration_rejects_remote_or_incomplete_auth(tmp_path,monkeypatch):
    for url in ('https://127.0.0.1:8766','http://example.com:8766','http://127.0.0.1:8766/other','http://user@127.0.0.1:8766'):
        with pytest.raises(ValueError):live.HTTPBackend(url,'t'*48,'session')
    monkeypatch.setenv('SCIENCE_URL','http://127.0.0.1:8766');monkeypatch.delenv('SCIENCE_TOKEN',raising=False)
    with pytest.raises(ValueError):
        with live.backend_for(tmp_path,'session'):pass
