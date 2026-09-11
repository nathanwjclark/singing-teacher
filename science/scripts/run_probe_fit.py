"""Apply a verified external probe to the current session's retained candidates."""
import argparse
import json
import hashlib
import os
import fcntl
from pathlib import Path
from science.scripts.live_capture_jobs import backend_for, wait
from singing_physics.service import canonical
from science.scripts.probe_setup import resolve_setup


def seal(path, value):
    """Atomic immutable receipts; an interrupted rename can safely be repeated."""
    if path.exists():
        if json.loads(path.read_text()) != value: raise ValueError('Probe receipt differs from its original bytes')
        return
    temporary=path.with_name(path.name+'.pending')
    with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as stream:
        json.dump(value,stream,allow_nan=False);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


def finish(backend, intent, output):
    command=intent['command']
    key='session:'+hashlib.sha256(canonical([intent['sessionId'],command['command_id']]).encode()).hexdigest()
    def owned(state):
        return next((j for j in state['jobs'] if j.get('key')==key),None)
    state=backend.execute({'action':'state'})['state']
    record=owned(state)
    if record is None and (not state['pending'] or state['pending'].get('key')!=key):
        if state['pending']: raise ValueError('Another scientific operation is running; retry after it completes')
        if state.get('snapshot',{}).get('model_id')!=intent['parentModelId']:
            raise ValueError('Model changed before probe submission; refresh and start a new fit')
        # The command ID is stable; expected_version may change only when no
        # submission exists (e.g. a sensation was saved before this command).
        for attempt in range(3):
            try:
                state=backend.execute({**command,'expected_version':state['version']})['state'];break
            except Exception:
                state=backend.execute({'action':'state'})['state']
                if owned(state) or state['pending'] and state['pending'].get('key')==key:break
                if attempt==2:raise
    record=owned(state)
    if record is None:
        pending=state['pending']
        if not pending or pending.get('key')!=key: raise ValueError('Probe submission has no recoverable session intent')
        job=pending['job_id'];seal(output/'job.json',{'jobId':job,'key':key})
        try:wait(backend,job)
        except TimeoutError:
            backend.cancel(job)
            wait(backend,job)
        for attempt in range(3):
            state=backend.execute({'action':'state'})['state']
            record=owned(state)
            if record is not None:break
            try:
                state=backend.execute({'action':'collect_job','command_id':output.name+'-collect',
                    'expected_version':state['version'],'job_id':job})['state']
                record=owned(state);break
            except Exception:
                if attempt==2:raise
    if record is None:raise ValueError('Probe completion is not yet available; retry to recover it')
    # Result is authoritative even if the collect HTTP reply was lost or the
    # process died after collection. No second fit/adoption is submitted.
    seal(output/'terminal.json',{'jobId':record.get('job_id'),'status':record['status']})
    if record['status']!='succeeded':
        seal(output/'failure.json',{'status':record['status'],'reason':'Probe job did not finish; the session is available for retry.'})
        raise ValueError('Probe job did not finish; retry the fit in the app')
    result=record['result'];seal(output/'result.json',result)
    # The full replay may grow later, so only freeze the first successful view.
    if not (output/'session-ledger.json').exists():seal(output/'session-ledger.json',backend.execute({'action':'replay'}))
    adoption=result.get('session_adoption',{})
    model_id=adoption.get('model_id',intent['parentModelId'])
    answer={'importId':intent['importId'],'parentModelId':intent['parentModelId'],'modelId':model_id,
        'status':result['status'],'includedInFit':result['status']=='joint_probe_evidence_used',
        'probeRecords':result['probe_records'],'score':result['joint']['best'],
        'baselineScore':result['fixed_anatomy_baseline']['best'],'nativeCalls':result['actual_operator_calls'],
        'adoptionStatus':'updated' if model_id!=intent['parentModelId'] else 'unchanged',
        'jobId':record['job_id'],'sessionId':intent['sessionId']}
    seal(output/'summary.json',answer)
    return answer


