"""App-operated optional source jobs from verified original native recordings."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

import numpy as np
from live_capture_jobs import HTTPBackend, ROOT
from import_session_bundle import _archive, _phase, _json
from singing_physics.phonation import measure_phonation


def read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>64*1024*1024:raise ValueError('Invalid source artifact')
    return path.read_bytes()


def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(path):return json.loads(read(path))
def save(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,allow_nan=False));temporary.chmod(0o600);temporary.replace(path)


def frame(import_dir,session_id,identity=None,evidence_at=None,rate=None):
    imported=load(import_dir/'native-pcm.json')
    for segment in imported['segments']:
        sample_rate=segment['sample_rate_hz'];size=8192 if sample_rate==96000 else 4096;start=round(.1*sample_rate)
        if rate is not None and rate!=sample_rate:continue
        artifact=segment['derived_artifact']
        if Path(artifact['uri']).name!=artifact['uri']:raise ValueError('Invalid PCM artifact path')
        raw=read(import_dir/artifact['uri'])
        if sha(raw)!=artifact['sha256'] or len(raw)!=artifact['byteLength']:raise ValueError('PCM integrity mismatch')
        values=np.frombuffer(raw,dtype='<f4')
        if len(values)<start+size:continue
        target=identity or segment['segment_id']+'-source'
        metadata={'observationId':target,'sessionId':session_id,'attemptId':segment['segment_id'],'artifactId':artifact['id'],
            'sourceHashes':[artifact['sha256'],imported['source_manifest_sha256'],*[s['sha256'] for s in segment['source_artifacts']]],
            'evidenceAt':evidence_at,'windowStartSample':start,'clockId':segment['source_clock_id'],'syncUncertaintyMs':segment['capture_sync_uncertainty_ms'],
            'sourceKind':imported['declared_evidence_kind'],'processing':{'automaticGainControl':None,'noiseSuppression':None,'echoCancellation':None}}
        values=values[start:start+size].tolist();record=measure_phonation(values,sample_rate,metadata)
        if record['capabilities']['measurement']['status']=='available':return {'id':target,'pose':'a','pcm':values,'sample_rate_hz':sample_rate,'metadata':metadata},record
    raise ValueError('No eligible original phonation frame at the frozen sample rate')


def capture(root,output,session_id,target,committed_at,rate,kind,pose):
    receipt=load(root/'native-pull-latest.json');name=receipt.get('name','')
    if not re.fullmatch(r'capture-[0-9a-fA-F-]{36}\.zip',name):raise ValueError('Pull a later ordinary voice capture')
    raw=read(root/'usb-imports'/name)
    if len(raw)!=receipt['bytes'] or sha(raw)!=receipt['sha256']:raise ValueError('Original USB archive integrity mismatch')
    files=_archive(raw,[512*1024*1024]);manifest=_phase(files,'videoDepth')
    if manifest.get('capture_id','').upper()!=name[8:-4].upper():raise ValueError('USB identity mismatch')
    if manifest.get('pose') is not None and manifest['pose']!=pose:raise ValueError('Capture vowel differs from the source forecast')
    if manifest.get('drive') or manifest.get('protocol') or manifest.get('containsProbe') or manifest.get('contains_external_excitation') or manifest.get('audio',{}).get('containsProbe'):raise ValueError('External excitation is not singing evidence')
    observed=datetime.fromisoformat(manifest['created_at'].replace('Z','+00:00'));committed=datetime.fromisoformat(committed_at.replace('Z','+00:00'))
    if observed.tzinfo is None or not committed<observed<=datetime.now(timezone.utc):raise ValueError('Original capture must follow source forecast commitment')
    original=output/'original';original.mkdir(exist_ok=True,mode=0o700)
    for name,data in files.items():
        path=original/name
        if path.exists() and read(path)!=data:raise ValueError('Prepared original capture changed')
        if not path.exists():path.write_bytes(data);path.chmod(0o600)
    imported=output/'import'
    if not imported.exists():subprocess.run(['node','--experimental-strip-types',str(ROOT/'science/scripts/import_native_pcm.ts'),str(original),str(imported),'source-participant',session_id,pose,*(['--development-fixture'] if kind=='development-fixture' else [])],check=True,capture_output=True,timeout=60)
    if load(imported/'native-pcm.json')['source_manifest_sha256']!=sha(files['manifest.json']):raise ValueError('Imported source archive differs')
    trial,_=frame(imported,session_id,target,manifest['created_at'],rate)
    return trial,{'source_archive_sha256':receipt['sha256'],'source_manifest_sha256':sha(files['manifest.json']),'timestamp_scope':'Native-declared capture start UTC; device clock authenticity and human execution unverified','declared_pose':pose}


def run(root,phase,output):
    current=load(root/'science-current.json');run_id=current.get('runId','')
    if current.get('status')!='succeeded' or not re.fullmatch(r'run-[A-Za-z0-9_-]+',run_id):raise ValueError('A completed voice model is required')
    directory=root/'science-runs'/run_id;summary=load(directory/'summary.json');session_id=summary['sessionId']
    backend=HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],session_id)
    state=backend.execute({'action':'state'})['state'];baseline=state['snapshot']['model_id'];identity='source-app-'+output.name
    if phase in ('forecast','score') and (directory/'astra-rest.json').exists():raise ValueError('Astra selected rest; obtain a new recording decision first')
    intent_path=output/'intent.json';existing=load(intent_path) if intent_path.exists() else None
    if existing:
        if existing['baselineModelId']!=baseline:raise ValueError('Source attempt belongs to an earlier baseline model')
        command=existing['command'];binding=existing['binding']
    elif phase=='fit':
        imported=directory/'import'
        if sha(read(imported/'native-pcm.json'))!=summary['sourceImportSha256']:raise ValueError('Original import digest mismatch')
        source=load(imported/'native-pcm.json');manifest_path=Path(source['source_directory'])/'manifest.json';manifest=load(manifest_path)
        if sha(read(manifest_path))!=source['source_manifest_sha256']:raise ValueError('Original manifest changed')
        trial,record=frame(imported,session_id,evidence_at=manifest['created_at']);pitch=record['descriptors']['pitchHz']['value']
        if pitch is None or not 65<=pitch<=600:raise ValueError('Observed pitch outside supported conditional source range')
        hypotheses=state['snapshot']['hypotheses']
        if not 1<=len(hypotheses)<=8:raise ValueError('Optional source candidate budget cannot cover current anatomy support')
        skews=[-.2,0.,.2] if len(hypotheses)<=2 else [-.2,.2] if len(hypotheses)<=4 else [0.]
        candidates=[{'candidate_id':f'source-{i}-{j}','anatomy':h['anatomy'],'trials':{trial['id']:{'JA':-3.,'F0':pitch,'PR':8000.,'PS':ps,'gain':4.}}} for i,h in enumerate(hypotheses) for j,ps in enumerate(skews)]
        command={'action':'fit_source','parameters':{'document':{'schema_version':'phonation-fit-1','trials':[trial]},'candidates':candidates,'max_synthesis_calls':3*len(candidates),'timeout_s':90.}}
        binding={'source_import_sha256':summary['sourceImportSha256'],'source_assumptions':'Measured acoustic pitch; prescribed JA=-3, PR=8000 and gain=4. PS alternatives are simulator hypotheses, not observed execution or closure.'}
    elif phase=='forecast':
        model=state.get('source_model')
        if not model or model['baseline_model_id']!=baseline:raise ValueError('Fit a source model for the current anatomy first')
        best=model['result']['joint']['best'];reference=best['predictions'][0];pose='a'
        pointer=directory/'astra-current.json'
        if pointer.exists():
            active=load(pointer);data=active['forecast'];chosen=next((r['experiment'] for r in data['rankings'] if r['experiment']['experiment_id']==data['selected_experiment_id']),None)
            if active['modelId']==baseline and chosen:pose=chosen['pose']
        command={'action':'forecast_source','parameters':{'family':'joint','candidate_id':best['candidate_id'],'reference_trial_id':reference['trial_id'],'pose':pose,'controls':{k:reference['controls'][k] for k in ('JA','F0','PR','gain')},'target_id':identity}}
        binding={'sourceModelId':model['model_id'],'pose':pose,'instruction':f'Record a comfortable sustained {pose} vowel. Keep pitch and microphone position similar; stop for discomfort.','source_assumptions':'Conditional source simulation; execution controls are not measured physiology.'}
    elif phase=='score':
        forecasts=[(k,v) for k,v in state.get('source_forecasts',{}).items() if v['status']=='committed' and v['baseline_model_id']==baseline]
        if not forecasts:raise ValueError('Commit a current source forecast before recording')
        target,frozen=forecasts[-1];forecast=frozen['artifact']['forecast'];pose=forecast.get('pose') or forecast.get('native_state',{}).get('articulation',{}).get('pose','a')
        phase_record=load(directory/'source-forecast.json');pose=phase_record.get('result',{}).get('pose',pose)
        rate=forecast['record']['window']['sampleRateHz'];trial,binding=capture(root,output,session_id,target,frozen['committed_at'],rate,summary['source'],pose)
        command={'action':'score_source','forecast_id':target,'pcm':trial['pcm'],'metadata':trial['metadata']};binding['forecastId']=target
    else:raise ValueError('Unknown source operation')
    if not existing:
        command.update(command_id=identity,expected_version=state['version']);save(intent_path,{'command':command,'binding':binding,'baselineModelId':baseline})
    if not state.get('pending'):
        done=next((j for j in state['jobs'] if j.get('request',{}).get('operation')=={'fit':'fit_phonation','forecast':'forecast_phonation','score':'score_phonation'}[phase] and j.get('key')== 'session:'+hashlib.sha256(json.dumps([session_id,identity],sort_keys=True,separators=(',',':')).encode()).hexdigest()),None)
        if done:
            result=done.get('result');save(output/'result.json',{**result,**binding,'baselineModelId':baseline,'sessionId':session_id});return
        state=backend.execute(command)['state']
    pending=state['pending']
    expected_key='session:'+hashlib.sha256(json.dumps([session_id,identity],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if pending['key']!=expected_key or pending['request']['operation']!={'fit':'fit_phonation','forecast':'forecast_phonation','score':'score_phonation'}[phase]:raise ValueError('Unrelated scientific job is running')
    job=pending['job_id'];deadline=time.monotonic()+125
    while time.monotonic()<deadline:
        status=backend.status(job)
        if status['status'] in ('succeeded','failed','cancelled'):break
        time.sleep(.15)
    else:raise ValueError('Source job is still running; retry to recover')
    state=backend.execute({'action':'collect_job','command_id':identity+'-collect','expected_version':state['version'],'job_id':job})['state']
    completed=next(j for j in state['jobs'] if j['job_id']==job)
    result=completed.get('result')
    if result is None:raise ValueError('Optional source worker failed; baseline retained')
    save(output/'result.json',{**result,**binding,'baselineModelId':baseline,'sessionId':session_id,'sourceModelId':state.get('source_model',{}).get('model_id'),'sessionVersion':state['version']})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-root',type=Path,required=True);parser.add_argument('--phase',choices=['fit','forecast','score'],required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();run(args.data_root.resolve(),args.phase,args.output.resolve())
