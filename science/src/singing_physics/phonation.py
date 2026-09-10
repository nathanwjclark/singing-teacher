"""Optional conditional geometric-glottis source/tract experiments; no contact inference."""
from copy import deepcopy
from datetime import datetime, timezone
import ctypes as ct
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

import numpy as np

from .engine import Engine, finite, BUILD, digest
from .pcm_inverse import resample_native_pcm

ROOT=Path(__file__).resolve().parents[3]
SOURCE_VERSION='vtl-geometric-pulse-skew-v1'
BOUNDS={'PS':[-.3,.3],'F0':[65.,600.],'PR':[4000.,12000.]}
FIXED={'FL':0.,'DP':0.,'AS':-40.}


def _hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def source_capability(engine):
    info={row['name']:row for row in engine.source_info}
    required={**{name:limits for name,limits in BOUNDS.items()},**{name:[value,value] for name,value in FIXED.items()}}
    speaker=BUILD/'source/resources/JD3.speaker'
    selected=[row.attrib.get('type') for row in ET.parse(speaker).getroot().iter('glottis_model') if row.attrib.get('selected')=='1']
    family_valid=selected==['Geometric glottis'] and digest(speaker)==engine.provenance['speaker_sha256']
    missing=[name for name,limits in required.items() if name not in info or info[name]['min']>limits[0] or info[name]['max']<limits[1]]
    return {'status':'unsupported' if missing or not family_valid else 'available','reason':('unsupported_source_family' if not family_valid else 'unsupported_native_controls:'+','.join(missing)) if missing or not family_valid else None,
        'source_model_version':SOURCE_VERSION,'source_model_family':'prescribed geometric glottis',
        'native_controls':deepcopy(engine.source_info),'native_controls_sha256':_hash(engine.source_info),
        'supported_control_bounds':deepcopy(BOUNDS),'source_hypothesis_parameter':'PS','fixed_controls':dict(FIXED),'native_provenance':deepcopy(engine.provenance),
        'closure_contact_inference':False}


def synthesize_phonation(engine, *, pose, JA, F0, PR, PS, duration_s=.25):
    """Prescribed source controls, solver reset and 25ms pressure ramp per trial."""
    capability=source_capability(engine)
    if capability['status']!='available': raise ValueError(capability['reason'])
    controls={name:finite(value,name) for name,value in {'F0':F0,'PR':PR,'PS':PS}.items()}
    for name,value in controls.items():
        if not BOUNDS[name][0]<=value<=BOUNDS[name][1]: raise ValueError('Source control outside declared bounds: '+name)
    ja=finite(JA,'JA');duration=finite(duration_s,'duration_s')
    if not -5<=ja<=-1 or not .1<=duration<=1: raise ValueError('Unsupported articulation or phonation duration')
    params,articulation=engine.pose(pose,{'JA':ja})
    values={row['name']:row['default'] for row in engine.source_info};values.update(FIXED);values.update(controls)
    source=(ct.c_double*engine.glottis_count)(*(values[row['name']] for row in engine.source_info))
    index={row['name']:i for i,row in enumerate(engine.source_info)}
    count=round(duration*engine.sample_rate);ramp=round(.025*engine.sample_rate)
    engine._check(engine.lib.vtlSynthesisReset(),'phonation synthesis reset')
    source[index['PR']]=0;empty=(ct.c_double*1)()
    engine._check(engine.lib.vtlSynthesisAddTract(0,empty,params,source),'phonation initialize')
    source[index['PR']]=PR
    attack=(ct.c_double*ramp)();sustain=(ct.c_double*(count-ramp))()
    engine._check(engine.lib.vtlSynthesisAddTract(ramp,attack,params,source),'phonation attack')
    engine._check(engine.lib.vtlSynthesisAddTract(count-ramp,sustain,params,source),'phonation sustain')
    audio=np.concatenate([np.array(attack),np.array(sustain)])
    if not np.isfinite(audio).all() or not np.any(audio): raise RuntimeError('Nonfinite or silent prescribed source output')
    return audio,{'source_model_version':SOURCE_VERSION,'source_controls':values,'articulation':articulation,
                  'source_values_are':'requested prescribed simulator controls, not measured physiology'}


def _status(status,reason):
    return {'status':status,'reason':reason,'baseline_preserved':True,'closure_contact_inference':False,
            'source_model_version':SOURCE_VERSION,'evidence_at':datetime.now(timezone.utc).isoformat()}


def _controls(value):
    if not isinstance(value,dict) or set(value)!={'JA','F0','PR','PS','gain'}:
        raise ValueError('Declare JA/F0/PR/PS/gain for every trial')
    result={name:finite(v,name) for name,v in value.items()}
    for name,limits in {**BOUNDS,'JA':[-5.,-1.],'gain':[.001,100.]}.items():
        if not limits[0]<=result[name]<=limits[1]: raise ValueError('Control outside supported bounds: '+name)
    return result


