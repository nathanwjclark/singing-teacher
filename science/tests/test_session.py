from copy import deepcopy
from datetime import datetime, timezone
import os
import sqlite3

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_inverse import extract_pcm, FEATURES
from singing_physics.service import JobService
from singing_physics.session import SessionController


def now():
    return datetime.now(timezone.utc).isoformat()


def calibration():
    with Engine() as engine:
        engine.set_anatomy({'hard_palate_length':4.37})
        audio=engine.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.25)
    measurement=extract_pcm(audio[4410:8506]*.8,44100,measurement_id='cal-measurement',
        observation_id='cal',artifact_id='cal-audio',start_ms=100.)['measurement']
    return {'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':[{'id':'cal','pose':'a',
        'measurement':measurement,'sample_rate_hz':44100,'frame_start_sample':4410,'frame_size':4096,'duration_s':.25}]}


def send(controller, action, **fields):
    state=controller.execute({'action':'state'})['state']
    return controller.execute({'action':action,'command_id':str(state['version'])+action,
        'expected_version':state['version'],**fields})['state']


def collect(controller,service):
    state=controller.execute({'action':'state'})['state']; job=state['pending']['job_id']
    assert service.wait(job,timeout_s=60)['status']=='succeeded',service.status(job)
    return send(controller,'collect_job',job_id=job)


def design_params(identity='design',target='target'):
    return {'design_id':identity,'target_observation_id':target,
        'experiments':[{'experiment_id':'a','pose':'a','JA':-2.,'f0_hz':180.,'gain':.8}],
        'feature_scales':{name:{'unit':unit,'scale':scale,'assumption':'Software test engineering scale'} for name,(unit,scale) in FEATURES.items()},
        'minimum_separation':.000001,'max_synthesis_calls':8}


def test_real_search_design_committed_outcome_restart_and_replay(tmp_path):
    document=calibration()
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        send(controller,'ingest_calibration',document=document)
        send(controller,'search',parameters={'anatomy_bounds':{'hard_palate_length':[4.,4.8]},
            'nuisance_profiles':[{'profile_id':'declared','trials':{'cal':{'JA':-2.,'f0_hz':180.,'gain':.8}}}],
            'max_synthesis_calls':6,'rounds':1,'seed':7})
        state=collect(controller,service); assert state['snapshot']
        send(controller,'propose_design',parameters=design_params())
        state=collect(controller,service); assert state['designs']['design']['status']=='committed'
        old=deepcopy(state['snapshot'])
        with Engine() as engine:
            engine.set_anatomy(old['hypotheses'][0]['anatomy'])
            pcm=(engine.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.25)[4410:8506]*.8).tolist()
        with pytest.raises(ValueError,match='profile must match'):
            send(controller,'submit_outcome',design_id='design',parameters={'experiment_id':'a','observation_id':'target',
                'artifact_id':'new-audio','observed_at':now(),'pcm':pcm,'source_kind':'engine-generated',
                'sample_rate_hz':48000})
        assert controller.execute({'action':'state'})['state']['version']==state['version']
        send(controller,'submit_outcome',design_id='design',parameters={'experiment_id':'a','observation_id':'target',
            'artifact_id':'new-audio','observed_at':now(),'pcm':pcm,'source_kind':'engine-generated'})
        state=collect(controller,service)
        assert state['snapshot']['model_id']!=old['model_id']
        assert 'target' in state['snapshot']['evidence_ids']
        assert set(old['evidence_hashes'])<=set(state['snapshot']['evidence_hashes'])
        receipt=controller.execute({'action':'replay'})
        assert SessionController(tmp_path/'sessions',service,'session').execute({'action':'replay'})==receipt
        assert os.stat(tmp_path/'sessions').st_mode&0o777==0o700
        assert os.stat(tmp_path/'sessions'/'sessions.sqlite3').st_mode&0o777==0o600
        other=SessionController(tmp_path/'sessions',service,'other')
        with pytest.raises(ValueError,match='owned'):
            send(other,'collect_job',job_id=state['jobs'][0]['job_id'])
        with pytest.raises(ValueError,match='stale_session'):
            controller.execute({'action':'record_sensation','command_id':'stale','expected_version':0,'attempt_id':'target','text':'Easy'})
        send(controller,'record_sensation',attempt_id='target',text='Easy')
        assert controller.execute({'action':'state'})['state']['snapshot']==state['snapshot']
    with JobService(tmp_path/'jobs') as reopened:
        final=SessionController(tmp_path/'sessions',reopened,'session').execute({'action':'state'})['state']
        assert final['snapshot']==state['snapshot']


