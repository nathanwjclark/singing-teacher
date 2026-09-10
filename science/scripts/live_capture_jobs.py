"""Verified capture import -> durable session search/design -> native geometry export."""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

from singing_physics.engine import digest, write_json
from singing_physics.pcm_inverse import FEATURES
from singing_physics.service import JobService
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
        with self.opener.open(request,timeout=60) as response:
            data=response.read(64_000_001)
        if len(data)>64_000_000: raise ValueError('Scientific response exceeds local limit')
        return json.loads(data)

    def execute(self,command):
        return self.request('/sessions/'+self.session_id+'/commands',command)

    def submit(self,request,key):
        return self.request('/jobs',{'request':request,'idempotency_key':key})['id']

    def status(self,job_id): return self.request('/jobs/'+job_id)
    def result(self,job_id): return self.request('/jobs/'+job_id+'/result')
    def exports(self,job_id): return self.request('/jobs/'+job_id+'/exports')


class LocalBackend:
    def __init__(self,service,session_id):
        self.service=service
        self.controller=SessionController(service.root/'sessions',service,session_id)
    def execute(self,command): return self.controller.execute(command)
    def submit(self,request,key): return self.service.submit(request,idempotency_key=key)
    def status(self,job_id): return self.service.status(job_id)
    def result(self,job_id): return self.service.result(job_id)
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


def pipeline(data, output, backend, session_id):
    """Run already imported canonical evidence through the authoritative session."""
    protocol={'selection':'Earliest two full-descriptor voiced windows; periodicity >= .85, dbfs > -60, pitch65..1000, no clipping/invalid/low-snr',
        'pose_assumption':'Prompted comfortable ah treated as a; phonetics not independently verified',
        'anatomy_bounds':{'hard_palate_length':[3.8,5.1]},'gains':[1.,4.,16.],'JA':-3.,
        'search_budget':36,'search_rounds':1,'seed':7,
        'forecast_conditions':'Library a/e/i at JA=-3, F0=180Hz, gain=4; simulator conditions, not observed execution',
        'claim':'Conditional research hypotheses. No identified anatomy, microphone/room calibration, muscle tension or tissue mechanics.'}
    write_json(output/'protocol.json',protocol)
    eligible=[]
    for trial in data['fit_trial_options']:
        m=trial['measurement'];values={x['name']:x['value'] for x in m['measurements']}
        if all(values.get(k) is not None for k in FEATURES) and values['periodicity']>=.85 and values['dbfs']>-60 and 65<=values['pitchHz']<=1000 and not set(m['quality']['flags']) & {'clipping','invalid','low-snr'}:
            eligible.append(trial)
    trials=eligible[:2]
    if len(trials)<2: raise ValueError('No two eligible voice windows; import retained, no fitting performed')
    document={'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':trials}
    write_json(output/'observations.json',document)
    nuisance=[{'profile_id':f'gain-{gain:g}','trials':{t['id']:{'JA':-3.,'f0_hz':next(x['value'] for x in t['measurement']['measurements'] if x['name']=='pitchHz'),'gain':gain} for t in trials}} for gain in protocol['gains']]
    jobs=[]
    def command(action,**fields):
        state=backend.execute({'action':'state'})['state']
        return backend.execute({'action':action,'command_id':f'{output.name}-{action}-{state["version"]}',
            'expected_version':state['version'],**fields})['state']
    def session_job(action,parameters):
        state=command(action,parameters=parameters);pending=state['pending']
        if pending is None: raise RuntimeError('Session job submission failed; session ledger retained')
        ident=pending['job_id'];receipt=wait(backend,ident)
        state=command('collect_job',job_id=ident)
        jobs.append({'id':ident,'operation':pending['request']['operation'],'status':receipt['status']})
        write_json(output/'session-ledger.json',backend.execute({'action':'replay'}))
        if receipt['status']!='succeeded': raise RuntimeError(f'{action}: {receipt.get("error")}')
        return state,state['jobs'][-1]['result']
    if backend.execute({'action':'state'})['state']['version']!=0:
        raise ValueError('Live calibration requires a new session; existing ledger is preserved')
    command('ingest_calibration',document=document)
    state,fit=session_job('search',{'anatomy_bounds':protocol['anatomy_bounds'],'nuisance_profiles':nuisance,
        'max_synthesis_calls':36,'rounds':1,'seed':7})
    write_json(output/'fit.json',fit)
    best=fit['joint']['best']
    if best is None or state['snapshot'] is None: raise ValueError('No scorable candidate; attempted hypotheses retained')
    snapshot=state['snapshot'];write_json(output/'hypotheses.json',snapshot)
    rate=trials[0]['sample_rate_hz']
    forecast_profile={'sample_rate_hz':rate,'frame_start_sample':round(rate*.1),
                      'frame_size':trials[0]['frame_size'],'duration_s':.25}
    state,forecast=session_job('propose_design',{'profile':forecast_profile,'design_id':'prospective-'+output.name,'target_observation_id':'future-voice-'+output.name,
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
        forward_id=backend.submit(request,output.name+'-'+key);receipt=wait(backend,forward_id)
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
        'fitDiscrepancy':best['weighted_mean_square_discrepancy'],
        'baselineDiscrepancy':baseline['weighted_mean_square_discrepancy'] if baseline else None,
        'forecast':forecast,'files':files,'anatomyValidated':False,'liveTongueSource':'camera tracking, not scientific-model inference',
        'interpretation':protocol['claim'],'geometryRole':'Native prediction at a declared a/JA=-3 pose; not a measured patient mesh',
        'forecastRole':'Committed prospective simulator predictions; no later human target scored yet'}
    return summary


def run(source,output,*,development_fixture=False):
    output.mkdir(parents=True,exist_ok=False,mode=0o700)
    session_id='live-'+hashlib.sha256(str(output.resolve()).encode()).hexdigest()[:24]
    args=['node','--experimental-strip-types',str(ROOT/'science/scripts/import_native_pcm.ts'),str(source),str(output/'import'),'local-participant',session_id,'a']
    if development_fixture: args.append('--development-fixture')
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
    data=json.loads((output/'import/native-pcm.json').read_text())
    with backend_for(output,session_id) as backend:
        try: summary=pipeline(data,output,backend,session_id)
        finally:
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
    p.add_argument('--development-fixture',action='store_true');a=p.parse_args()
    try: run(a.source.resolve(),a.output.resolve(),development_fixture=a.development_fixture)
    except Exception as e:
        if a.output.exists():write_json(a.output/'failure.json',{'status':'failed','error':str(e),'time':now()})
        raise