def _frame(audio,rate):
    native,resampling=resample_native_pcm(audio,44100,rate)
    size={44100:4096,48000:4096,96000:8192}[rate];start=round(.1*rate)
    return native[start:start+size],resampling


def _metadata(identity,rate,source_hash,source_kind):
    return {'observationId':identity,'sessionId':'phonation-scientific-analysis','attemptId':identity,
        'artifactId':identity+'-audio','sourceHashes':[source_hash],
        'evidenceAt':datetime.now(timezone.utc).isoformat(),'windowStartSample':round(.1*rate),
        'clockId':identity+'-sample-clock','syncUncertaintyMs':0.,'sourceKind':source_kind,
        'processing':{'automaticGainControl':False,'noiseSuppression':False,'echoCancellation':False}}


FEATURES={'pitchHz':('Hz',20.),'periodicity':('1',.1),'spectralFlatness':('1',.1),
          'harmonicSpectralSlopeDbOctave':('dB/octave',3.)}


def extractor_signature():
    paths=['science/scripts/phonation_bridge.ts','src/phonation/measure.ts','src/phonation/types.ts','src/lib/audio.ts']
    paths += [str(path.relative_to(ROOT)) for path in sorted((ROOT/'src/contracts').glob('*.ts'))]
    return {name:digest(ROOT/name) for name in paths}


def measure_phonation(pcm,sample_rate_hz,metadata):
    node=shutil.which('node')
    if not node: raise RuntimeError('Optional canonical phonation extraction requires Node')
    values=np.asarray(pcm,dtype=np.float32)
    if values.ndim!=1 or len(values)>8192 or not np.isfinite(values).all(): raise ValueError('Invalid phonation frame')
    completed=subprocess.run([node,'--experimental-strip-types',str(ROOT/'science/scripts/phonation_bridge.ts')],
        input=json.dumps({'pcm':values.tolist(),'sampleRate':sample_rate_hz,'metadata':metadata},allow_nan=False),
        capture_output=True,text=True,timeout=15)
    if completed.returncode: raise ValueError('Canonical phonation extraction rejected frame: '+completed.stderr[-500:])
    return json.loads(completed.stdout)


def _features(record):
    if record.get('schemaVersion')!='phonation-observation-1.0.0': raise ValueError('Unsupported phonation schema')
    if record['capabilities']['measurement']['status']!='available': return None
    result={}
    for name,(unit,_) in FEATURES.items():
        descriptor=record['descriptors'][name]
        if descriptor['value'] is None or descriptor['reason'] is not None: return None
        if descriptor['unit']!=unit: raise ValueError('Phonation descriptor unit mismatch')
        result[name]=finite(descriptor['value'],name)
    return result


def _score(predicted,observed):
    left,right=_features(predicted),_features(observed)
    if left is None or right is None:return None
    return sum(((left[name]-right[name])/scale)**2 for name,(_,scale) in FEATURES.items())/len(FEATURES)


