"""Apply a verified external probe to the current session's retained candidates."""
import argparse
import json
from pathlib import Path
from science.scripts.live_capture_jobs import backend_for, wait
from science.scripts.prepare_probe_capture import write


def run(data_root, import_id, expected_model_id, output):
    root, output = Path(data_root), Path(output)
    imported = root/'probe-imports'/import_id
    summary = json.loads((imported/'summary.json').read_text())
    if not summary['eligible']: raise ValueError('Probe calibration/import is not eligible for fitting')
    current = json.loads((root/'science-current.json').read_text())
    if current.get('status') != 'succeeded': raise ValueError('Complete a voice model fit first')
    run_dir = root/'science-runs'/current['runId']
    voice = json.loads((run_dir/'summary.json').read_text())
    profile_path = root/'probe-fit-profile.json'
    if not profile_path.exists(): raise ValueError('Declare the measured probe placement nuisance controls in the private probe-fit-profile.json first')
    profile = json.loads(profile_path.read_text())
    if set(profile) != {'JA','gain','direct_gain','coupling_gain','delay_s'}:
        raise ValueError('Probe profile requires JA, gain, direct_gain, coupling_gain and delay_s')
    # Re-import original bytes and supplemental evidence immediately before use.
    import subprocess
    from science.scripts.prepare_probe_capture import ROOT
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    subprocess.run(['node','--experimental-strip-types',str(ROOT/'science/scripts/import_probe_science.ts'),
                    str(imported/summary['captureDirectory']),str(output/'verified-import'),
                    str(root/'probe-science-config.json')], check=True, stdout=subprocess.DEVNULL)
    document = json.loads((output/'verified-import/probe-science-document.json').read_text())
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
        write(output/'request.json',parameters)
        state=backend.execute({'action':'fit_probe','command_id':output.name+'-fit',
            'expected_version':state['version'],'parameters':parameters})['state']
        job=state['pending']['job_id']; terminal=wait(backend,job)
        state=backend.execute({'action':'collect_job','command_id':output.name+'-collect',
            'expected_version':state['version'],'job_id':job})['state']
        write(output/'session-ledger.json',backend.execute({'action':'replay'}))
        if terminal['status']!='succeeded': raise ValueError('Joint probe job failed; session ledger retained')
        result=backend.result(job); write(output/'result.json',result)
        best=result['joint']['best']; baseline=result['fixed_anatomy_baseline']['best']
        adopted=state['snapshot']['model_id']!=expected_model_id
        answer={'importId':import_id,'parentModelId':expected_model_id,'modelId':state['snapshot']['model_id'],
            'status':result['status'],'includedInFit':result['status']=='joint_probe_evidence_used',
            'probeRecords':result['probe_records'],'score':best,'baselineScore':baseline,
            'nativeCalls':result['actual_operator_calls'],'adoptionStatus':'updated' if adopted else 'unchanged',
            'jobId':job,'sessionId':voice['sessionId']}
        write(output/'summary.json',answer)
        return answer


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-root',required=True);p.add_argument('--import-id',required=True)
    p.add_argument('--expected-model-id',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();print(json.dumps(run(a.data_root,a.import_id,a.expected_model_id,a.output)))
