"""Verified capture import -> durable session search/design -> native geometry export."""
import argparse
import base64
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

import numpy as np

from singing_physics.engine import digest, write_json
from singing_physics.pcm_inverse import FEATURES, extract_pcm
from singing_physics.pcm_spectral import COARSE_OBJECTIVE, SPECTRAL_OBJECTIVE, objective_policy, extract_spectral, validate_observation
from singing_physics.service import JobService, canonical
from singing_physics.session import SessionController
from science.scripts.model_space_diff import pair

ROOT = Path(__file__).resolve().parents[2]
EXPORTS = ('tract0.obj','tract0.mtl','tract.svg','geometry.json','manifest.json')


def now(): return datetime.now(timezone.utc).isoformat()


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Scientific service redirects are forbidden')


class HTTPBackend:
    """Use the existing scientific worker and session owner over private loopback."""
    def __init__(self, url, token, session_id):
        parsed=urlsplit(url)
        if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or not parsed.port or parsed.path not in ('','/') or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('SCIENCE_URL must be literal http://127.0.0.1:PORT')
        if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}',token):
            raise ValueError('SCIENCE_TOKEN must be a private bearer token')
        self.url=url.rstrip('/');self.token=token;self.session_id=session_id
        self.opener=build_opener(ProxyHandler({}),_NoRedirect())

    def request(self,path,body=None):
        headers={'Authorization':'Bearer '+self.token}
        if body is not None: headers['Content-Type']='application/json'
        request=Request(self.url+path,data=json.dumps(body,allow_nan=False).encode() if body is not None else None,headers=headers)
        with self.opener.open(request,timeout=getattr(self,'request_timeout_s',60)) as response:
            data=response.read(64_000_001)
        if len(data)>64_000_000: raise ValueError('Scientific response exceeds local limit')
        return json.loads(data)

    def execute(self,command):
        return self.request('/sessions/'+self.session_id+'/commands',command)

    def ledger(self):
        """Verified replay read without dispatching a pending job (never a session action)."""
        return self.request('/sessions/'+self.session_id+'/ledger')

    def submit(self,request,key):
        return self.request('/jobs',{'request':request,'idempotency_key':key})['id']

    def status(self,job_id): return self.request('/jobs/'+job_id)
    def result(self,job_id): return self.request('/jobs/'+job_id+'/result')
    def exports(self,job_id): return self.request('/jobs/'+job_id+'/exports')
    def cancel(self,job_id): return self.request('/jobs/'+job_id+'/cancel',{})


