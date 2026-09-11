"""Finite prescribed and native mechanical source/tract experiments; no contact inference."""
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

from .engine import Engine, finite, BUILD, digest, speaker_source_selection
from .pcm_inverse import resample_native_pcm

ROOT=Path(__file__).resolve().parents[3]
SOURCE_VERSION='vtl-finite-geometric-two-mass-v2'
SOURCE_FAMILIES={'geometric':'Geometric glottis','two_mass':'Two-mass model'}
SHARED_BOUNDS={'F0':[65.,600.],'PR':[4000.,12000.]}
SHAPE_BOUNDS={'geometric':{'PS':[-.3,.3]},'two_mass':{'XB':[-.01,.06],'XT':[-.01,.06],'EAA':[0.,.05],'DF':[.6,1.6]}}
FIXED_SOURCE={'geometric':{'PS':0.},'two_mass':{'XB':.01,'XT':.01,'EAA':0.,'DF':1.}}
FIXED_NATIVE={'geometric':{'FL':0.,'DP':0.,'AS':-40.},'two_mass':{}}


def _hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def adapter_dependencies():
    return {name:digest(Path(__file__).with_name(name)) for name in ('engine.py','pcm_inverse.py')}


def source_capability(engine):
    """Per-family native control audit; the certified speaker must select the geometric glottis."""
    raw=(BUILD/'source/resources/JD3.speaker').read_bytes()
    selection=speaker_source_selection(raw);certified=[name for name,selected in selection if selected]
    reason=None
    if hashlib.sha256(raw).hexdigest()!=engine.provenance['speaker_sha256'] or certified!=[SOURCE_FAMILIES['geometric']] or engine.certified_source_family!=certified[0]:
        reason='unsupported_source_family: certified speaker must select Geometric glottis'
    elif not set(SOURCE_FAMILIES.values())<={name for name,_ in selection}:
        reason='unsupported_source_family: native speaker lacks a required glottis model'
    families={}
    if reason is None:
        models={model.get('type'):model for model in ET.fromstring(raw).iter('glottis_model')}
        for identity,native_name in SOURCE_FAMILIES.items():
            with engine.source_model(native_name):
                info={row['name']:row for row in engine.source_info}
                bounds=SHARED_BOUNDS|SHAPE_BOUNDS[identity]
                required=bounds|{name:[value,value] for name,value in FIXED_NATIVE[identity].items()}
                missing=[name for name,limits in required.items() if name not in info or info[name]['min']>limits[0] or info[name]['max']<limits[1]]
                families[identity]={'status':'unsupported' if missing else 'available','missing_native_controls':missing,'native_family':native_name,
                    'source_hypothesis_parameters':list(SHAPE_BOUNDS[identity]),'supported_control_bounds':deepcopy(bounds),
                    'fixed_native_controls':dict(FIXED_NATIVE[identity]),'fixed_source_reference':dict(FIXED_SOURCE[identity]),
                    'native_controls':deepcopy(engine.source_info),'native_controls_sha256':_hash(engine.source_info),
                    'native_provenance':deepcopy(engine.provenance),
                    'fixed_speaker_static_parameters':[{'name':p.get('name'),'unit':p.get('unit'),'value':float(p.get('neutral'))}
                        for p in models[native_name].findall('./static_params/param')]}
        missing=[f'{identity}:{name}' for identity,row in families.items() for name in row['missing_native_controls']]
        if missing:reason='unsupported_native_controls:'+','.join(missing)
    return {'status':'unsupported' if reason else 'available','reason':reason,
        'source_model_version':SOURCE_VERSION,'source_adapter_sha256':digest(Path(__file__)),
        'source_adapter_dependencies':adapter_dependencies(),'certified_source_family':certified,
        'source_families':families,'native_provenance':deepcopy(engine.provenance),
        'closure_contact_inference':False,'tissue_parameters_identified':False,
        'mechanical_scope':'Two coupled native masses, springs, damping and aerodynamic interaction; certified template tissue constants remain fixed'}


