"""Optional source operations reuse native process isolation and immutable results."""
import hashlib

from singing_physics.engine import Engine
from singing_physics.phonation import synthesize_phonation, _metadata
from singing_physics.service import JobService


def inputs():
    with Engine() as e:
        e.set_anatomy({'hard_palate_length':4.2})
        audio,_=synthesize_phonation(e,pose='a',JA=-3,F0=180,PR=8000,PS=.2)
    frame=audio[4410:8506]
    metadata=_metadata('cal',44100,hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest(),'engine-generated')
    doc={'schema_version':'phonation-fit-1','trials':[dict(id='cal',pose='a',pcm=frame.tolist(),sample_rate_hz=44100,metadata=metadata)]}
    candidates=[dict(candidate_id='one',anatomy={'hard_palate_length':4.2},trials={'cal':dict(JA=-3,F0=180,PR=8000,PS=.2,gain=1.)})]
    return dict(document=doc,candidates=candidates,max_synthesis_calls=3,enabled=True)


def test_actual_optional_fit_forecast_score_jobs_and_default_off(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        service.register_model('session','baseline')
        def run(operation,params,key):
            job=service.submit(dict(operation=operation,parameters=params,session_id='session',model_id='baseline'),idempotency_key=key)
            status=service.wait(job,timeout_s=60);assert status['status']=='succeeded',status
            return service.result(job)
        assert run('fit_phonation',dict(document=None,candidates=None),'disabled')['status']=='disabled'
        fitted=run('fit_phonation',inputs(),'fit')
        assert fitted['status']=='available' and fitted['actual_synthesis_calls']==3
        forecast=run('forecast_phonation',dict(fit_result=fitted,family='joint',candidate_id='one',reference_trial_id='cal',pose='a',controls=dict(JA=-3,F0=200,PR=8000,gain=1.),target_id='later',enabled=True),'forecast')
        with Engine() as e:
            e.set_anatomy({'hard_palate_length':4.2})
            audio,_=synthesize_phonation(e,pose='a',JA=-3,F0=200,PR=8000,PS=.2)
        frame=audio[4410:8506];metadata=_metadata('later',44100,hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest(),'engine-generated')
        score=run('score_phonation',dict(frozen=forecast,pcm=frame.tolist(),metadata=metadata,enabled=True),'score')
        assert score['status']=='available' and score['score']<1e-8 and not score['model_updated']
        assert run('forward',dict(pose='a',duration_s=.1),'baseline')['kind']=='synthetic_forward_export'


def test_optional_worker_hard_timeout_and_cancel_leave_baseline_usable(tmp_path):
    params=inputs()
    with JobService(tmp_path/'jobs',timeout_s=1) as service:
        job=service.submit(dict(operation='fit_phonation',parameters=params),idempotency_key='timeout')
        # Suspend the actual disposable native worker to model a nonreturning native call.
        import os,signal,time
        deadline=time.monotonic()+3
        while job not in service._processes and time.monotonic()<deadline:time.sleep(.005)
        assert job in service._processes
        os.kill(service._processes[job][0].pid,signal.SIGSTOP)
        status=service.wait(job,timeout_s=10)
        assert status['status']=='failed' and status['error']=='timeout'
        cancelled=service.submit(dict(operation='fit_phonation',parameters=params),idempotency_key='cancel')
        assert service.cancel(cancelled)
        assert service.wait(cancelled)['status']=='cancelled'
    with JobService(tmp_path/'jobs',timeout_s=30) as service:
        job=service.submit(dict(operation='forward',parameters=dict(pose='a',duration_s=.1)),idempotency_key='baseline')
        assert service.wait(job,timeout_s=30)['status']=='succeeded'


def test_hung_extractor_descendant_terminated_with_job(tmp_path,monkeypatch):
    import os,sys,time
    params=inputs();shim=tmp_path/'bin';shim.mkdir();pidfile=tmp_path/'extractor.pid'
    node=shim/'node'
    import shlex
    code='import os,time;from pathlib import Path;Path('+repr(str(pidfile))+').write_text(str(os.getpid()));time.sleep(120)'
    node.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' -c '+shlex.quote(code)+'\n')
    node.chmod(0o700);monkeypatch.setenv('PATH',str(shim)+os.pathsep+os.environ['PATH'])
    with JobService(tmp_path/'jobs',timeout_s=2) as service:
        job=service.submit(dict(operation='fit_phonation',parameters=params),idempotency_key='hung-node')
        deadline=time.monotonic()+5
        while not pidfile.exists() and time.monotonic()<deadline:time.sleep(.01)
        assert pidfile.exists()
        status=service.wait(job,timeout_s=10);assert status['status']=='failed' and status['error']=='timeout'
        pid=int(pidfile.read_text());deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            try:os.kill(pid,0)
            except ProcessLookupError:break
            time.sleep(.02)
        else:raise AssertionError('Extractor descendant survived aggregate job timeout')
