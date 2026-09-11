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


def read(path,limit=64*1024*1024):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>limit:raise ValueError('Invalid source artifact')
    return path.read_bytes()


def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(path):return json.loads(read(path))
def save(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,allow_nan=False));temporary.chmod(0o600);temporary.replace(path)


def source_candidates(hypotheses,trial_id,pitch,source_model='geometric'):
    """Equal finite source support for every retained anatomy along one declared shape axis.

    Geometric alternatives vary PS; two-mass alternatives vary rest displacement
    XB=XT with EAA=0 cm² and DF=1 fixed, so a preference is attributable to one
    control. Gain 2 keeps both families below clipping across 65-600 Hz.
    """
    if source_model not in ('geometric','two_mass'):raise ValueError('Unsupported app source model')
    if not 1<=len(hypotheses)<=8:raise ValueError('Optional source candidate budget cannot cover current anatomy support')
    three=len(hypotheses)<=2
    if source_model=='geometric':support=[{'PS':ps} for ps in ([-.2,0.,.2] if three else [-.2,.2])]
    else:support=[{'source_model':'two_mass','XB':x,'XT':x,'EAA':0.,'DF':1.} for x in ([.005,.01,.015] if three else [.005,.015])]
    prefix='source' if source_model=='geometric' else 'mechanical'
    return [{'candidate_id':f'{prefix}-{i}-{j}','anatomy':h['anatomy'],'trials':{trial_id:{'JA':-3.,'F0':pitch,'PR':8000.,'gain':2.,**shape}}}
        for i,h in enumerate(hypotheses) for j,shape in enumerate(support)],support


def frame(import_dir,session_id,identity=None,evidence_at=None,rate=None,declared_pose=None):
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
        poses={trial['pose'] for trial in imported.get('fit_trial_options',[]) if trial.get('measurement',{}).get('observationId')==segment['segment_id']}
        pose=declared_pose or (next(iter(poses)) if len(poses)==1 else None)
        if not pose:raise ValueError('Source trial requires an existing explicit vowel declaration')
        if record['capabilities']['measurement']['status']=='available':return {'id':target,'pose':pose,'pcm':values,'sample_rate_hz':sample_rate,'metadata':metadata},record
    raise ValueError('No eligible original phonation frame at the frozen sample rate')


