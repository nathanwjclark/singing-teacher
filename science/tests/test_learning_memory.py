"""Original native48k outcome -> authenticated owner, restart and immutable replay."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
from datetime import datetime, timezone
import hashlib

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.pcm_inverse import FEATURES, resample_native_pcm
from singing_physics.http_service import ScientificHTTPServer

SCRIPTS=Path(__file__).parents[1]/'scripts'
sys.path.insert(0,str(SCRIPTS))
import run_native_outcome as runner


def native_outcome_capture(directory, *, created_at=None):
    directory.mkdir()
    with Engine() as engine:
        engine.set_anatomy({'hard_palate_length':4.2})
        audio=resample_native_pcm(engine.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.25),44100,48000)[0]*.1
    raw=audio.astype('<f4').tobytes();(directory/'audio.raw').write_bytes(raw)
    stamp=lambda n:dict(value=n,timescale=48000,epoch=0,flags=1,seconds=n/48000)
    manifest=dict(schema_version='singing-native-rgbd-1.0.0',capture_mode='one-held-pose',capture_id='later-native-software-fixture',created_at=created_at or datetime.now(timezone.utc).isoformat(),task='Native synthesized software fixture',device=dict(device_type='AVCaptureDeviceTypeBuiltInTrueDepthCamera',position='front',output_mirrored=False),frames=[],audio=dict(samples=[dict(presentation_timestamp=stamp(48000),duration=stamp(len(audio)),num_samples=len(audio),gap_before_seconds=None,artifact=dict(path='audio.raw',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()),asbd=dict(sample_rate=48000,format_id=1819304813,format_flags=9,bytes_per_packet=4,frames_per_packet=1,bytes_per_frame=4,channels_per_frame=1,bits_per_channel=32))]))
    (directory/'manifest.json').write_text(json.dumps(manifest))
    return directory


def test_native_completed_attempt_subjective_memory(tmp_path,monkeypatch):
    interruption="submit_response"
    server=ScientificHTTPServer(tmp_path/'jobs','t'*48,port=0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('SCIENCE_URL',f'http://127.0.0.1:{server.server_port}');monkeypatch.setenv('SCIENCE_TOKEN','t'*48)
    backend=runner.HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],'session')
    try:
        with Engine() as engine: provenance=engine.provenance
        snapshot=freeze_pcm_hypotheses(model_id='initial',evidence_ids=['past'],evidence_hashes=['a'*64],provenance=provenance,hypotheses=[dict(hypothesis_id='a',anatomy={'hard_palate_length':4.2}),dict(hypothesis_id='b',anatomy={'hard_palate_length':4.8})],frozen_at=datetime.now(timezone.utc).isoformat()).data
        backend.execute(dict(action='register_model',command_id='register',expected_version=0,snapshot=snapshot))
        state=backend.execute({'action':'state'})['state']
        parameters=dict(design_id='design',target_observation_id='target',profile=dict(sample_rate_hz=48000,frame_start_sample=4800,frame_size=4096,duration_s=.25),experiments=[dict(experiment_id='a',pose='a',JA=-2.,f0_hz=180.,gain=.1)],feature_scales={name:dict(unit=unit,scale=scale,assumption='Test engineering scale') for name,(unit,scale) in FEATURES.items()},minimum_separation=.000001,max_synthesis_calls=4)
        from live_capture_jobs import wait
        for design_id in (['prior','design'] if interruption=='stale_collect' else ['design']):
            parameters['design_id']=design_id;parameters['target_observation_id']='prior-target' if design_id=='prior' else 'target'
            state=backend.execute(dict(action='propose_design',command_id=design_id,expected_version=state['version'],parameters=parameters))['state']
            job=state['pending']['job_id']
            assert wait(backend,job)['status']=='succeeded'
            state=backend.execute(dict(action='collect_job',command_id='collect-'+design_id,expected_version=state['version'],job_id=job))['state']
            if design_id=='prior':
                state=backend.execute(dict(action='record_attempt',command_id='prior-attempt',expected_version=state['version'],design_id='prior',attempt_id='prior-attempt',status='failed',reason='Previous execution unsuccessful'))['state']
        run=tmp_path/'saved-run';run.mkdir();(run/'summary.json').write_text(json.dumps(dict(runId='saved-run',sessionId='session',designId='design',modelId='initial')))
        source=native_outcome_capture(tmp_path/'later')
        config=tmp_path/'config.json';config.write_text(json.dumps(dict(pose='a',segment_index=0,evidence_kind='development-fixture',participant_id='fixture-participant',recording_kind='ordinary-singing',contains_external_excitation=False)))
        out=tmp_path/'outcome'
        original=runner.HTTPBackend.execute; lost=False
        original_process=runner.subprocess.run;original_seal=runner.seal
        def lose_response(self,command):
            nonlocal lost
            if interruption=='stale_collect' and command.get('action')=='collect_job' and not lost:
                lost=True
                current=original(self,{'action':'state'})['state']
                original(self,dict(action='record_sensation',command_id='concurrent-sensation',expected_version=current['version'],attempt_id='prior-attempt',text='Subjective report arrived during collection'))
            result=original(self,command)
            if interruption=='submit_response' and command.get('action')=='submit_outcome' and not lost:
                lost=True;raise ConnectionError('Test lost accepted response')
            return result
        def interrupt_import(*args,**kwargs):
            nonlocal lost
            result=original_process(*args,**kwargs)
            if interruption=='preparation' and not lost:
                lost=True;raise ConnectionError('Test lost accepted preparation')
            return result
        def interrupt_result(path,value):
            nonlocal lost
            result=original_seal(path,value)
            if interruption in ('saved_result','stopped') and path.name=='result.json' and not lost:
                lost=True;raise ConnectionError('Test lost accepted result')
            return result
        monkeypatch.setattr(runner.HTTPBackend,'execute',lose_response)
        monkeypatch.setattr(runner.subprocess,'run',interrupt_import)
        monkeypatch.setattr(runner,'seal',interrupt_result)
        if interruption!='stale_collect':
            with pytest.raises(ConnectionError,match='lost accepted'):
                runner.run(run,source,out,config)
        else:
            runner.run(run,source,out,config)
            assert len(list(out.glob('collect-v*.json')))==2
            assert lost
        assert (out/'session-before.json').exists()
        if interruption!='preparation': assert (out/'prepared.json').exists()
        if interruption=='stopped':
            active=backend.execute({'action':'state'})['state']
            original(backend,dict(action='record_attempt',command_id='stop-after-worker',expected_version=active['version'],design_id='design',attempt_id='target',status='stopped',reason='Stopped before collection'))
        first=runner.run(run,source,out,config)
        if interruption=='stopped':
            assert first['status']=='stopped_without_model_update' and first['modelId']=='initial'
            assert first['scientificStatus'] is None and not first['modelUpdated']
        else:
            assert first['status']=='succeeded' and first['modelId']!='initial'
            assert first['scientificStatus'] in ('conditional_support_updated','model_mismatch','no_design_separation')
        raw_result=json.loads((out/'result.json').read_text())
        assert first['scores']==(raw_result['scores'] if interruption!='stopped' else [])
        assert first['previousHypotheses']==2
        assert first['retainedHypotheses']==(len(raw_result['updated_snapshot']['hypotheses']) if interruption!='stopped' else None)
        second=runner.run(run,source,out,config);assert second==first
        replay=json.loads((out/'replay.json').read_text())
        assert len([j for j in replay['state']['jobs'] if j['request']['operation']=='update_pcm'])==1
        assert ('target' in replay['state']['snapshot']['evidence_ids']) == (interruption!='stopped')
        assert (out/'summary.json').stat().st_mode&0o777==0o600
        import subprocess
        data=tmp_path/'app';data.mkdir()
        app_run=data/'science-runs'/'run-test';app_run.mkdir(parents=True)
        (data/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-test'}))
        (app_run/'outcome-current.json').write_text(json.dumps({'status':'succeeded','outcomeId':'outcome-test'}))
        outcome_dir=app_run/'outcomes'/'outcome-test';outcome_dir.mkdir(parents=True)
        (outcome_dir/'summary.json').write_text(json.dumps(first))
        code="""