def synthesize_phonation(engine, *, pose, JA, F0, PR, PS=None, source_model='geometric',
                         XB=None,XT=None,EAA=None,DF=None,duration_s=.25):
    """Run the chosen native source and tract solver with a 25 ms pressure ramp.

    Each family requires exactly its own shape controls: PS for the geometric
    glottis; XB, XT, EAA and DF for the two-mass model.
    """
    if source_model not in SOURCE_FAMILIES:raise ValueError('Unsupported source model')
    given={'PS':PS,'XB':XB,'XT':XT,'EAA':EAA,'DF':DF}
    if any(given[name] is None for name in SHAPE_BOUNDS[source_model]) or any(value is not None for name,value in given.items() if name not in SHAPE_BOUNDS[source_model]):
        raise ValueError('Declare exactly the '+source_model+' source shape controls: '+','.join(SHAPE_BOUNDS[source_model]))
    declared=_controls({'source_model':source_model,'JA':JA,'F0':F0,'PR':PR,'gain':1.,**{name:given[name] for name in SHAPE_BOUNDS[source_model]}})
    duration=finite(duration_s,'duration_s')
    if not .1<=duration<=1:raise ValueError('Unsupported phonation duration')
    with engine.source_model(SOURCE_FAMILIES[source_model]):
        params,articulation=engine.pose(pose,{'JA':declared['JA']})
        info={row['name']:row for row in engine.source_info}
        values={name:row['default'] for name,row in info.items()}
        controls={name:value for name,value in declared.items() if name not in ('JA','gain','source_model')}|FIXED_NATIVE[source_model]
        for name,value in controls.items():
            if name not in info or not info[name]['min']<=value<=info[name]['max']:
                raise ValueError('Source control outside native bounds: '+name)
        values.update(controls)
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
        if not np.isfinite(audio).all() or not np.any(audio):raise RuntimeError('Nonfinite or silent native source output')
        state={'source_model_version':SOURCE_VERSION,'source_model':source_model,'source_controls':values,
            'native_provenance':deepcopy(engine.provenance),'articulation':articulation,
            'source_values_are':'requested native simulator controls, not measured physiology or vocal-fold contact'}
    return audio,state


def _synthesize_control(engine,pose,control):
    return synthesize_phonation(engine,pose=pose,**{key:value for key,value in control.items() if key!='gain'})


def _family(control):
    return control.get('source_model','geometric')


def _source_shape(control):
    return {key:control[key] for key in SHAPE_BOUNDS[_family(control)]}|({'source_model':control['source_model']} if 'source_model' in control else {})


def _fixed_source(control):
    return {**control,**FIXED_SOURCE[_family(control)]}


def _by_family(items,family_of):
    """Stable grouping so a native family is selected once per group, not per call."""
    return [(family,[item for item in items if family_of(item)==family]) for family in SOURCE_FAMILIES if any(family_of(item)==family for item in items)]


def _f0(control,record):
    """Requested native F0 control and the pitch the same extractor measured in the simulated frame."""
    return {'requested_f0_hz':control['F0'],'simulated_f0_hz':record['descriptors']['pitchHz']['value'] if record else None}


def _status(status,reason):
    return {'status':status,'reason':reason,'baseline_preserved':True,'closure_contact_inference':False,
            'source_model_version':SOURCE_VERSION,'evidence_at':datetime.now(timezone.utc).isoformat()}


def _controls(value):
    if not isinstance(value,dict):raise ValueError('Declare native source controls for every trial')
    family=_family(value)
    if not isinstance(family,str) or family not in SOURCE_FAMILIES:raise ValueError('Unsupported source model')
    shape=SHAPE_BOUNDS[family]
    keys={'JA','F0','PR','gain'}|set(shape)|({'source_model'} if 'source_model' in value else set())
    if set(value)!=keys:raise ValueError('Declare exactly the selected family source controls for every trial')
    result={name:finite(v,name) for name,v in value.items() if name!='source_model'}
    for name,limits in {**shape,**SHARED_BOUNDS,'JA':[-5.,-1.],'gain':[.001,100.]}.items():
        if not limits[0]<=result[name]<=limits[1]:raise ValueError('Control outside supported bounds: '+name)
    if 'source_model' in value:result['source_model']=family
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
SECONDARY_SCORE='score_excluding_pitch: the primary mean over the same terms without pitchHz; reported beside the primary score, never used to select the primary ranking'


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