def run(data_root, import_id, expected_model_id, output):
    root, output = Path(data_root), Path(output)
    output.mkdir(mode=0o700,parents=True,exist_ok=True)
    # A restarted server and an orphaned child must not process this folder twice.
    with os.fdopen(os.open(output/'run.lock',os.O_RDWR|os.O_CREAT,0o600),'w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('This probe fit is still running; wait for completion')
        return _run(root,import_id,expected_model_id,output)


def _run(root, import_id, expected_model_id, output):
    intent_path=output/'intent.json'
    if intent_path.exists():
        intent=json.loads(intent_path.read_text())
        if intent['importId']!=import_id or intent['parentModelId']!=expected_model_id:
            raise ValueError('Probe retry identity differs from original request')
        with backend_for(output,intent['sessionId']) as backend:return finish(backend,intent,output)
    imported = root/'probe-imports'/import_id
    summary = json.loads((imported/'summary.json').read_text())
    if not summary['eligible']: raise ValueError('Probe calibration/import is not eligible for fitting')
    current = json.loads((root/'science-current.json').read_text())
    if current.get('status') != 'succeeded': raise ValueError('Complete a voice model fit first')
    run_dir = root/'science-runs'/current['runId']
    voice = json.loads((run_dir/'summary.json').read_text())
    configuration, profile_path, setup = resolve_setup(root, summary.get('setupId'), legacy=not summary.get('setupId'))
    if setup and (summary.get('setupConfigurationSha256') != setup['configurationSha256'] or summary.get('setupProfileSha256') != setup['profileSha256']):
        raise ValueError('Probe setup differs from the configuration retained by this import')
    if not profile_path.exists(): raise ValueError('Declare probe placement and controls in Calibration setup first')
    profile = json.loads(profile_path.read_text())
    if set(profile) != {'JA','gain','direct_gain','coupling_gain','delay_s'}:
        raise ValueError('Probe profile requires JA, gain, direct_gain, coupling_gain and delay_s')
    # Re-import original bytes and supplemental evidence immediately before use.
    import subprocess
    from science.scripts.prepare_probe_capture import ROOT
    import tempfile
    verified=Path(tempfile.mkdtemp(prefix='verification-',dir=output))/'import'
    subprocess.run(['node','--experimental-strip-types',str(ROOT/'science/scripts/import_probe_science.ts'),
                    str(imported/summary['captureDirectory']),str(verified),
                    str(configuration)], check=True, stdout=subprocess.DEVNULL)
    document = json.loads((verified/'probe-science-document.json').read_text())
    if document is None: raise ValueError('Probe evidence is no longer eligible')
    fit = json.loads((run_dir/'fit.json').read_text())
    with backend_for(output, voice['sessionId']) as backend:
        state = backend.execute({'action':'state'})['state']
        if state.get('snapshot',{}).get('model_id') != expected_model_id:
            raise ValueError('Model changed; refresh before fitting the probe')
        candidates=[]
        for hypothesis in state['snapshot']['hypotheses']:
            row=next((r for r in fit['joint']['candidates'] if r.get('status')=='scored' and r['anatomy']==hypothesis['anatomy']),None)
            if row is None: raise ValueError('Current model has no matching retained singing controls')
            candidates.append({'candidate_id':hypothesis['hypothesis_id'],'anatomy':hypothesis['anatomy'],
                'trials':{p['trial_id']:p['controls'] for p in row['predictions']},
                'probe_trials':{t['id']:profile for t in document['trials']}})
        count=2*len(candidates)*(len(state['calibration']['trials'])+2*len(document['trials']))
        parameters={'probe_observations':document,'candidates':candidates,'max_native_calls':count,'pcm_weight':1.,'probe_weight':1.}
        seal(output/'request.json',parameters)
        intent={'importId':import_id,'parentModelId':expected_model_id,'sessionId':voice['sessionId'],
            'setupId':setup['setupId'] if setup else None,
            'configurationSha256':hashlib.sha256(configuration.read_bytes()).hexdigest(),
            'profileSha256':hashlib.sha256(profile_path.read_bytes()).hexdigest(),
            'verifiedImport':str(verified.relative_to(output)),
            'command':{'action':'fit_probe','command_id':output.name+'-fit',
                'expected_version':state['version'],'parameters':parameters}}
        seal(intent_path,intent)
        return finish(backend,intent,output)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-root',required=True);p.add_argument('--import-id',required=True)
    p.add_argument('--expected-model-id',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();print(json.dumps(run(a.data_root,a.import_id,a.expected_model_id,a.output)))
