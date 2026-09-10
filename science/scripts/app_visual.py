"""Exact retained video frames and explicit conditional visual session experiments."""
import argparse
import hashlib
import json
import os
import fcntl
from pathlib import Path
import re
import subprocess
import tempfile
from datetime import datetime,timezone
from science.scripts.live_capture_jobs import HTTPBackend,wait
from science.scripts.run_probe_fit import seal
from singing_physics.service import canonical

ROOT=Path(__file__).resolve().parents[2]
ID=re.compile(r'^[a-f0-9]{64}$')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(path,limit=64*1024*1024):
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        size=os.fstat(stream.fileno()).st_size
        if not 0<size<=limit:raise ValueError('Retained video artifact exceeds its supported size')
        raw=stream.read(size+1)
    if len(raw)!=size:raise ValueError('Retained video changed while reading')
    return raw
def process(args,timeout=30):
    child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        stdout,stderr=child.communicate(timeout=timeout)
        if child.returncode:raise ValueError('Original video decoder rejected the media: '+stderr.decode(errors='replace')[-200:])
        return stdout
    finally:
        if child.poll() is None:child.kill()
        child.wait()
def original(root,capture_id):
    if not ID.fullmatch(capture_id):raise ValueError('Invalid retained motion capture ID')
    folder=root/'motion-captures'/capture_id
    receipt_raw=load(folder/'summary.json',1024*1024);receipt=json.loads(receipt_raw)
    record_raw=load(folder/'record.json',4*1024*1024);record=json.loads(record_raw);media=load(folder/'media')
    if sha(record_raw)!=receipt['recordSha256'] or sha(media)!=receipt['mediaSha256'] or len(media)!=receipt['mediaByteLength'] or record['media']['sha256']!=sha(media):
        raise ValueError('Original video/annotation integrity mismatch')
    if sha((sha(record_raw)+sha(media)).encode())!=capture_id:raise ValueError('Capture ID does not bind original media and JSON')
    return folder,{'media':sha(media),'record':sha(record_raw),'receipt':sha(receipt_raw)},record


def index_frames(data_root,capture_id):
    root=Path(data_root);folder,hashes,record=original(root,capture_id)
    output=root/'visual-frames'/capture_id;output.mkdir(parents=True,exist_ok=True,mode=0o700)
    saved=output/'index.json'
    if saved.exists():
        value=json.loads(load(saved,4*1024*1024))
        if value['sourceHashes']!=hashes:raise ValueError('Frame index original source changed')
        return value
    binary=os.environ.get('SINGING_FFPROBE','ffprobe')
    raw=process([binary,'-v','error','-select_streams','v:0','-read_intervals','%+#900','-show_frames',
        '-show_entries','frame=best_effort_timestamp_time,width,height','-of','json',str(folder/'media')])
    if len(raw)>4*1024*1024:raise ValueError('Frame index exceeds its finite limit')
    rows=json.loads(raw).get('frames',[]);frames=[]
    for i,row in enumerate(rows):
        try:pts=float(row['best_effort_timestamp_time']);width=int(row['width']);height=int(row['height'])
        except (ValueError,KeyError):raise ValueError('Decoded frame lacks exact PTS or dimensions')
        if not 0<=pts<=30:continue
        if not 0<width<=4096 or not 0<height<=4096:raise ValueError('Decoded original frame dimensions exceed supported bounds')
        if frames and pts<=frames[-1]['ptsSeconds']:raise ValueError('Video frame timestamps are not strictly ordered')
        frames.append({'frameIndex':i,'ptsSeconds':pts,'width':width,'height':height})
    if not frames:raise ValueError('Original recording has no usable video frames')
    value={'captureId':capture_id,'mediaSha256':hashes['media'],'sourceHashes':hashes,'frames':frames,
        'rotationApplied':False,'coordinateConvention':'coded decoded original pixels; no auto-rotation, crop, resize or mirror',
        'sourceKind':record['provenance']['kind'],'audioAlignment':'unknown; no video/audio synchronization claim',
        'decoder':process([binary,'-version']).decode().splitlines()[0]}
    if original(root,capture_id)[1]!=hashes:raise ValueError('Original video changed during indexing')
    seal(saved,value);return value