def _scores(predicted,observed):
    """Primary discrepancy over all features, and the same terms without pitchHz.

    Requested F0 is a tension control for the two-mass model, not a pitch
    target, so its pitch term mixes F0-control mapping into shape comparisons.
    Both scores need the same four descriptors, so availability is identical.
    """
    left,right=_features(predicted),_features(observed)
    if left is None or right is None:return None,None
    terms={name:((left[name]-right[name])/scale)**2 for name,(_,scale) in FEATURES.items()}
    return sum(terms.values())/len(terms),sum(value for name,value in terms.items() if name!='pitchHz')/(len(terms)-1)


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
    if not isinstance(choices,list) or not 1<=len(choices)<=16:raise ValueError('Require 1–16 finite phonation candidates')
    names=set()
    for candidate in choices:
        if not isinstance(candidate,dict) or set(candidate)!={'candidate_id','anatomy','trials'} or not isinstance(candidate['candidate_id'],str) or candidate['candidate_id'] in names or not isinstance(candidate['anatomy'],dict) or set(candidate['trials'])!=ids:
            raise ValueError('Invalid candidate identity or coverage')
        names.add(candidate['candidate_id'])
        trial_controls=[_controls(value) for value in candidate['trials'].values()]
        if len({_hash({**_source_shape(control),'source_model':_family(control)}) for control in trial_controls})!=1:
            raise ValueError('A source hypothesis must retain one family and shape across calibration trials')
    required=3*len(choices)*len(observations)
    if required>max_synthesis_calls:raise ValueError('Equal three-family comparison exceeds synthesis budget')
    signature=extractor_signature();saved=engine.anatomy();calls=0
    result={family:{'candidates':[],'actual_synthesis_calls':0} for family in ('joint','fixed_source','fixed_anatomy')}
    if any(_features(record) is None for record in observations):
        return {**_status('insufficient-quality','Required observed phonation descriptors unavailable'),
                'observations':observations,'actual_synthesis_calls':0,'extractor_signature':signature}
    order={candidate['candidate_id']:i for i,candidate in enumerate(choices)}
    try:
        for candidate in choices:engine.set_anatomy(candidate['anatomy'])
        for source_family,group in _by_family(choices,lambda candidate:_family(next(iter(candidate['trials'].values())))):
            if expired():  # checked before the native family reload, which a checkpoint cannot interrupt
                return {**_status('timed-out','Optional source fit cancelled or expired'),'actual_synthesis_calls':calls,'partial_comparisons':result}
            with engine.source_model(SOURCE_FAMILIES[source_family]):
                for family,output in result.items():
                    for candidate in group:
                        engine.set_anatomy({} if family=='fixed_anatomy' else candidate['anatomy'])
                        predictions=[];scores=[];pitchless=[];failures=[]
                        for trial,observed in zip(doc['trials'],observations):
                            control=_controls(candidate['trials'][trial['id']])
                            if family=='fixed_source':control=_fixed_source(control)
                            if expired():
                                return {**_status('timed-out','Optional source fit cancelled or expired'),'actual_synthesis_calls':calls,'partial_comparisons':result}
                            if calls>=max_synthesis_calls:raise RuntimeError('Hard phonation synthesis budget exhausted')
                            calls+=1;output['actual_synthesis_calls']+=1
                            try:
                                audio,state=_synthesize_control(engine,trial['pose'],control)
                                frame,resampling=_frame(audio,trial['sample_rate_hz']);frame=frame*control['gain']
                                sha=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
                                predicted=measure_phonation(frame,trial['sample_rate_hz'],_metadata(candidate['candidate_id']+':'+trial['id'],trial['sample_rate_hz'],sha,'engine-generated'))
                                score,without_pitch=_scores(predicted,observed)
                                predictions.append({'trial_id':trial['id'],'record':predicted,'controls':control,'native_state':state,'resampling':resampling,
                                    'score':score,'score_excluding_pitch':without_pitch,**_f0(control,predicted)})
                                if score is None:failures.append({'trial_id':trial['id'],'reason':'required_predicted_descriptor_missing'})
                                else:scores.append(score);pitchless.append(without_pitch)
                            except (ValueError,RuntimeError,subprocess.TimeoutExpired) as exc:
                                failures.append({'trial_id':trial['id'],'reason':str(exc)})
                        output['candidates'].append({'candidate_id':candidate['candidate_id'],'source_model':source_family,'anatomy':engine.anatomy(),
                            'status':'scored' if not failures else 'unscorable','score':float(np.mean(scores)) if scores and not failures else None,
                            'score_excluding_pitch':float(np.mean(pitchless)) if pitchless and not failures else None,
                            'predictions':predictions,'failures':failures})
        for output in result.values():
            output['candidates'].sort(key=lambda row:order[row['candidate_id']])
            scored=[row for row in output['candidates'] if row['status']=='scored']
            output['best']=min(scored,key=lambda row:(row['score'],row['candidate_id'])) if scored else None
        if signature!=extractor_signature():raise RuntimeError('Extractor changed during optional fit')
    finally:engine.set_anatomy(saved)
    return {**_status('available' if result['joint']['best'] else 'failed','Conditional source/tract candidate comparison'),
        'kind':'phonation-source-tract-fit-1',**result,'capability':capability,'actual_synthesis_calls':calls,
        'max_synthesis_calls':max_synthesis_calls,'observations':observations,'evidence_ids':sorted(ids),
        'evidence_frame_hashes':sorted(hashes),'document_sha256':_hash(doc),'candidate_sha256':_hash(choices),
        'extractor_signature':signature,'feature_scales':FEATURES,'identifiability':'not_established',
        'fixed_source_definition':{'rule':'Within-family native reference; same anatomy and nuisance support','references':deepcopy(FIXED_SOURCE)},
        'fixed_anatomy_definition':'template anatomy; same finite native source family/shape and nuisance support',
        'score_interpretation':'Mean standardized acoustic descriptor discrepancy, not posterior probability',
        'secondary_score':SECONDARY_SCORE}


