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


@pytest.mark.parametrize('interruption',['submit_response','preparation','saved_result','stopped'])
def test_actual_http_update_resumes_lost_submit_response_and_completed_replay(tmp_path,monkeypatch,interruption):
    server=ScientificHTTPServer(tmp_path/'jobs','t'*48,port=0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('SCIENCE_URL',f'http://127.0.0.1:{server.server_port}');monkeypatch.setenv('SCIENCE_TOKEN','t'*48)
    backend=runner.HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],'session')
    try:
        with Engine() as engine: provenance=engine.provenance
        snapshot=freeze_pcm_hypotheses(model_id='initial',evidence_ids=['past'],evidence_hashes=['a'*64],provenance=provenance,hypotheses=[dict(hypothesis_id='a',anatomy={'hard_palate_length':4.2}),dict(hypothesis_id='b',anatomy={'hard_palate_length':4.8})],frozen_at=datetime.now(timezone.utc).isoformat()).data
        backend.execute(dict(action='register_model',command_id='register',expected_version=0,snapshot=snapshot))
        state=backend.execute({'action':'state'})['state']
        state=backend.execute(dict(action='propose_design',command_id='design',expected_version=state['version'],parameters=dict(design_id='design',target_observation_id='target',profile=dict(sample_rate_hz=48000,frame_start_sample=4800,frame_size=4096,duration_s=.25),experiments=[dict(experiment_id='a',pose='a',JA=-2.,f0_hz=180.,gain=.1)],feature_scales={name:dict(unit=unit,scale=scale,assumption='Test engineering scale') for name,(unit,scale) in FEATURES.items()},minimum_separation=.000001,max_synthesis_calls=4)))['state']
        job=state['pending']['job_id']
        from live_capture_jobs import wait
        assert wait(backend,job)['status']=='succeeded'
        state=backend.execute(dict(action='collect_job',command_id='collect-design',expected_version=state['version'],job_id=job))['state']
        run=tmp_path/'saved-run';run.mkdir();(run/'summary.json').write_text(json.dumps(dict(runId='saved-run',sessionId='session',designId='design',modelId='initial')))
        source=native_outcome_capture(tmp_path/'later')
        config=tmp_path/'config.json';config.write_text(json.dumps(dict(pose='a',segment_index=0,evidence_kind='development-fixture',participant_id='fixture-participant',recording_kind='ordinary-singing',contains_external_excitation=False)))
        out=tmp_path/'outcome'
        original=runner.HTTPBackend.execute; lost=False
        original_process=runner.subprocess.run;original_seal=runner.seal
        def lose_response(self,command):
            nonlocal lost
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
        with pytest.raises(ConnectionError,match='lost accepted'):
            runner.run(run,source,out,config)
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
        second=runner.run(run,source,out,config);assert second==first
        replay=json.loads((out/'replay.json').read_text())
        assert len([j for j in replay['state']['jobs'] if j['request']['operation']=='update_pcm'])==1
        assert ('target' in replay['state']['snapshot']['evidence_ids']) == (interruption!='stopped')
        assert (out/'summary.json').stat().st_mode&0o777==0o600
        (out/'result.json').write_text('{}')
        with pytest.raises(ValueError,match='artifact changed'):runner.run(run,source,out,config)
    finally:
        server.shutdown();thread.join();server.server_close()
