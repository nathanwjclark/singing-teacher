"""Durable conditional visual forecasts; baseline anatomical state is never adopted."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from .prediction import _encode, _timestamp


def _hash(value):
    return hashlib.sha256(_encode(value)).hexdigest()


def _keys(frames):
    if not isinstance(frames,list): raise ValueError('Visual frame list required')
    keys=[]
    for frame in frames:
        if not isinstance(frame,dict) or not isinstance(frame.get('media_sha256'),str) or len(frame['media_sha256'])!=64 or type(frame.get('video_frame_index')) is not int or frame['video_frame_index']<0:
            raise ValueError('Original visual frame identity required')
        keys.append((frame['media_sha256'],frame['video_frame_index']))
    if len(set(keys))!=len(keys): raise ValueError('Repeated physical visual frame')
    return set(keys)


def prepare(state,action,command):
    snapshot=state['snapshot']; params=deepcopy(command['parameters']);ident=command['forecast_id']
    if not snapshot or state['pending']: raise ValueError('Visual action requires idle current model')
    if not isinstance(ident,str) or not ident.strip() or len(ident)>160: raise ValueError('Visual forecast identity required')
    if not isinstance(params,dict): raise ValueError('Visual parameters required')
    forecasts=state.setdefault('visual_forecasts',{})
    binding={'forecast_id':ident,'baseline_model_id':snapshot['model_id'],'baseline_snapshot_sha256':_hash(snapshot)}
    if action=='forecast_visual':
        allowed={'camera_candidates','calibration_frames','targets','coordinate_system','calibration_tolerance_px','max_geometry_calls'}
        if set(params)-allowed or not {'camera_candidates','calibration_frames','targets','coordinate_system'}<=set(params): raise ValueError('Invalid visual forecast fields')
        if ident in forecasts: raise ValueError('Visual forecast identity already exists')
        calibration=_keys(params['calibration_frames']); targets=_keys(params['targets'])
        if not calibration or not targets or calibration & targets: raise ValueError('Distinct calibration and annotation-heldout frames required')
        for prior in forecasts.values():
            if targets & (_keys(prior['artifact']['artifact']['targets']) | _keys(prior['artifact']['artifact']['calibration_frames'])): raise ValueError('Visual target already committed in this session')
        # Reusing an original video is allowed; disjoint frame identity defines this
        # annotation holdout. Reusing an already scored frame as a target is not.
        params.update(model_id=snapshot['model_id'],hypotheses=deepcopy(snapshot['hypotheses']),expected_provenance=deepcopy(snapshot['provenance']))
        return 'freeze_visual_forecast',params,binding
    if set(params)!={'annotations'}: raise ValueError('Visual score requires only annotations')
    forecast=forecasts.get(ident)
    if not forecast or forecast['status']!='committed' or forecast['baseline_snapshot_sha256']!=_hash(snapshot): raise ValueError('Visual forecast is not committed for current model')
    artifact=forecast['artifact'];targets=artifact['artifact']['targets']
    if _keys(params['annotations'])!=_keys(targets): raise ValueError('Visual annotations must match every frozen target')
    for row in params['annotations']:
        if _timestamp(row.get('annotation_created_at'))<=_timestamp(forecast['committed_at']):
            raise ValueError('Visual annotation must follow session commitment')
    params.update(forecast=deepcopy(artifact['artifact']),expected_digest=artifact['sha256'])
    binding['forecast_sha256']=artifact['sha256'];forecast['status']='score_pending'
    return 'score_visual_forecast',params,binding


def collect(state,pending,status,result):
    binding=pending['visual_binding'];operation=pending['request']['operation'];ident=binding['forecast_id']
    receipt={**binding,'job_id':pending['job_id'],'operation':operation,'status':status,'model_updated':False,
             'received_at':datetime.now(timezone.utc).isoformat(),'result_sha256':_hash(result) if result else None}
    state.setdefault('visual_receipts',[]).append(receipt)
    forecasts=state.setdefault('visual_forecasts',{})
    if status!='succeeded' or result is None:
        if operation=='score_visual_forecast' and ident in forecasts: forecasts[ident]['status']='unscorable'
        return
    if state['snapshot']['model_id']!=binding['baseline_model_id'] or _hash(state['snapshot'])!=binding['baseline_snapshot_sha256']:
        receipt.update(status='stale');return
    if not isinstance(result,dict) or result.get('sha256')!=_hash(result.get('artifact')):
        raise ValueError('Visual worker artifact digest mismatch')
    if operation=='freeze_visual_forecast':
        data=result['artifact']
        if data['model_id']!=binding['baseline_model_id'] or data['targets']!=pending['request']['parameters']['targets']:
            raise ValueError('Visual worker forecast binding mismatch')
        forecasts[ident]={**binding,'artifact':deepcopy(result),'committed_at':receipt['received_at'],'status':'committed' if data['calibration_status']=='scored' else 'unsupported',
            'scope':'Annotation holdout from fixed original frames; not prospective capture or anatomy adoption'}
    else:
        forecast=forecasts[ident]
        if forecast['artifact']['sha256']!=binding['forecast_sha256']: raise ValueError('Visual forecast changed during scoring')
        data=result['artifact']
        if data.get('forecast_sha256')!=binding['forecast_sha256'] or data.get('model_id')!=binding['baseline_model_id']:
            raise ValueError('Visual score result binding mismatch')
        forecast.update(status='scored' if data.get('status')=='scored' else 'unscorable',score_result=deepcopy(result))


def invalidate_stale(state):
    for forecast in state.get('visual_forecasts',{}).values():
        if forecast['baseline_snapshot_sha256']!=_hash(state['snapshot']) and forecast['status'] in ('committed','score_pending','unsupported'):
            forecast['status']='stale'