def _score_policy(version):
    return {'version':version,'features':deepcopy(FEATURES),'secondary_score':SECONDARY_SCORE,'source_model_version':SOURCE_VERSION,
        'source_adapter_sha256':digest(Path(__file__)),'source_adapter_dependencies':adapter_dependencies()}


def forecast_phonation(engine,fit_result,*,family,candidate_id,reference_trial_id,pose,controls,target_id):
    """One prospective conditional prediction using the fitted native source shape."""
    fitted=deepcopy(fit_result)
    if fitted.get('status')!='available' or fitted.get('kind')!='phonation-source-tract-fit-1':raise ValueError('Available completed source fit required')
    if family not in ('joint','fixed_source','fixed_anatomy'):raise ValueError('Unsupported comparison family')
    if fitted['extractor_signature']!=extractor_signature() or fitted['capability']!=source_capability(engine):raise ValueError('Frozen source/extractor capability changed')
    rows=[r for r in fitted[family]['candidates'] if r['candidate_id']==candidate_id and r['status']=='scored']
    if len(rows)!=1:raise ValueError('Requested candidate is not scorable')
    refs=[p for p in rows[0]['predictions'] if p['trial_id']==reference_trial_id]
    if len(refs)!=1 or not isinstance(controls,dict) or set(controls)!={'JA','F0','PR','gain'}:raise ValueError('Declare known heldout controls and fitted source reference')
    if not isinstance(target_id,str) or not target_id or target_id in fitted['evidence_ids']:raise ValueError('Fresh heldout target required')
    control=_controls({**controls,**_source_shape(refs[0]['controls'])});saved=engine.anatomy()
    try:
        engine.set_anatomy(rows[0]['anatomy'])
        audio,native=_synthesize_control(engine,pose,control)
        rate=refs[0]['record']['window']['sampleRateHz']
        frame,conversion=_frame(audio,rate);frame=frame*control['gain']
        sha=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
        record=measure_phonation(frame,rate,_metadata('forecast:'+target_id,rate,sha,'engine-generated'))
    finally:engine.set_anatomy(saved)
    result={'kind':'frozen-phonation-forecast-1','fit_sha256':_hash(fitted),'family':family,'candidate_id':candidate_id,
        'target_id':target_id,'reference_trial_id':reference_trial_id,'pose':pose,'record':record,'controls':control,
        'native_state':native,'anatomy':rows[0]['anatomy'],'extractor_signature':fitted['extractor_signature'],
        'excluded_frame_hashes':fitted['evidence_frame_hashes'],'sealed_at':datetime.now(timezone.utc).isoformat(),
        'scoring_policy':_score_policy('phonation-score-1'),**_f0(control,record),
        'actual_synthesis_calls':1,'status':'available' if _features(record) is not None else 'insufficient-quality',
        'scope':'Known executed control assumption; raw acoustic slope is not glottal tilt or contact'}
    return {'forecast':result,'sha256':_hash(result)}