def capture(root,output,session_id,target,committed_at,rate,kind,pose):
    receipt=load(root/'native-pull-latest.json');name=receipt.get('name','')
    if not re.fullmatch(r'capture-[0-9a-fA-F-]{36}\.zip',name):raise ValueError('Pull a later ordinary voice capture')
    raw=read(root/'usb-imports'/name,512*1024*1024)
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
    trial,_=frame(imported,session_id,target,manifest['created_at'],rate,pose)
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
        trial,record=frame(imported,session_id,evidence_at=manifest.get('created_at'));pitch=record['descriptors']['pitchHz']['value']
        if pitch is None or not 65<=pitch<=600:raise ValueError('Observed pitch outside supported conditional source range')
        hypotheses=state['snapshot']['hypotheses']
        source_model=os.environ.get('PHONATION_SOURCE_MODEL','geometric')
        candidates,support=source_candidates(hypotheses,trial['id'],pitch,source_model)
        command={'action':'fit_source','parameters':{'document':{'schema_version':'phonation-fit-1','trials':[trial]},'candidates':candidates,'max_synthesis_calls':3*len(candidates),'timeout_s':90.}}
        binding={'source_import_sha256':summary['sourceImportSha256'],'source_model_selection':source_model,'source_shape_support':support,'source_assumptions':'Observed acoustic pitch sets the requested native F0 control; two-mass simulated pitch can differ, and every row records requested and simulated F0. Prescribed JA=-3, PR=8000 and gain=2. Every retained anatomy has the same finite native source alternatives along one shape axis; template tissue constants stay fixed. These are simulator hypotheses, not measured execution, tissue parameters or vocal-fold contact.'}
    elif phase=='forecast':
        model=state.get('source_model')
        if not model or model['baseline_model_id']!=baseline:raise ValueError('Fit a source model for the current anatomy first')
        best=model['result']['joint']['best'];reference=best['predictions'][0];pose='a'
        pointer=directory/'astra-current.json'
        if pointer.exists():
            active=load(pointer);data=active['forecast'];chosen=next((r['experiment'] for r in data['rankings'] if r['experiment']['experiment_id']==data['selected_experiment_id']),None)
            if active['modelId']==baseline and chosen:pose=chosen['pose']
        command={'action':'forecast_source_bank','parameters':{'reference_trial_id':reference['trial_id'],'pose':pose,'controls':{k:reference['controls'][k] for k in ('JA','F0','PR','gain')},'target_id':identity,'max_synthesis_calls':48,'timeout_s':90.}}
        ranking=next((r for r in reversed(state.get('source_rankings',[])) if r['source_model_id']==model['model_id'] and r['baseline_model_id']==baseline),None)
        binding={'sourceModelId':model['model_id'],'pose':pose,'rankingParentId':ranking['ranking_id'] if ranking else None,
            'rankingParentVersion':ranking['version'] if ranking else 0,'instruction':f'Record a comfortable sustained {pose} vowel. Keep pitch and microphone position similar; stop for discomfort.','source_assumptions':'Every bounded source/tract and ablation alternative is frozen before this capture. Conditional simulator ranking is separate from baseline anatomy; execution controls are not measured physiology.'}
    elif phase=='score':
        forecasts=[(k,v) for k,v in state.get('source_forecasts',{}).items() if v['status']=='committed' and v['baseline_model_id']==baseline]
        if not forecasts:raise ValueError('Commit a current source forecast before recording')
        target,frozen=forecasts[-1];forecast=frozen['artifact']['forecast'];pose=forecast.get('pose')
        if pose not in ('a','e','i','o','u'):raise ValueError('Frozen source forecast lacks a supported vowel declaration')
        bank=forecast.get('kind')=='frozen-phonation-bank-1'
        rate=forecast['profile']['sampleRateHz'] if bank else forecast['record']['window']['sampleRateHz']
        trial,binding=capture(root,output,session_id,target,frozen['committed_at'],rate,summary['source'],pose)
        command={'action':'score_source_bank' if bank else 'score_source','forecast_id':target,'pcm':trial['pcm'],'metadata':trial['metadata']};binding['forecastId']=target
        if bank:binding['bankSha256']=frozen['artifact']['sha256']
    else:raise ValueError('Unknown source operation')
    if not existing:
        command.update(command_id=identity,expected_version=state['version']);save(intent_path,{'command':command,'binding':binding,'baselineModelId':baseline})
    operation={'fit_source':'fit_phonation','forecast_source':'forecast_phonation','score_source':'score_phonation',
        'forecast_source_bank':'forecast_phonation_bank','score_source_bank':'score_phonation_bank'}[command['action']]
    def publish(result,state,job):
        if result is None:
            save(output/'failure-receipt.json',{'status':'failed','jobId':job.get('job_id'),'commandKey':job.get('key'),
                'operation':operation,'baselineModelId':baseline,'sessionId':session_id,
                'workerStatus':job.get('status'),'reason':job.get('error') or 'Optional source worker returned no result',
                'baselinePreserved':True,'retryRequiresNewAttempt':True})
            raise ValueError('Optional source worker failed; baseline retained; retry creates a new explicit attempt')
        ranking=next((r for r in reversed(state.get('source_rankings',[])) if r['forecast_id']==binding.get('forecastId')),None)
        lineage={'conditionalRanking':{'rankingId':ranking['ranking_id'],'parentRankingId':ranking['parent_ranking_id'],
            'version':ranking['version'],'bankSha256':ranking['bank_sha256'],'sourceModelId':ranking['source_model_id'],
            'baselineModelId':ranking['baseline_model_id']}} if ranking else {}
        save(output/'result.json',{**result,**binding,**lineage,'baselineModelId':baseline,'sessionId':session_id,
            'sourceModelId':state.get('source_model',{}).get('model_id'),'sessionVersion':state['version']})
    if not state.get('pending'):
        done=next((j for j in state['jobs'] if j.get('request',{}).get('operation')==operation and j.get('key')== 'session:'+hashlib.sha256(json.dumps([session_id,identity],sort_keys=True,separators=(',',':')).encode()).hexdigest()),None)
        if done:
            publish(done.get('result'),state,done);return
        state=backend.execute(command)['state']
    pending=state['pending']
    expected_key='session:'+hashlib.sha256(json.dumps([session_id,identity],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if pending['key']!=expected_key or pending['request']['operation']!=operation:raise ValueError('Unrelated scientific job is running')
    job=pending['job_id'];deadline=time.monotonic()+125
    while time.monotonic()<deadline:
        status=backend.status(job)
        if status['status'] in ('succeeded','failed','cancelled'):break
        time.sleep(.15)
    else:raise ValueError('Source job is still running; retry to recover')
    state=backend.execute({'action':'collect_job','command_id':identity+'-collect','expected_version':state['version'],'job_id':job})['state']
    completed=next(j for j in state['jobs'] if j['job_id']==job)
    publish(completed.get('result'),state,completed)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-root',type=Path,required=True);parser.add_argument('--phase',choices=['fit','forecast','score'],required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();run(args.data_root.resolve(),args.phase,args.output.resolve())