def fit_phonation(engine,document,*,candidates,max_synthesis_calls=96,enabled=False,timeout_s=60.,cancelled=None):
    """Rank bounded source/tract alternatives without changing the baseline model."""
    if not enabled:return _status('disabled','Optional source inference is disabled')
    timeout_s=finite(timeout_s,'timeout_s')
    if not 0<timeout_s<=120:raise ValueError('Optional analysis deadline must be 0–120 seconds')
    deadline=time.monotonic()+timeout_s
    def expired():return time.monotonic()>=deadline or (cancelled is not None and cancelled.is_set())
    if expired():return _status('timed-out','Optional source fit cancelled or expired')
    try:extractor_signature()
    except OSError:return _status('unsupported','Optional phonation extractor is unavailable')
    capability=source_capability(engine)
    if capability['status']!='available':return _status('unsupported',capability['reason'])
    if type(max_synthesis_calls) is not int or not 1<=max_synthesis_calls<=96: raise ValueError('Invalid phonation synthesis budget')
    doc,choices=deepcopy(document),deepcopy(candidates)
    if not isinstance(doc,dict) or set(doc)!={'schema_version','trials'} or doc['schema_version']!='phonation-fit-1' or not isinstance(doc['trials'],list) or not 1<=len(doc['trials'])<=4:
        raise ValueError('Unsupported calibration phonation document')
    ids=set();hashes=set();observations=[]
    for trial in doc['trials']:
        if not isinstance(trial,dict) or set(trial)!={'id','pose','pcm','sample_rate_hz','metadata'} or not isinstance(trial['id'],str) or not trial['id'] or trial['id'] in ids or trial['pose'] not in engine.poses:
            raise ValueError('Invalid or duplicate calibration trial')
        ids.add(trial['id']);rate=trial['sample_rate_hz']
        if type(rate) is not int or rate not in (44100,48000,96000):raise ValueError('Unsupported phonation sample rate')
        values=np.asarray(trial['pcm'],dtype=np.float32)
        if values.shape!=({44100:4096,48000:4096,96000:8192}[rate],) or not np.isfinite(values).all():raise ValueError('Invalid canonical phonation frame')
        sha=hashlib.sha256(values.astype('<f4').tobytes()).hexdigest()
        if sha in hashes:raise ValueError('Repeated calibration frame')
        hashes.add(sha)
        if expired():return _status('timed-out','Optional source fit cancelled or expired')
        try:record=measure_phonation(values,rate,trial['metadata'])
        except subprocess.TimeoutExpired:return _status('timed-out','Optional observed extraction timed out')
        except RuntimeError as exc:return _status('unsupported',str(exc))
        if record['frameSha256']!=sha:raise ValueError('Canonical phonation frame hash mismatch')
        observations.append(record)
    if not isinstance(choices,list) or not 1<=len(choices)<=8:raise ValueError('Require 1–8 finite phonation candidates')
    names=set()
    for candidate in choices:
        if not isinstance(candidate,dict) or set(candidate)!={'candidate_id','anatomy','trials'} or not isinstance(candidate['candidate_id'],str) or candidate['candidate_id'] in names or not isinstance(candidate['anatomy'],dict) or set(candidate['trials'])!=ids:
            raise ValueError('Invalid candidate identity or coverage')
        names.add(candidate['candidate_id'])
        for value in candidate['trials'].values():_controls(value)
    required=3*len(choices)*len(observations)
    if required>max_synthesis_calls:raise ValueError('Equal three-family comparison exceeds synthesis budget')
    signature=extractor_signature();saved=engine.anatomy();calls=0
    result={family:{'candidates':[],'actual_synthesis_calls':0} for family in ('joint','fixed_source','fixed_anatomy')}
    if any(_features(record) is None for record in observations):
        return {**_status('insufficient-quality','Required observed phonation descriptors unavailable'),
                'observations':observations,'actual_synthesis_calls':0,'extractor_signature':signature}
    try:
        for candidate in choices:engine.set_anatomy(candidate['anatomy'])
        for family,output in result.items():
            for candidate in choices:
                engine.set_anatomy({} if family=='fixed_anatomy' else candidate['anatomy'])
                predictions=[];scores=[];failures=[]
                for trial,observed in zip(doc['trials'],observations):
                    control=_controls(candidate['trials'][trial['id']])
                    if family=='fixed_source':control['PS']=0.
                    if expired():
                        return {**_status('timed-out','Optional source fit cancelled or expired'),'actual_synthesis_calls':calls,'partial_comparisons':result}
                    if calls>=max_synthesis_calls:raise RuntimeError('Hard phonation synthesis budget exhausted')
                    calls+=1;output['actual_synthesis_calls']+=1
                    try:
                        audio,state=synthesize_phonation(engine,pose=trial['pose'],**{k:control[k] for k in ('JA','F0','PR','PS')})
                        frame,resampling=_frame(audio,trial['sample_rate_hz']);frame=frame*control['gain']
                        sha=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
                        predicted=measure_phonation(frame,trial['sample_rate_hz'],_metadata(candidate['candidate_id']+':'+trial['id'],trial['sample_rate_hz'],sha,'engine-generated'))
                        score=_score(predicted,observed)
                        predictions.append({'trial_id':trial['id'],'record':predicted,'controls':control,'native_state':state,'resampling':resampling,'score':score})
                        if score is None:failures.append({'trial_id':trial['id'],'reason':'required_predicted_descriptor_missing'})
                        else:scores.append(score)
                    except (ValueError,RuntimeError,subprocess.TimeoutExpired) as exc:
                        failures.append({'trial_id':trial['id'],'reason':str(exc)})
                output['candidates'].append({'candidate_id':candidate['candidate_id'],'anatomy':engine.anatomy(),
                    'status':'scored' if not failures else 'unscorable','score':float(np.mean(scores)) if scores and not failures else None,
                    'predictions':predictions,'failures':failures})
            scored=[row for row in output['candidates'] if row['status']=='scored']
            output['best']=min(scored,key=lambda row:(row['score'],row['candidate_id'])) if scored else None
        if signature!=extractor_signature():raise RuntimeError('Extractor changed during optional fit')
    finally:engine.set_anatomy(saved)
    return {**_status('available' if result['joint']['best'] else 'failed','Conditional source/tract candidate comparison'),
        'kind':'phonation-source-tract-fit-1',**result,'capability':capability,'actual_synthesis_calls':calls,
        'max_synthesis_calls':max_synthesis_calls,'observations':observations,'evidence_ids':sorted(ids),
        'evidence_frame_hashes':sorted(hashes),'document_sha256':_hash(doc),'candidate_sha256':_hash(choices),
        'extractor_signature':signature,'feature_scales':FEATURES,'identifiability':'not_established',
        'fixed_source_definition':'PS=0; same finite anatomy, JA/F0/PR/gain nuisance support',
        'fixed_anatomy_definition':'template anatomy; same finite PS and nuisance support',
        'score_interpretation':'Mean standardized acoustic descriptor discrepancy, not posterior probability'}