def score_phonation_forecast(frozen,pcm,metadata):
    if not isinstance(frozen,dict) or set(frozen)!={'forecast','sha256'} or _hash(frozen['forecast'])!=frozen['sha256']:
        raise ValueError('Frozen phonation forecast hash mismatch')
    forecast=frozen['forecast']
    if _hash(forecast.get('scoring_policy'))!=_hash(_score_policy('phonation-score-1')):
        return {**_status('unsupported','Frozen source scoring policy unavailable or changed'),'score':None,'score_excluding_pitch':None,'model_updated':False}
    if forecast.get('kind')!='frozen-phonation-forecast-1' or metadata.get('observationId')!=forecast['target_id']:raise ValueError('Wrong heldout target')
    observed_at=datetime.fromisoformat(metadata['evidenceAt'])
    if observed_at.tzinfo is None or not datetime.fromisoformat(forecast['sealed_at'])<observed_at<=datetime.now(timezone.utc):raise ValueError('Heldout observation must follow forecast')
    try:
        compatible=extractor_signature()==forecast['extractor_signature']
    except OSError:
        compatible=False
    if not compatible:
        return {**_status('unsupported','Frozen extractor unavailable or changed'),'model_updated':False,'score':None,'score_excluding_pitch':None}
    window=forecast['record']['window']
    if metadata.get('windowStartSample')!=window['startSample'] or len(pcm)!=window['sampleCount']:
        raise ValueError('Source scoring frame differs from frozen native profile')
    observed=measure_phonation(pcm,window['sampleRateHz'],metadata)
    if observed['frameSha256'] in forecast['excluded_frame_hashes']:raise ValueError('Calibration frame reused as heldout')
    score,without_pitch=_scores(forecast['record'],observed)
    return {**_status('available' if score is not None else 'insufficient-quality','Conditional heldout discrepancy'),
        'score':score,'score_excluding_pitch':without_pitch,'requested_f0_hz':forecast.get('requested_f0_hz'),'simulated_f0_hz':forecast.get('simulated_f0_hz'),
        'forecast_sha256':frozen['sha256'],'observation':observed,'model_updated':False}


def _bank_policy():
    return {**_score_policy('phonation-bank-score-1'),
        'ranking':'dense ranks over available discrepancies only; unavailable alternatives retained',
        'model_update':'none; conditional acoustic ranking is not a posterior or closure measurement'}