def frame_image(data_root,capture_id,frame_index):
    root=Path(data_root);index=index_frames(root,capture_id)
    row=next((r for r in index['frames'] if r['frameIndex']==frame_index),None)
    if row is None:raise ValueError('Frame index is outside the declared original video frames')
    output=root/'visual-frames'/capture_id;receipt=output/f'frame-{frame_index}.json';image=output/f'frame-{frame_index}.png'
    if receipt.exists():
        result=json.loads(load(receipt,1024*1024))
        if sha(load(image,32*1024*1024))!=result['pngSha256']:raise ValueError('Decoded frame pixels changed')
        return result
    binary=os.environ.get('SINGING_FFMPEG','ffmpeg')
    raw=process([binary,'-v','error','-noautorotate','-i',str(root/'motion-captures'/capture_id/'media'),'-map','0:v:0',
        '-vf',f'select=eq(n\\,{frame_index})','-vsync','0','-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'])
    if len(raw)>32*1024*1024 or not raw.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Decoded PNG unavailable or excessive')
    width=int.from_bytes(raw[16:20],'big');height=int.from_bytes(raw[20:24],'big')
    if [width,height]!=[row['width'],row['height']]:raise ValueError('Decoded pixels differ from indexed original dimensions')
    if original(root,capture_id)[1]!=index['sourceHashes']:raise ValueError('Original video changed during frame extraction')
    result={**row,'captureId':capture_id,'pngSha256':sha(raw),'pngByteLength':len(raw),'sourceHashes':index['sourceHashes'],
        'decoder':process([binary,'-version']).decode().splitlines()[0]}
    temp=output/f'.frame-{frame_index}-{os.urandom(6).hex()}'
    with os.fdopen(os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as stream:stream.write(raw)
    if image.exists():
        if load(image,32*1024*1024)!=raw:temp.unlink();raise ValueError('Previously decoded pixels differ')
        temp.unlink()
    else:os.rename(temp,image)
    seal(receipt,result);return result


def visual_frames(rows,index,annotated):
    if not isinstance(rows,list) or not 1<=len(rows)<=16:raise ValueError('Select between one and sixteen original frames')
    values=[];created=datetime.now(timezone.utc).isoformat()
    for row in rows:
        fields={'frameIndex','pose','assumedJA'}|({'visibility','upperPixel','lowerPixel'} if annotated else set())
        if not isinstance(row,dict) or set(row)!=fields:raise ValueError('Unexpected visual annotation fields')
        metadata=next((f for f in index['frames'] if f['frameIndex']==row['frameIndex']),None)
        if not metadata:raise ValueError('Annotation does not reference a retained decoded frame')
        value={'frame_id':index['captureId']+':video:'+str(row['frameIndex']),'media_sha256':index['mediaSha256'],
            'video_frame_index':row['frameIndex'],'pose':row['pose'],'assumed_JA':row['assumedJA']}
        if annotated:value.update(annotation_created_at=created,correspondence_operator_id='vtl-upper4-lower5-vertex89-distance-v1',
            annotation_method='explicit-native-marker-correspondence',visibility=row['visibility'],upper_px=row['upperPixel'],lower_px=row['lowerPixel'])
        values.append(value)
    return values


def execute_experiment(data_root,request_path,output):
    root,output=Path(data_root),Path(output);request=json.loads(load(request_path,32000));output.mkdir(parents=True,exist_ok=True,mode=0o700)
    with os.fdopen(os.open(output/'run.lock',os.O_RDWR|os.O_CREAT,0o600),'w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('This visual experiment is already running')
        intent_path=output/'intent.json'
        if intent_path.exists():
            intent=json.loads(load(intent_path,4*1024*1024))
            if intent['request']!=request:raise ValueError('Visual retry differs from original request')
        else:
            index=index_frames(root,request['captureId']);current=json.loads(load(root/'science-current.json',1024*1024))
            if current.get('status')!='succeeded' or not re.fullmatch(r'[A-Za-z0-9_-]+',current.get('runId','')):raise ValueError('Complete a baseline voice model first')
            voice=json.loads(load(root/'science-runs'/current['runId']/'summary.json',4*1024*1024));session=voice['sessionId']
            backend=HTTPBackend(os.environ.get('SCIENCE_URL'),os.environ.get('SCIENCE_TOKEN'),session)
            state=backend.execute({'action':'state'})['state'];baseline=state.get('snapshot',{}).get('model_id')
            if not baseline:raise ValueError('Current baseline hypotheses are unavailable')
            if request['operation']=='freeze':
                if baseline!=request['expectedModelId']:raise ValueError('Baseline changed; refresh before freezing visual predictions')
                calibration=visual_frames(request['calibrationFrames'],index,True);targets=visual_frames(request['targets'],index,False)
                chosen={r['video_frame_index'] for r in calibration+targets};dimensions={(f['width'],f['height']) for f in index['frames'] if f['frameIndex'] in chosen}
                if len(dimensions)!=1:raise ValueError('Selected frames must have the same original dimensions')
                width,height=next(iter(dimensions))
                parameters={'camera_candidates':request['cameraCandidates'],'calibration_frames':calibration,'targets':targets,
                    'coordinate_system':{'id':request['captureId']+':original-pixels','width_px':width,'height_px':height,'transform':'decoded-original-pixels'},
                    'calibration_tolerance_px':request['calibrationTolerancePx'],'max_geometry_calls':96}
                action='forecast_visual'
            else:parameters={'annotations':visual_frames(request['annotations'],index,True)};action='score_visual'
            intent={'request':request,'sessionId':session,'baselineModelId':baseline,'sourceHashes':index['sourceHashes'],
                'sourceKind':index['sourceKind'],'decodedFrameIndex':index,
                'command':{'action':action,'command_id':output.name+'-'+action,'forecast_id':request['forecastId'],'parameters':parameters}}
            seal(intent_path,intent)
        backend=HTTPBackend(os.environ.get('SCIENCE_URL'),os.environ.get('SCIENCE_TOKEN'),intent['sessionId'])
        command=intent['command'];key='session:'+sha(canonical([intent['sessionId'],command['command_id']]).encode())
        def owned(state):return next((j for j in state['jobs'] if j.get('key')==key),None)
        state=backend.execute({'action':'state'})['state'];record=owned(state)
        if record is None and (not state['pending'] or state['pending'].get('key')!=key):
            if state['pending']:raise ValueError('Another scientific job is running; retry after it completes')
            if state['snapshot']['model_id']!=intent['baselineModelId']:raise ValueError('Baseline changed before visual submission')
            for attempt in range(3):
                if state['snapshot']['model_id']!=intent['baselineModelId']:
                    seal(output/'failure.json',{'reason':'Baseline changed before visual submission; refresh and create a new declaration'})
                    raise ValueError('Baseline changed before visual submission')
                try:state=backend.execute({**command,'expected_version':state['version']})['state'];break
                except Exception:
                    state=backend.execute({'action':'state'})['state']
                    if owned(state) or state['pending'] and state['pending'].get('key')==key:break
                    if attempt==2:
                        seal(output/'failure.json',{'reason':'Visual declaration was rejected before job submission; a new declaration can be entered in the app'})
                        raise
        record=owned(state)
        if record is None:
            pending=state['pending']
            if not pending or pending.get('key')!=key:raise ValueError('No recoverable visual job')
            job=pending['job_id']
            try:wait(backend,job)
            except TimeoutError:backend.cancel(job);wait(backend,job)
            for attempt in range(3):
                state=backend.execute({'action':'state'})['state'];record=owned(state)
                if record:break
                try:state=backend.execute({'action':'collect_job','command_id':output.name+'-collect','expected_version':state['version'],'job_id':job})['state'];record=owned(state);break
                except Exception:
                    if attempt==2:raise
        if record is None:raise ValueError('Visual result is not yet available; retry to recover')
        if record['status']!='succeeded':seal(output/'failure.json',{'reason':'Visual job did not complete; session released'});raise ValueError('Visual job failed; retry with a new request')
        forecast=state.get('visual_forecasts',{}).get(request['forecastId'])
        if not forecast or forecast.get('baseline_model_id')!=intent['baselineModelId']:
            raise ValueError('Authoritative visual forecast does not match the intended baseline')
        if original(root,request['captureId'])[1]!=intent['sourceHashes']:raise ValueError('Original evidence changed before visual publication')
        result={'operation':request['operation'],'forecastId':request['forecastId'],'sessionId':intent['sessionId'],
            'baselineModelId':intent['baselineModelId'],'sourceHashes':intent['sourceHashes'],'captureId':request['captureId'],
            'sourceKind':intent['sourceKind'],
            'result':record['result'],'status':'succeeded','modelUpdated':False}
        seal(output/'summary.json',result)
        if not (output/'session-ledger.json').exists():seal(output/'session-ledger.json',backend.execute({'action':'replay'}))
        return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--operation',choices=['frames','frame','execute'],required=True);p.add_argument('--data-root',required=True)
    p.add_argument('--capture-id');p.add_argument('--frame-index',type=int);p.add_argument('--request');p.add_argument('--output');a=p.parse_args()
    if a.operation=='frames':result=index_frames(a.data_root,a.capture_id)
    elif a.operation=='frame':result=frame_image(a.data_root,a.capture_id,a.frame_index)
    else:result=execute_experiment(a.data_root,a.request,a.output)
    print(json.dumps(result,allow_nan=False))