class LocalBackend:
    def __init__(self,service,session_id):
        self.service=service;self.session_id=session_id
        self.controller=SessionController(service.root/'sessions',service,session_id)
    def execute(self,command): return self.controller.execute(command)
    def submit(self,request,key): return self.service.submit(request,idempotency_key=key)
    def status(self,job_id): return self.service.status(job_id)
    def result(self,job_id): return self.service.result(job_id)
    def cancel(self,job_id): return self.service.cancel(job_id)
    def exports(self,job_id):
        result=self.service.result(job_id)
        root=self.service.root/'artifacts'/job_id/'forward'
        files={}
        for name in EXPORTS:
            raw=(root/name).read_bytes()
            if name!='manifest.json' and hashlib.sha256(raw).hexdigest()!=result['files'][name]:
                raise ValueError('Forward export hash mismatch')
            files[name]={'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest(),'byteLength':len(raw)}
        return {'job_id':job_id,'files':files}


@contextmanager
def backend_for(output,session_id):
    url,token=os.environ.get('SCIENCE_URL'),os.environ.get('SCIENCE_TOKEN')
    if bool(url)!=bool(token): raise ValueError('Configure both SCIENCE_URL and SCIENCE_TOKEN')
    if url:
        yield HTTPBackend(url,token,session_id)
    else:
        with JobService(output/'jobs',timeout_s=180) as service:
            yield LocalBackend(service,session_id)


def wait(backend,job_id):
    deadline=time.monotonic()+185
    while time.monotonic()<deadline:
        state=backend.status(job_id)
        if state['status'] in ('succeeded','failed','cancelled'): return state
        time.sleep(.1)
    raise TimeoutError('Scientific job did not finish within 185 seconds')


def spectral_trials(data, output, trials):
    """Derive spectral observations from the importer's hash-verified original segment bytes.

    The canonical measurement is re-extracted from the same frame and must match, so
    the dedicated frame_sha256 binds both descriptions to the exact float32 bytes.
    """
    result = deepcopy(trials)
    for trial in result:
        measurement = trial['measurement']
        matches = [s for s in data['segments'] if s['derived_artifact']['id'] == measurement['artifactId'] and measurement['id'] in s['measurement_ids']]
        if len(matches) != 1:
            raise ValueError('Canonical frame has no unique verified original PCM segment')
        segment = matches[0]; artifact = segment['derived_artifact']; name = artifact['uri']
        if not isinstance(name,str) or Path(name).name != name or not name.endswith('.pcm.f32'):
            raise ValueError('Invalid original PCM segment path')
        path = output/'import'/name
        with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
            info = os.fstat(stream.fileno())
            if info.st_size != artifact['byteLength'] or not 0 < info.st_size <= 64*1024*1024:
                raise ValueError('Original PCM segment size changed')
            raw = stream.read()
        if hashlib.sha256(raw).hexdigest() != artifact['sha256'] or measurement['provenance']['sourceHashes'] != [artifact['sha256']]:
            raise ValueError('Original PCM segment digest changed')
        start,size = trial['frame_start_sample'],trial['frame_size']
        values = np.frombuffer(raw,dtype='<f4')
        if len(values) != segment['sample_count'] or segment['sample_rate_hz'] != trial['sample_rate_hz'] or start+size > len(values):
            raise ValueError('Original PCM frame profile changed')
        frame = values[start:start+size]
        recomputed = extract_pcm(frame,trial['sample_rate_hz'],measurement_id=measurement['id'],observation_id=measurement['observationId'],
            artifact_id=measurement['artifactId'],start_ms=start/trial['sample_rate_hz']*1000)
        if recomputed['measurement']['measurements'] != measurement['measurements'] or recomputed['measurement']['window'] != measurement['window']:
            raise ValueError('Canonical measurement differs from the verified original frame')
        trial['frame_sha256'] = recomputed['pcmFloat32Sha256']
        trial['spectral_observation'] = extract_spectral(frame,trial['sample_rate_hz'],
            source_artifact_hashes=measurement['provenance']['sourceHashes'],source_artifact_id=measurement['artifactId'],frame_start_sample=start)
        validate_observation(trial)
    return result


def pipeline(data, output, backend, session_id, *, objective=COARSE_OBJECTIVE):
    """Run already imported canonical evidence through the authoritative session."""
    objective_policy(objective)
    protocol={'selection':'Earliest two full-descriptor voiced windows; periodicity >= .85, dbfs > -60, pitch65..1000, no clipping/invalid/low-snr',
        'pose_assumption':'Prompted comfortable ah treated as a; phonetics not independently verified',
        'anatomy_bounds':{'hard_palate_length':[3.8,5.1],'lip_width':[.5,1.5]},'gains':[1.,4.,16.],'JA':-3.,
        'search_budget':60,'search_rounds':1,'seed':7,'objective':objective,
        'forecast_conditions':'Library a/e/i at JA=-3, F0=180Hz, gain=4; simulator conditions, not observed execution',
        'claim':'Conditional research hypotheses. No identified anatomy, microphone/room calibration, muscle tension or tissue mechanics.'}
    if objective == SPECTRAL_OBJECTIVE:
        protocol['spectral_nuisance']='Per-resolution shape normalization; separate bounded ±24 dB gain and ±6 dB/octave empirical tilt; no calibrated room response'
    write_json(output/'protocol.json',protocol)
    eligible=[]
    for trial in data['fit_trial_options']:
        m=trial['measurement'];values={x['name']:x['value'] for x in m['measurements']}
        if all(values.get(k) is not None for k in FEATURES) and values['periodicity']>=.85 and values['dbfs']>-60 and 65<=values['pitchHz']<=1000 and not set(m['quality']['flags']) & {'clipping','invalid','low-snr'}:
            eligible.append(trial)
    trials=eligible[:2]
    if len(trials)<2: raise ValueError('No two eligible voice windows; import retained, no fitting performed')
    if objective == SPECTRAL_OBJECTIVE:
        trials=spectral_trials(data,output,trials)
    document={'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':trials}
    write_json(output/'observations.json',document)
    nuisance=[{'profile_id':f'gain-{gain:g}','trials':{t['id']:{'JA':-3.,'f0_hz':next(x['value'] for x in t['measurement']['measurements'] if x['name']=='pitchHz'),'gain':gain} for t in trials}} for gain in protocol['gains']]
    jobs=[]
    def command(action,**fields):
        state=backend.execute({'action':'state'})['state']
        command_id=f'{output.name}-{action}-{state["version"]}'
        if action in ('search','propose_design'):
            backend.session_job_key='session:'+hashlib.sha256(canonical([session_id,command_id]).encode()).hexdigest()
        return backend.execute({'action':action,'command_id':command_id,
            'expected_version':state['version'],**fields})['state']
    def session_job(action,parameters):
        state=command(action,parameters=parameters);pending=state['pending']
        if pending is None: raise RuntimeError('Session job submission failed; session ledger retained')
        ident=pending['job_id'];receipt=wait(backend,ident)
        state=command('collect_job',job_id=ident)
        backend.session_job_key=None
        jobs.append({'id':ident,'operation':pending['request']['operation'],'status':receipt['status']})
        write_json(output/'session-ledger.json',backend.execute({'action':'replay'}))
        if receipt['status']!='succeeded': raise RuntimeError(f'{action}: {receipt.get("error")}')
        return state,state['jobs'][-1]['result']
    if backend.execute({'action':'state'})['state']['version']!=0:
        raise ValueError('Live calibration requires a new session; existing ledger is preserved')
    command('ingest_calibration',document=document)
    state,fit=session_job('search',{'anatomy_bounds':protocol['anatomy_bounds'],'nuisance_profiles':nuisance,
        'objective':protocol['objective'],'max_synthesis_calls':protocol['search_budget'],'rounds':protocol['search_rounds'],'seed':protocol['seed']})
    write_json(output/'fit.json',fit)
    best=fit['joint']['best']
    if best is None or state['snapshot'] is None: raise ValueError('No scorable candidate; attempted hypotheses retained')
    snapshot=state['snapshot'];write_json(output/'hypotheses.json',snapshot)
    rate=trials[0]['sample_rate_hz']
    forecast_profile={'sample_rate_hz':rate,'frame_start_sample':round(rate*.1),
                      'frame_size':trials[0]['frame_size'],'duration_s':.25}
    state,forecast=session_job('propose_design',{'objective':protocol['objective'],'profile':forecast_profile,'design_id':'prospective-'+output.name,'target_observation_id':'future-voice-'+output.name,
        'experiments':[{'experiment_id':p,'pose':p,'JA':-3.,'f0_hz':180.,'gain':4.} for p in ['a','e','i']],
        'feature_scales':{name:{'unit':unit,'scale':scale,'assumption':'Engineering discrepancy scale, not calibrated noise'} for name,(unit,scale) in FEATURES.items()},
        'minimum_separation':.05,'retention_margin':.05,'maximum_discrepancy':2.,'max_synthesis_calls':3*len(snapshot['hypotheses'])})
    write_json(output/'forecast.json',forecast)
    baseline=fit['fixed_anatomy_baseline']['best']
    reference=fit['fixed_anatomy_baseline']['candidates'][0]['anatomy']
    def export_geometry(anatomy,key,directory):
        request={'operation':'forward','session_id':session_id,'model_id':snapshot['model_id'],
            'parameters':{'pose':'a','anatomy':anatomy,'articulation':{'JA':-3.},'f0_hz':180.,'duration_s':.25}}
        write_json(output/f'{key}-request.json',request)
        backend.forward_job_id=None
        backend.forward_intent=(request,output.name+'-'+key)
        forward_id=backend.submit(*backend.forward_intent);backend.forward_job_id=forward_id
        receipt=wait(backend,forward_id)
        jobs.append({'id':forward_id,'operation':'forward','role':key,'status':receipt['status']})
        if receipt['status']!='succeeded': raise RuntimeError('Forward export failed: '+str(receipt.get('error')))
        forward=backend.result(forward_id);bundle=backend.exports(forward_id)
        if bundle.get('job_id')!=forward_id: raise ValueError('Export belongs to a different job')
        directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        files={}
        for name in EXPORTS:
            entry=bundle['files'][name];raw=base64.b64decode(entry['base64'],validate=True)
            sha=hashlib.sha256(raw).hexdigest()
            if len(raw)!=entry['byteLength'] or sha!=entry['sha256'] or (name!='manifest.json' and sha!=forward['files'][name]):
                raise ValueError('Forward export integrity failure')
            if name=='manifest.json' and json.loads(raw)!=forward: raise ValueError('Forward manifest differs from verified result')
            (directory/name).write_bytes(raw);files[name]={'sha256':sha,'byteLength':len(raw)}
        return files
    files=export_geometry(best['anatomy'],'forward',output)
    reference_directory=output/'reference'
    export_geometry(reference,'reference-forward',reference_directory)
    write_json(output/'space-diff.json',pair(output,reference_directory))
    files['space-diff.json']={'sha256':digest(output/'space-diff.json'),'byteLength':(output/'space-diff.json').stat().st_size}
    summary={'schemaVersion':'local-science-result-1','runId':output.name,'sessionId':session_id,'modelId':snapshot['model_id'],
        'sessionVersion':state['version'],'designId':forecast['design_id'],'createdAt':now(),'status':'succeeded',
        'source':data['declared_evidence_kind'],'sourceAuthenticity':'Package byte consistency verified; physical device and human origin are caller-declared',
        'sourceImportSha256':digest(output/'import/native-pcm.json'),'calibrationWindows':len(trials),'eligibleWindows':len(eligible),'jobs':jobs,
        'nativeCalls':fit['actual_synthesis_calls']+forecast['actual_synthesis_calls']+2,
        'nativeCallsScope':'Actual PCM synthesis calls only; export also performs spectrum, tube geometry, mesh and SVG operations',
        'candidateId':best['candidate_id'],'anatomy':best['anatomy'],'referenceAnatomy':reference,
        'objective':protocol['objective'],'objectivePolicy':fit['objective_policy'],
        'fitDiscrepancy':best['weighted_mean_square_discrepancy'],
        'baselineDiscrepancy':baseline['weighted_mean_square_discrepancy'] if baseline else None,
        'forecast':forecast,'files':files,'anatomyValidated':False,'liveTongueSource':'camera tracking, not scientific-model inference',
        'interpretation':protocol['claim'],'geometryRole':'Native prediction at a declared a/JA=-3 pose; not a measured patient mesh',
        'forecastRole':'Committed prospective simulator predictions; no later human target scored yet'}
    return summary



class CaptureInterrupted(RuntimeError):
    pass


@contextmanager
def interruption_signals():
    """Give a terminated CLI a bounded opportunity to cancel remote work."""
    previous={sig:signal.getsignal(sig) for sig in (signal.SIGTERM,signal.SIGINT)}
    def stop(signum,_frame):
        # A second signal must not interrupt receipt persistence/remote cancellation.
        for sig in previous: signal.signal(sig,signal.SIG_IGN)
        raise CaptureInterrupted('Capture pipeline interrupted by signal '+str(signum))
    try:
        for sig in previous: signal.signal(sig,stop)
        yield
    finally:
        for sig,handler in previous.items(): signal.signal(sig,handler)


def cancel_owned_jobs(backend,run_id):
    """Cancel only this pipeline's intents, then collect terminal session receipts."""
    if isinstance(backend,HTTPBackend): backend.request_timeout_s=3
    report={'status':'reconciled','jobs':[]}
    state=backend.execute({'action':'state'})['state'];pending=state['pending']
    if pending and pending['key']==getattr(backend,'session_job_key',None):
        identity=pending['job_id'];backend.cancel(identity)
        receipt=backend.status(identity)
        if receipt['status'] not in ('succeeded','failed','cancelled'):
            raise RuntimeError('Cancellation did not produce a terminal job receipt')
        # A completion which beat cancellation is retained, but no next stage runs.
        backend.execute({'action':'collect_job','command_id':run_id+'-interrupt-'+identity,
                         'expected_version':state['version'],'job_id':identity})
        report['jobs'].append({'job_id':identity,'status':receipt['status']})
    intent=getattr(backend,'forward_intent',None)
    if intent:
        identity=getattr(backend,'forward_job_id',None)
        if identity is None:
            # Recover the exact idempotent submission if its HTTP reply was lost.
            identity=backend.submit(*intent)
        backend.cancel(identity)
        report['jobs'].append({'job_id':identity,'status':backend.status(identity)['status']})
    return report


def run(source,output,*,development_fixture=False,objective=COARSE_OBJECTIVE):
    objective_policy(objective)
    output.mkdir(parents=True,exist_ok=False,mode=0o700)
    session_id='live-'+hashlib.sha256(str(output.resolve()).encode()).hexdigest()[:24]
    args=['node','--experimental-strip-types',str(ROOT/'science/scripts/import_native_pcm.ts'),str(source),str(output/'import'),'local-participant',session_id,'a']
    if development_fixture: args.append('--development-fixture')
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
    data=json.loads((output/'import/native-pcm.json').read_text())
    with backend_for(output,session_id) as backend:
        try:
            summary=pipeline(data,output,backend,session_id,objective=objective)
        except BaseException as exc:
            report={'status':'interrupted','reason':str(exc),'time':now()}
            try: report['cleanup']=cancel_owned_jobs(backend,output.name)
            except Exception as cleanup_error:
                report['cleanup']={'status':'reconciliation_required','error':str(cleanup_error)}
            write_json(output/'interruption.json',report)
            try: write_json(output/'session-ledger.json',backend.execute({'action':'replay'}))
            except Exception as ledger_error:
                write_json(output/'ledger-recovery.json',{'status':'reconciliation_required','error':str(ledger_error),'sessionId':session_id})
            raise
        else:
            write_json(output/'session-ledger.json',backend.execute({'action':'replay'}))
    manifest=(source/'manifest.json').read_bytes()
    if hashlib.sha256(manifest).hexdigest()!=data['source_manifest_sha256']:
        raise ValueError('Source manifest changed after verified import')
    summary['sourceCaptureId']=json.loads(manifest)['capture_id']
    write_json(output/'summary.json',summary)
    print(json.dumps({'status':'succeeded','runId':output.name,'sessionId':session_id,'nativeCalls':summary['nativeCalls']},indent=2))
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--development-fixture',action='store_true')
    p.add_argument('--objective',choices=[COARSE_OBJECTIVE,SPECTRAL_OBJECTIVE],default=COARSE_OBJECTIVE)
    a=p.parse_args()
    try:
        with interruption_signals():
            run(a.source.resolve(),a.output.resolve(),development_fixture=a.development_fixture,objective=a.objective)
    except Exception as e:
        if a.output.exists():write_json(a.output/'failure.json',{'status':'failed','error':str(e),'time':now()})
        raise