def forecast_phonation_bank(engine,fit_result,*,reference_trial_id,pose,controls,target_id,
                            max_synthesis_calls=48,timeout_s=120.,cancelled=None):
    """Freeze every retained family/candidate under one shared prospective task."""
    fitted=deepcopy(fit_result)
    if fitted.get('status')!='available' or fitted.get('kind')!='phonation-source-tract-fit-1':
        raise ValueError('Available completed source fit required')
    if type(max_synthesis_calls) is not int or not 1<=max_synthesis_calls<=48:
        raise ValueError('Bank synthesis budget must be 1–48')
    timeout_s=finite(timeout_s,'timeout_s')
    if not 0<timeout_s<=120:raise ValueError('Bank deadline must be 0–120 seconds')
    if not isinstance(controls,dict) or set(controls)!={'JA','F0','PR','gain'}:
        raise ValueError('Bank requires shared declared JA/F0/PR/gain controls')
    _controls({**controls,**FIXED_SOURCE['geometric']})
    if pose not in engine.poses:raise ValueError('Unsupported prospective vowel')
    if not isinstance(target_id,str) or not target_id.strip() or target_id in fitted['evidence_ids']:
        raise ValueError('Fresh source bank target required')
    capability=source_capability(engine)
    signature=extractor_signature()
    if signature!=fitted['extractor_signature'] or capability!=fitted['capability']:
        raise ValueError('Frozen source/extractor capability changed')
    observations=[row for row in fitted['observations'] if row['observationId']==reference_trial_id]
    if len(observations)!=1:raise ValueError('One fitted reference observation required')
    window=observations[0]['window'];rate=window['sampleRateHz']
    if rate not in (44100,48000,96000):raise ValueError('Unsupported bank sample rate')
    profile={'sampleRateHz':rate,'startSample':round(.1*rate),'sampleCount':8192 if rate==96000 else 4096}
    rows=[]
    for family in ('joint','fixed_source','fixed_anatomy'):
        candidates=fitted.get(family,{}).get('candidates')
        if not isinstance(candidates,list) or not candidates:raise ValueError('Every comparison family must be represented')
        ids=set()
        for row in candidates:
            identity=row.get('candidate_id')
            if not isinstance(identity,str) or not identity or identity in ids:raise ValueError('Duplicate or invalid bank candidate')
            if row.get('score') is not None:finite(row['score'],'calibration score')
            if row.get('status')=='scored' and row.get('score') is None:raise ValueError('Scored source candidate lacks calibration discrepancy')
            ids.add(identity);rows.append((family,row))
    if not 1<=len(rows)<=48 or sum(row.get('status')=='scored' for _,row in rows)>max_synthesis_calls:
        raise ValueError('Complete source bank exceeds finite synthesis budget')
    saved=engine.anatomy();deadline=time.monotonic()+timeout_s;calls=0;alternatives=[];pending=[]
    for family,row in rows:
        entry={'alternative_id':family+':'+row['candidate_id'],'family':family,'candidate_id':row['candidate_id'],
            'source_model':row.get('source_model'),'calibration_score':row.get('score'),'calibration_score_excluding_pitch':row.get('score_excluding_pitch'),
            'anatomy':deepcopy(row['anatomy']),'record':None,'controls':None,'requested_f0_hz':None,'simulated_f0_hz':None,'status':'unavailable','reason':None}
        alternatives.append(entry)
        if row.get('status')!='scored':entry['reason']='Calibration alternative was unscorable';continue
        refs=[r for r in row.get('predictions',[]) if r['trial_id']==reference_trial_id]
        if len(refs)!=1:entry['reason']='Fitted source reference unavailable';continue
        control=_controls({**controls,**_source_shape(refs[0]['controls'])})
        entry.update(controls=control,source_model=_family(control),requested_f0_hz=control['F0']);pending.append((entry,row))
    def expired():return time.monotonic()>=deadline or cancelled is not None and cancelled.is_set()
    try:
        for source_family,group in _by_family(pending,lambda item:item[0]['source_model']):
            if expired():  # skip the native family reload once the deadline has passed
                for entry,_ in group:entry.update(status='timed-out',reason='Bank deadline or cancellation reached')
                continue
            with engine.source_model(SOURCE_FAMILIES[source_family]):
                for entry,row in group:
                    if expired():
                        entry.update(status='timed-out',reason='Bank deadline or cancellation reached');continue
                    engine.set_anatomy(row['anatomy'])
                    try:
                        calls+=1
                        audio,native=_synthesize_control(engine,pose,entry['controls'])
                        frame,conversion=_frame(audio,rate);frame=frame*entry['controls']['gain']
                        frame_hash=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
                        predicted=measure_phonation(frame,rate,_metadata('bank:'+target_id+':'+entry['alternative_id'],rate,frame_hash,'engine-generated'))
                        usable=_features(predicted) is not None
                        entry.update(record=predicted,native_state=native,resampling=conversion,**_f0(entry['controls'],predicted),
                            status='available' if usable else 'insufficient-quality',reason=None if usable else 'Required predicted descriptor unavailable')
                    except (ValueError,RuntimeError,subprocess.TimeoutExpired) as exc:
                        entry.update(status='failed',reason=str(exc)[:500])
    finally:engine.set_anatomy(saved)
    if signature!=extractor_signature():raise RuntimeError('Extractor changed during source bank generation')
    available=sum(row['status']=='available' for row in alternatives)
    excluded=sorted({h for row in fitted['observations'] for h in row['sourceHashes']})
    result={'kind':'frozen-phonation-bank-1','fit_sha256':_hash(fitted),'target_id':target_id,
        'reference_trial_id':reference_trial_id,'pose':pose,'profile':profile,'shared_controls':deepcopy(controls),
        'alternatives':alternatives,'extractor_signature':signature,'scoring_policy':_bank_policy(),
        'native_provenance':deepcopy(engine.provenance),'source_capability':capability,
        'excluded_frame_hashes':list(fitted['evidence_frame_hashes']),'excluded_artifact_hashes':excluded,
        'sealed_at':datetime.now(timezone.utc).isoformat(),'actual_synthesis_calls':calls,'max_synthesis_calls':max_synthesis_calls,
        'coverage':{'total':len(alternatives),'available':available,'unavailable':len(alternatives)-available,'complete':available==len(alternatives)},
        'status':'available' if available else 'insufficient-quality',
        'scope':'Competing conditional source/tract predictions; shared control assumptions are not verified human execution, anatomical identification or vocal-fold contact'}
    return {'forecast':result,'sha256':_hash(result)}