import {createLearningRoutes} from './server/learningMemory.mjs';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
let response;
const routes=createLearningRoutes({dataRoot:process.env.MEMORY_ROOT,json:(_r,status,body)=>{response={status,body}}});
async function request(method,path,body){const req=Readable.from(body?[JSON.stringify(body)]:[]);req.method=method;req.socket={remoteAddress:'127.0.0.1'};await routes(req,{},new URL('http://localhost'+path));return response}
let saved=await request('POST','/api/learning/sensation',{text:'A gentle buzz felt easy'});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.entries.length,1);
saved=await request('POST','/api/learning/sensation',{text:'A gentle buzz felt easy'});assert.equal(saved.body.entries.length,1);
const read=await request('GET','/api/learning/memory');assert.equal(read.body.entries[0].attemptId,'target');assert.equal(read.body.scope,'subjective_not_physiological_evidence');
"""
        before=backend.execute({'action':'state'})['state']
        subprocess.run(['node','--input-type=module','-e',code],cwd=SCRIPTS.parents[1],env={**os.environ,'MEMORY_ROOT':str(data)},check=True)
        after=backend.execute({'action':'state'})['state']
        assert after['snapshot']==before['snapshot']
        assert len(after['sensations'])==len(before['sensations'])+1
    finally:
        server.shutdown();thread.join();server.server_close()