def forecast_phonation(engine,fit_result,*,family,candidate_id,reference_trial_id,pose,controls,target_id):
    """One prospective conditional prediction using the fitted source PS."""
    fitted=deepcopy(fit_result)
    if fitted.get('status')!='available' or fitted.get('kind')!='phonation-source-tract-fit-1':raise ValueError('Available completed source fit required')
    if family not in ('joint','fixed_source','fixed_anatomy'):raise ValueError('Unsupported comparison family')
    if fitted['extractor_signature']!=extractor_signature() or fitted['capability']!=source_capability(engine):raise ValueError('Frozen source/extractor capability changed')
    rows=[r for r in fitted[family]['candidates'] if r['candidate_id']==candidate_id and r['status']=='scored']
    if len(rows)!=1:raise ValueError('Requested candidate is not scorable')
    refs=[p for p in rows[0]['predictions'] if p['trial_id']==reference_trial_id]
    if len(refs)!=1 or not isinstance(controls,dict) or set(controls)!={'JA','F0','PR','gain'}:raise ValueError('Declare known heldout controls and fitted source reference')
    if not isinstance(target_id,str) or not target_id or target_id in fitted['evidence_ids']:raise ValueError('Fresh heldout target required')
    control=_controls({**controls,'PS':refs[0]['controls']['PS']});saved=engine.anatomy()
    try:
        engine.set_anatomy(rows[0]['anatomy'])
        audio,native=synthesize_phonation(engine,pose=pose,**{k:control[k] for k in ('JA','F0','PR','PS')})
        frame,conversion=_frame(audio,44100);frame=frame*control['gain']
        sha=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
        record=measure_phonation(frame,44100,_metadata('forecast:'+target_id,44100,sha,'engine-generated'))
    finally:engine.set_anatomy(saved)
    result={'kind':'frozen-phonation-forecast-1','fit_sha256':_hash(fitted),'family':family,'candidate_id':candidate_id,
        'target_id':target_id,'reference_trial_id':reference_trial_id,'record':record,'controls':control,
        'native_state':native,'anatomy':rows[0]['anatomy'],'extractor_signature':fitted['extractor_signature'],
        'excluded_frame_hashes':fitted['evidence_frame_hashes'],'sealed_at':datetime.now(timezone.utc).isoformat(),
        'actual_synthesis_calls':1,'status':'available' if _features(record) is not None else 'insufficient-quality',
        'scope':'Known executed control assumption; raw acoustic slope is not glottal tilt or contact'}
    return {'forecast':result,'sha256':_hash(result)}


def score_phonation_forecast(frozen,pcm,metadata):
    if not isinstance(frozen,dict) or set(frozen)!={'forecast','sha256'} or _hash(frozen['forecast'])!=frozen['sha256']:
        raise ValueError('Frozen phonation forecast hash mismatch')
    forecast=frozen['forecast']
    if forecast.get('kind')!='frozen-phonation-forecast-1' or metadata.get('observationId')!=forecast['target_id']:raise ValueError('Wrong heldout target')
    observed_at=datetime.fromisoformat(metadata['evidenceAt'])
    if observed_at.tzinfo is None or not datetime.fromisoformat(forecast['sealed_at'])<observed_at<=datetime.now(timezone.utc):raise ValueError('Heldout observation must follow forecast')
    if extractor_signature()!=forecast['extractor_signature']:return _status('unsupported','Frozen extractor unavailable or changed')
    observed=measure_phonation(pcm,44100,metadata)
    if observed['frameSha256'] in forecast['excluded_frame_hashes']:raise ValueError('Calibration frame reused as heldout')
    score=_score(forecast['record'],observed)
    return {**_status('available' if score is not None else 'insufficient-quality','Conditional heldout discrepancy'),
        'score':score,'forecast_sha256':frozen['sha256'],'observation':observed,'model_updated':False}