def score_phonation_bank(frozen,pcm,metadata):
    """Extract one original held-out frame and compare every frozen alternative."""
    if not isinstance(frozen,dict) or set(frozen)!={'forecast','sha256'} or _hash(frozen['forecast'])!=frozen['sha256']:
        raise ValueError('Frozen source bank hash mismatch')
    bank=frozen['forecast']
    if bank.get('kind')!='frozen-phonation-bank-1' or metadata.get('observationId')!=bank.get('target_id'):
        raise ValueError('Wrong source bank target')
    rows=bank.get('alternatives')
    if not isinstance(rows,list) or not 1<=len(rows)<=48 or len({r['alternative_id'] for r in rows})!=len(rows):
        raise ValueError('Invalid source bank coverage')
    observed_at=datetime.fromisoformat(metadata['evidenceAt']);sealed=datetime.fromisoformat(bank['sealed_at'])
    if observed_at.tzinfo is None or sealed.tzinfo is None or not sealed<observed_at<=datetime.now(timezone.utc):
        raise ValueError('Heldout observation must follow source bank commitment')
    profile=bank['profile']
    if metadata.get('windowStartSample')!=profile['startSample'] or len(pcm)!=profile['sampleCount']:
        raise ValueError('Source scoring frame differs from frozen bank profile')
    if set(metadata.get('sourceHashes',[])) & set(bank['excluded_artifact_hashes']):
        raise ValueError('Calibration artifact reused as heldout bank evidence')
    reason=None
    try:
        if _hash(bank['scoring_policy'])!=_hash(_bank_policy()) or bank['extractor_signature']!=extractor_signature():
            reason='Frozen source bank scoring capability changed'
    except OSError:reason='Frozen source bank extractor unavailable'
    observed=None
    if reason is None:
        observed=measure_phonation(pcm,profile['sampleRateHz'],metadata)
        if observed['frameSha256'] in bank['excluded_frame_hashes']:raise ValueError('Calibration frame reused as heldout bank evidence')
    alternatives=[]
    for row in rows:
        score=without_pitch=None;unavailable=reason or row.get('reason')
        if reason is None and row['status']=='available' and row['record'] is not None:
            score,without_pitch=_scores(row['record'],observed)
            if score is None:unavailable='Required observed or predicted descriptor unavailable'
        alternatives.append({key:row[key] for key in ('alternative_id','family','candidate_id','calibration_score')}|
            {key:row.get(key) for key in ('calibration_score_excluding_pitch','source_model','requested_f0_hz','simulated_f0_hz')}|
            {'score':score,'score_excluding_pitch':without_pitch,'status':'scored' if score is not None else 'unavailable','reason':None if score is not None else unavailable or 'Frozen prediction unavailable',
             'calibration_rank':None,'heldout_rank':None,'heldout_rank_excluding_pitch':None,'rank_change':None})
    for field,rank in (('calibration_score','calibration_rank'),('score','heldout_rank'),('score_excluding_pitch','heldout_rank_excluding_pitch')):
        unique=sorted({r[field] for r in alternatives if r[field] is not None})
        for row in alternatives:
            if row[field] is not None:row[rank]=unique.index(row[field])+1
    complete=all(row['heldout_rank'] is not None and row['calibration_rank'] is not None for row in alternatives)
    for row in alternatives:
        if complete:
            row['rank_change']=row['calibration_rank']-row['heldout_rank']
    ranked=sorted((row for row in alternatives if row['score'] is not None),key=lambda r:(r['score'],r['alternative_id']))
    return {**_status('unsupported' if reason else 'available' if ranked else 'insufficient-quality',reason or 'Conditional heldout bank discrepancies'),
        'kind':'phonation-bank-score-1','forecast_sha256':frozen['sha256'],'alternatives':alternatives,
        'ranking':[row['alternative_id'] for row in ranked],'observation':observed,'model_updated':False,
        'actual_synthesis_calls':0,'canonical_extractions':int(observed is not None),
        'coverage':{'total':len(alternatives),'scored':len(ranked),'unavailable':len(alternatives)-len(ranked),'complete':len(ranked)==len(alternatives)},
        'rank_change_comparison_ids':[row['alternative_id'] for row in alternatives] if complete else [],
        'rank_change_reason':None if complete else 'Rank changes unavailable because calibration and heldout comparison coverage differs',
        'ranking_interpretation':'Dense discrepancy ranks among available alternatives only; incomplete coverage is not a full-bank winner or calibrated posterior'}
