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


def capture(tmp_path,pose='a'):
    directory=tmp_path/'capture';directory.mkdir()
    with Engine() as engine:
        audio=engine.synthesize(pose,{'JA':-3.},f0_hz=180.,duration_s=.6)
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


@pytest.mark.parametrize('remote,objective',[(False,'canonical-coarse-v1'),(True,'canonical-coarse-v1'),(False,'multires-log-spectrum-v1')])
def test_native_capture_freezes_authoritative_session_and_verified_export(tmp_path,monkeypatch,remote,objective):
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
        summary=live.run(source,output,development_fixture=True,objective=objective)
        assert summary['source']=='development-fixture' and not summary['anatomyValidated']
        assert summary['objective']==summary['forecast']['objective']==objective
        assert summary['objectivePolicy']==summary['forecast']['objective_policy']
        assert summary['forecast']['scorer_implementation_pin']['version']=='pcm-scorer-pin-1'
        protocol=json.loads((output/'protocol.json').read_text())
        fit=json.loads((output/'fit.json').read_text())
        observations=json.loads((output/'observations.json').read_text())['trials']
        spectral=objective=='multires-log-spectrum-v1'
        assert ('spectral_nuisance' in protocol)==spectral
        assert all(('spectral_observation' in t)==('frame_sha256' in t)==spectral for t in observations)
        if spectral:
            assert all(t['spectral_observation']['frame_sha256']==t['frame_sha256'] not in t['measurement']['provenance']['sourceHashes'] for t in observations)
            assert fit['source_artifact_bytes_verified'] is False
        # Three gain-only nuisance profiles share each waveform: the declared 60-call
        # search cap is spent as 5 anatomy points x 2 windows x 2 models = 20 calls,
        # then 15 forecast and 2 geometry-export calls (77 before synthesis reuse).
        assert fit['actual_synthesis_calls']==20 and fit['max_synthesis_calls']==60
        assert len(summary['jobs'])==4 and summary['nativeCalls']==37
        assert summary['modelId']==summary['forecast']['model_id']
        assert summary['forecast']['profile']=={'sample_rate_hz':48000,'frame_start_sample':4800,'frame_size':4096,'duration_s':.25}
        comparison=json.loads((output/'space-diff.json').read_text())
        assert comparison['anatomy']==summary['anatomy']
        assert comparison['referenceAnatomy']==summary['referenceAnatomy']
        assert comparison['articulation']['JA']['applied']==comparison['referenceArticulation']['JA']['applied']==-3
        receipt=json.loads((output/'session-ledger.json').read_text())
        state=receipt['state'];design=state['designs'][summary['designId']]
        assert state['snapshot']['model_id']==summary['modelId']
        assert len({h['anatomy']['lip_width'] for h in state['snapshot']['hypotheses']}) > 1
        assert json.loads((output/'protocol.json').read_text())['search_budget']==60
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


def test_missing_eligible_capture_retains_protocol_without_fitting(tmp_path):
    with pytest.raises(ValueError,match='No two eligible'):
        live.pipeline({'fit_trial_options':[]},tmp_path,None,'session')
    assert (tmp_path/'protocol.json').exists()
    assert not (tmp_path/'fit.json').exists()


def test_sigterm_client_cancels_owned_remote_search_and_clears_pending(tmp_path,monkeypatch):
    import os
    import signal
    import subprocess
    import sys
    import time
    from singing_physics.http_service import ScientificHTTPServer
    source=capture(tmp_path);output=tmp_path/'interrupted-run'
    session_id='live-'+hashlib.sha256(str(output.resolve()).encode()).hexdigest()[:24]
    server=ScientificHTTPServer(tmp_path/'shared-jobs','t'*48,port=0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url=f'http://127.0.0.1:{server.server_port}'
    backend=live.HTTPBackend(url,'t'*48,session_id)
    process=None
    try:
        env={**os.environ,'SCIENCE_URL':url,'SCIENCE_TOKEN':'t'*48,'PYTHONPATH':str(SCRIPT.parents[2])+':'+str(SCRIPT.parents[1]/'src')}
        process=subprocess.Popen([sys.executable,str(SCRIPT),'--source',str(source),'--output',str(output),'--development-fixture'],
            env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        deadline=time.monotonic()+30;job_id=None
        while time.monotonic()<deadline:
            state=backend.execute({'action':'state'})['state']
            if state['pending']:
                job_id=state['pending']['job_id']
                if server.jobs.status(job_id)['status']=='running': break
            time.sleep(.02)
        assert job_id is not None and server.jobs.status(job_id)['status']=='running'
        process.send_signal(signal.SIGTERM)
        stdout,stderr=process.communicate(timeout=20)
        assert process.returncode!=0,(stdout,stderr)
        state=backend.execute({'action':'state'})['state']
        assert state['pending'] is None
        assert state['snapshot'] is None
        assert state['jobs'][-1]['status']=='cancelled'
        assert server.jobs.status(job_id)['status']=='cancelled'
        cleanup=json.loads((output/'interruption.json').read_text())
        assert cleanup['cleanup']['status']=='reconciled'
        assert not (output/'summary.json').exists()
        # Session can accept a new bounded search intent instead of remaining wedged.
        params=state['jobs'][-1]['request']['parameters'];params={k:v for k,v in params.items() if k!='observations'}
        params['max_synthesis_calls']=1
        reply=backend.execute({'action':'search','command_id':'resume-after-stop','expected_version':state['version'],'parameters':params})
        new_job=reply['state']['pending']['job_id']
        assert server.jobs.wait(new_job)['status']=='failed'
        backend.execute({'action':'collect_job','command_id':'collect-resume','expected_version':reply['state']['version'],'job_id':new_job})
    finally:
        if process and process.poll() is None:process.kill();process.communicate()
        server.shutdown();thread.join();server.server_close()


def test_cleanup_recovers_forward_submission_identity_without_duplicate_job(tmp_path):
    from singing_physics.http_service import ScientificHTTPServer
    server=ScientificHTTPServer(tmp_path/'jobs','t'*48,port=0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    backend=live.HTTPBackend(f'http://127.0.0.1:{server.server_port}','t'*48,'export-session')
    try:
        backend.execute({'action':'state'})
        model='session-unfitted:'+hashlib.sha256(json.dumps('export-session').encode()).hexdigest()
        request={'operation':'forward','session_id':'export-session','model_id':model,
            'parameters':{'pose':'a','duration_s':.25}}
        backend.forward_intent=(request,'owned-export')
        identity=backend.submit(*backend.forward_intent)
        # No cached forward_job_id: cleanup must recover a lost response by the same key.
        report=live.cancel_owned_jobs(backend,'run')
        assert report['jobs'][0]['job_id']==identity
        assert report['jobs'][0]['status'] in ('cancelled','succeeded')
        assert backend.submit(*backend.forward_intent)==identity
    finally:
        server.shutdown();thread.join();server.server_close()
