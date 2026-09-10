"""Optional source-model session policy; never replaces the baseline anatomy model."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import re


def _now(): return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def _identity(value):
    if not isinstance(value,str) or not 1<=len(value)<=160 or not value.strip():raise ValueError('Invalid source evidence identity')
    return value


def _time(value):
    parsed=datetime.fromisoformat(value)
    if parsed.tzinfo is None:raise ValueError('Source evidence requires timezone timestamp')
    return parsed


def _metadata(value,session_id,*,prospective=False):
    if not isinstance(value,dict) or value.get('sessionId')!=session_id:raise ValueError('Source evidence belongs to another session')
    for name in ('observationId','attemptId','artifactId','clockId'):_identity(value.get(name))
    if value.get('evidenceAt') is None:
        if prospective:raise ValueError('Prospective source evidence requires capture time')
    elif _time(value['evidenceAt'])>_time(_now()):raise ValueError('Future source evidence')
    hashes=value.get('sourceHashes')
    if not isinstance(hashes,list) or not hashes or any(not isinstance(h,str) or not re.fullmatch('[a-f0-9]{64}',h) for h in hashes):
        raise ValueError('Source evidence requires original artifact hashes')


def ensure_fields(state):
    state.setdefault('source_model',None)
    state.setdefault('source_forecasts',{})
    state.setdefault('source_receipts',[])
    state.setdefault('source_status',{'status':'disabled','reason':'Optional source inference has not run','baseline_preserved':True})


def current_model(state):
    model=state.get('source_model')
    if not state.get('snapshot') or not model or model['baseline_model_id']!=state['snapshot']['model_id']:
        raise ValueError('Available source model for current baseline is required')
    if _hash(model['result'])!=model['result_sha256']:raise ValueError('Source model artifact integrity mismatch')
    return model


def invalidate_stale(state):
    if not state.get('source_model'):return
    baseline=state.get('snapshot',{}).get('model_id')
    if state['source_model']['baseline_model_id']!=baseline:
        state['source_status']={'status':'unsupported','reason':'Baseline model changed; re-fit source explicitly','baseline_preserved':True}
        for forecast in state.get('source_forecasts',{}).values():
            if forecast['status']=='committed':forecast['status']='stale'


def prepare(state,action,command):
    """Return a worker operation/parameters and immutable launch binding."""
    ensure_fields(state)
    if state.get('pending'):raise ValueError('Session already has an outstanding job')
    if state.get('snapshot') is None:raise ValueError('Source enhancement requires a valid baseline model')
    baseline=state['snapshot']['model_id']
    if action=='fit_source':
        params=deepcopy(command['parameters'])
        allowed={'document','candidates','max_synthesis_calls','timeout_s'}
        if not isinstance(params,dict) or set(params)-allowed or not {'document','candidates'}<=set(params):raise ValueError('Invalid source fit parameters')
        document=params['document'];candidates=params['candidates']
        if not isinstance(document,dict) or not isinstance(document.get('trials'),list):raise ValueError('Source calibration document required')
        support={_hash(h['anatomy']) for h in state['snapshot']['hypotheses']};covered=set()
        if not isinstance(candidates,list) or not candidates:raise ValueError('Finite source candidates required')
        for candidate in candidates:
            if not isinstance(candidate,dict) or _hash(candidate.get('anatomy')) not in support:raise ValueError('Source candidate anatomy must match retained baseline support')
            covered.add(_hash(candidate['anatomy']))
        if covered!=support:raise ValueError('Source candidates must cover retained anatomy alternatives')
        ids=set();hashes=set()
        for trial in document['trials']:
            if not isinstance(trial,dict):raise ValueError('Invalid source calibration trial')
            metadata=trial.get('metadata');_metadata(metadata,state['session_id'])
            if trial.get('id')!=metadata['observationId']:raise ValueError('Source trial/observation identity mismatch')
            if trial['id'] in state['source_forecasts'] and state['source_forecasts'][trial['id']]['status'] in ('committed','score_pending'):
                raise ValueError('Prospective source target cannot enter calibration')
            ids.update([trial['id'],metadata['artifactId'],metadata['attemptId']]);hashes.update(metadata['sourceHashes'])
        return 'fit_phonation',{**params,'enabled':True},{'baseline_model_id':baseline,'calibration_ids':sorted(ids),'calibration_hashes':sorted(hashes)}
    model=current_model(state)
    if action=='forecast_source':
        params=deepcopy(command['parameters'])
        required={'family','candidate_id','reference_trial_id','pose','controls','target_id'}
        if not isinstance(params,dict) or set(params)!=required:raise ValueError('Invalid source forecast parameters')
        target=_identity(params['target_id'])
        if target in state['source_forecasts'] or target in model['evidence_ids'] or target in state['snapshot']['evidence_ids']:
            raise ValueError('Source forecast requires unused target identity')
        return 'forecast_phonation',{**params,'fit_result':model['result'],'enabled':True},{'baseline_model_id':baseline,'source_model_id':model['model_id'],'forecast_id':target}
    if action!='score_source':raise ValueError('Unknown source action')
    forecast=state['source_forecasts'].get(command['forecast_id'])
    if not forecast or forecast['status']!='committed' or forecast['source_model_id']!=model['model_id'] or forecast['baseline_model_id']!=baseline:
        raise ValueError('Source score requires current committed forecast')
    artifact=forecast['artifact']
    if _hash(artifact['forecast'])!=artifact['sha256']:raise ValueError('Source forecast integrity mismatch')
    metadata=command['metadata'];_metadata(metadata,state['session_id'],prospective=True)
    if metadata['observationId']!=command['forecast_id'] or _time(metadata['evidenceAt'])<=_time(forecast['committed_at']):
        raise ValueError('Source capture must match target and follow session commitment')
    if any(i in model['evidence_ids'] for i in (metadata['observationId'],metadata['artifactId'],metadata['attemptId'])) or set(metadata['sourceHashes']) & set(model['evidence_hashes']):
        raise ValueError('Source heldout evidence aliases calibration')
    for receipt in state['source_receipts']:
        if receipt.get('operation')=='score_phonation' and set(metadata['sourceHashes']) & set(receipt.get('observation_hashes',[])):
            raise ValueError('Source heldout artifact already scored')
    forecast['status']='score_pending'
    return 'score_phonation',{'frozen':artifact,'pcm':deepcopy(command['pcm']),'metadata':deepcopy(metadata),'enabled':True},{
        'baseline_model_id':baseline,'source_model_id':model['model_id'],'forecast_id':command['forecast_id'],
        'observation_hashes':list(metadata['sourceHashes'])}


def complete_fit(result):
    if not isinstance(result,dict) or result.get('kind')!='phonation-source-tract-fit-1' or result.get('status')!='available':return False
    counts=[]
    for family in ('joint','fixed_source','fixed_anatomy'):
        rows=result.get(family,{}).get('candidates',[])
        if not rows or any(row.get('status')!='scored' or not isinstance(row.get('score'),(float,int)) or not math.isfinite(row['score']) for row in rows):return False
        counts.append(result[family]['actual_synthesis_calls'])
    return len(set(counts))==1 and sum(counts)==result.get('actual_synthesis_calls')


def collect(state,pending,job_status,result):
    """Publish only complete enhancements, with parent and baseline lineage."""
    ensure_fields(state);binding=pending['source_binding'];operation=pending['request']['operation']
    status=result.get('status','failed') if isinstance(result,dict) else job_status
    reason=result.get('reason') if isinstance(result,dict) else 'Optional scientific worker '+job_status
    receipt={'operation':operation,'job_id':pending['job_id'],'status':status,'reason':reason,
        'received_at':_now(),'baseline_preserved':True,**binding}
    if binding['baseline_model_id']!=state['snapshot']['model_id']:raise ValueError('Stale source worker baseline')
    if operation=='fit_phonation' and complete_fit(result):
        previous=state.get('source_model');hashes=set(binding['calibration_hashes'])|set(result['evidence_frame_hashes'])
        model={'model_id':'source-model:'+_hash([binding['baseline_model_id'],result]),'baseline_model_id':binding['baseline_model_id'],
            'parent_source_model_id':previous['model_id'] if previous else None,'result':deepcopy(result),'result_sha256':_hash(result),
            'evidence_ids':sorted(set(binding['calibration_ids'])|set(result['evidence_ids'])),'evidence_hashes':sorted(hashes),
            'adopted_at':_now(),'closure_contact_inference':False,'scope':'Independent optional source/tract alternatives; baseline anatomy unchanged'}
        state['source_model']=model;receipt['adopted_model_id']=model['model_id']
        for forecast in state['source_forecasts'].values():
            if forecast['status']=='committed':forecast['status']='stale'
    elif operation=='fit_phonation' and status=='available':
        receipt.update(status='insufficient-quality',reason='Incomplete source comparison; prior enhancement retained')
    elif operation=='forecast_phonation':
        frozen=result.get('forecast') if isinstance(result,dict) else None
        if job_status=='succeeded' and frozen and frozen.get('status')=='available':
            if _hash(frozen)!=result.get('sha256') or frozen.get('target_id')!=binding['forecast_id'] or frozen.get('fit_sha256')!=state['source_model']['result_sha256']:
                raise ValueError('Source forecast result binding mismatch')
            state['source_forecasts'][binding['forecast_id']]={'artifact':deepcopy(result),'status':'committed',
                'committed_at':_now(),'baseline_model_id':binding['baseline_model_id'],'source_model_id':binding['source_model_id']}
            receipt['status']='available'
        else:receipt['status']=frozen.get('status','failed') if frozen else status
    elif operation=='score_phonation':
        forecast=state['source_forecasts'][binding['forecast_id']]
        if job_status=='succeeded' and isinstance(result,dict) and result.get('status')=='available':
            if result.get('forecast_sha256')!=forecast['artifact']['sha256'] or result.get('model_updated') is not False:raise ValueError('Source score binding mismatch')
            forecast['status']='scored';receipt['score']=result['score']
        else:forecast['status']='unscorable'
        forecast['score_result']=deepcopy(result);forecast['scored_at']=_now()
    state['source_status']={k:receipt[k] for k in ('status','reason','baseline_preserved')}
    state['source_receipts'].append(receipt)