def test_stop_duplicate_command_tamper_and_failed_job(tmp_path):
    from singing_physics.pcm_design import freeze_pcm_hypotheses
    with Engine() as engine: provenance=engine.provenance
    snapshot=freeze_pcm_hypotheses(model_id='initial',evidence_ids=['past'],evidence_hashes=['a'*64],
        provenance=provenance,hypotheses=[{'hypothesis_id':'a','anatomy':{'hard_palate_length':4.}},
            {'hypothesis_id':'b','anatomy':{'hard_palate_length':4.8}}],frozen_at=now()).data
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        command={'action':'register_model','command_id':'register','expected_version':0,'snapshot':snapshot}
        first=controller.execute(command)
        assert controller.execute(command)==first
        with pytest.raises(ValueError,match='different'):
            controller.execute({**command,'snapshot':{**snapshot,'model_id':'changed'}})
        send(controller,'propose_design',parameters=design_params())
        state=collect(controller,service)
        send(controller,'record_attempt',design_id='design',attempt_id='stopped',status='stopped',reason='Learner stopped')
        send(controller,'record_sensation',attempt_id='stopped',text='Uncomfortable')
        with pytest.raises(ValueError,match='current committed'):
            send(controller,'submit_outcome',design_id='design',parameters={})
        assert controller.execute({'action':'state'})['state']['snapshot']==snapshot
        send(controller,'propose_design',parameters={**design_params('fail','fail-target'),'max_synthesis_calls':1})
        pending=controller.execute({'action':'state'})['state']['pending']
        assert service.wait(pending['job_id'])['status']=='failed'
        final=send(controller,'collect_job',job_id=pending['job_id'])
        assert final['jobs'][-1]['status']=='failed' and final['snapshot']==snapshot
        with sqlite3.connect(tmp_path/'sessions'/'sessions.sqlite3') as db:
            db.execute("UPDATE events SET digest=? WHERE session='session' AND version=1",('f'*64,))
        with pytest.raises(RuntimeError,match='integrity'):
            controller.execute({'action':'replay'})


def test_crash_after_submit_recovers_intent_and_concurrent_cas(tmp_path,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        send(controller,'ingest_calibration',document=calibration())
        original=service.submit; jobs=[]
        def crash(request,*,idempotency_key):
            jobs.append(original(request,idempotency_key=idempotency_key))
            raise SystemExit('simulated process exit after durable job submission')
        monkeypatch.setattr(service,'submit',crash)
        with pytest.raises(SystemExit):
            send(controller,'search',parameters={'anatomy_bounds':{'hard_palate_length':[4.,4.8]},
                'nuisance_profiles':[{'profile_id':'declared','trials':{'cal':{'JA':-2.,'f0_hz':180.,'gain':.8}}}],
                'max_synthesis_calls':6,'rounds':1,'seed':7})
        monkeypatch.setattr(service,'submit',original)
        recovered=SessionController(tmp_path/'sessions',service,'session')
        state=recovered.execute({'action':'state'})['state']
        assert state['pending']['job_id']==jobs[0]
        state=collect(recovered,service)
        send(recovered,'propose_design',parameters=design_params())
        state=collect(recovered,service)
        original_snapshot=deepcopy(state['snapshot'])
        with Engine() as engine:
            engine.set_anatomy(state['snapshot']['hypotheses'][0]['anatomy'])
            frame=(engine.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.25)[4410:8506]*.8).tolist()
        state=send(recovered,'submit_outcome',design_id='design',parameters={'experiment_id':'a',
            'observation_id':'target','artifact_id':'future-audio','observed_at':now(),'pcm':frame,'source_kind':'engine-generated'})
        finished_job=state['pending']['job_id']
        assert service.wait(finished_job)['status']=='succeeded'
        commands=[{'action':'record_attempt','command_id':str(i),'expected_version':state['version'],
            'design_id':'design','attempt_id':'attempt'+str(i),'status':'stopped','reason':'Stop'} for i in range(2)]
        def execute(command):
            try: return recovered.execute(command)
            except ValueError as exc: return str(exc)
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes=list(pool.map(execute,commands))
        assert sum(isinstance(r,dict) for r in outcomes)==1
        assert 'stale_session_version' in outcomes
        final=recovered.execute({'action':'state'})['state']
        assert final['snapshot']==original_snapshot and final['pending'] is None
        with pytest.raises(ValueError,match='owned'):
            send(recovered,'collect_job',job_id=finished_job)


def test_native_48k_calibration_profile_ingest_search_and_window_guards(tmp_path):
    from singing_physics.pcm_inverse import resample_native_pcm
    with Engine() as engine:
        audio=engine.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.3)
        native,_=resample_native_pcm(audio,44100,48000)
    measurement=extract_pcm(native[4800:8896]*.8,48000,measurement_id='native-measurement',
        observation_id='native',artifact_id='native-audio',start_ms=100.)['measurement']
    doc={'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':[{'id':'native','pose':'a',
        'measurement':measurement,'sample_rate_hz':48000,'frame_start_sample':4800,'frame_size':4096,'duration_s':.3}]}
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'native')
        for change in ({'frame_start_sample':4801},{'frame_size':4095},{'duration_s':.1},{'sample_rate_hz':True}):
            bad=deepcopy(doc);bad['trials'][0].update(change)
            with pytest.raises(ValueError):send(controller,'ingest_calibration',document=bad)
        duplicate=deepcopy(doc);second=deepcopy(doc['trials'][0]);second['id']='renamed';second['measurement']['id']='renamed-measurement'
        duplicate['trials'].append(second)
        with pytest.raises(ValueError):send(controller,'ingest_calibration',document=duplicate)
        state=send(controller,'ingest_calibration',document=doc)
        assert state['calibration']==doc
        send(controller,'search',parameters={'anatomy_bounds':{'hard_palate_length':[4.,4.8]},
            'nuisance_profiles':[{'profile_id':'declared','trials':{'native':{'JA':-2.,'f0_hz':180.,'gain':.8}}}],
            'max_synthesis_calls':6,'rounds':1,'seed':7})
        result=collect(controller,service)
        assert result['snapshot'] and result['jobs'][-1]['result']['actual_synthesis_calls']==6
