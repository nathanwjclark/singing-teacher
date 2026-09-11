"""Bounded recorded motion-media PCM comparison; no geometry or model update."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time

import numpy as np
from live_capture_jobs import HTTPBackend
from singing_physics.engine import Engine
from singing_physics.pcm_inverse import extract_pcm,fit_pcm
from singing_physics.motion_trajectory import window_offsets,score_forward_bank,select_hypotheses,MAX_SYNTHESIS_CALLS,MAX_RECORDING_SECONDS,RESCORING_OBJECTIVE,VERSION


def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(path,limit=64*1024*1024):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        import stat
        st=os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size>limit:raise ValueError('Invalid retained artifact size/type')
        with os.fdopen(fd,'rb',closefd=False) as f:raw=f.read(limit+1)
        if len(raw)!=st.st_size:raise ValueError('Artifact changed during read')
        return raw
    finally:os.close(fd)
def write(path,value):
    # Status polling must never observe partially serialized numerical output.
    fd,temporary=tempfile.mkstemp(prefix=path.name+'.',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:
            json.dump(value,f,allow_nan=False,separators=(',',':'));f.flush();os.fsync(f.fileno())
        os.link(temporary,path)  # Atomic publication, preserving exclusive creation.
    finally:
        os.unlink(temporary)
def process(args,timeout=20):
    p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        out,err=p.communicate(timeout=timeout)
        if p.returncode:raise ValueError('Media decoder rejected recording: '+err.decode(errors='replace')[-300:])
        return out
    finally:
        if p.poll() is None:p.kill()
        p.wait()


def run(data_root,capture_id,pose,output,expected_model_id=None):
    data_root,output=Path(data_root),Path(output)
    if not re.fullmatch('[a-f0-9]{64}',capture_id) or not re.fullmatch('[A-Za-z][A-Za-z0-9_-]{0,63}',pose):raise ValueError('Invalid capture ID or explicit pose')
    root=data_root/'motion-captures'/capture_id
    rb=load(root/'record.json',4*1024*1024);sb=load(root/'summary.json',1024*1024);media=load(root/'media')
    record,summary=json.loads(rb),json.loads(sb);rh,mh=sha(rb),sha(media)
    if summary.get('id')!=capture_id or capture_id!=sha((rh+mh).encode()) or summary.get('recordSha256')!=rh or summary.get('mediaSha256')!=mh or summary.get('mediaByteLength')!=len(media):raise ValueError('Retained motion receipt mismatch')
    if record.get('kind')!='motion-observation' or record.get('media',{}).get('sha256')!=mh or record['media'].get('byteLength')!=len(media) or mh not in record.get('provenance',{}).get('sourceHashes',[]):raise ValueError('Motion record/media binding mismatch')
    if record.get('containsProbe') or record.get('containsExternalExcitation'):raise ValueError('External excitation is not ordinary singing')
    output.mkdir(parents=True,exist_ok=False,mode=0o700)
    result={'kind':'motion-pcm-fit-1','captureId':capture_id,'pose':pose,'status':'unavailable','windows':[],
        'sourceHashes':{'media':mh,'record':rh,'receipt':sha(sb)},'actualSynthesisCalls':0,'visualSync':'unknown','modelUpdated':False,'warnings':[],
        'assumptions':['Explicit pose is user-declared, not measured execution.','Recorded PCM decoded at original declared sample rate; no normalization or observed resampling.',
        'Candidate JA and digital gains are hypotheses; source pitch uses a declared bounded anchor bank and other source controls use fixed native defaults.',
        'Audio-only conditional trajectory; no calibrated2D geometry, audiovisual synchronization or physiology identification.','Input is caller-declared ordinary singing without external excitation.']}
    ffmpeg=os.environ.get('SINGING_FFMPEG') or shutil.which('ffmpeg');ffprobe=os.environ.get('SINGING_FFPROBE') or shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        result['reason']='ffmpeg/ffprobe unavailable';write(output/'summary.json',result);return result
    current=json.loads(load(data_root/'science-current.json',1024*1024));run_id=current.get('runId','')
    if current.get('status')!='succeeded' or not re.fullmatch('[A-Za-z0-9-]{1,100}',run_id):raise ValueError('Completed baseline run required')
    app=json.loads(load(data_root/'science-runs'/run_id/'summary.json',4*1024*1024));session_id=app['sessionId']
    if not re.fullmatch('[A-Za-z0-9_-]{1,150}',session_id):raise ValueError('Invalid session identity')
    state=HTTPBackend(os.environ.get('SCIENCE_URL',''),os.environ.get('SCIENCE_TOKEN',''),session_id).execute({'action':'state'})['state']
    snapshot=state.get('snapshot');hypotheses=snapshot['hypotheses'] if snapshot else []
    if expected_model_id is not None and snapshot and snapshot['model_id']!=expected_model_id:raise ValueError('Current baseline differs from expected model ID')
    if not hypotheses:raise ValueError('Retained model hypotheses unavailable')
    # Declared from the frozen snapshot before any recording byte is decoded.
    selected,subset=select_hypotheses(snapshot);result.update(modelId=snapshot['model_id'],sessionId=session_id,hypothesisSubset=subset)
    # A baseline receipt without an objective predates selectable objectives and used the coarse descriptors.
    baseline_objective=app.get('objective') or RESCORING_OBJECTIVE
    result['objective']={'rescoring':RESCORING_OBJECTIVE,'baseline':baseline_objective,'baselineDeclared':'objective' in app,'matchesBaseline':baseline_objective==RESCORING_OBJECTIVE,
        'source':'baseline science run summary objective field; absent means the legacy coarse objective'}
    if baseline_objective!=RESCORING_OBJECTIVE:
        result['warnings'].append({'code':'objective-differs-from-baseline','message':f'The baseline model was fitted with {baseline_objective}; this analysis rescored it with {RESCORING_OBJECTIVE} coarse descriptors, so its ranking may differ from the baseline fit.'})
    write(output/'model-snapshot.json',snapshot)
    # Decode only verified private bytes copied to this job, not a mutable original pathname.
    local=output/'source-media';local.write_bytes(media);local.chmod(0o600)
    info=json.loads(process([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(local)]))
    streams=[s for s in info.get('streams',[]) if s.get('codec_type')=='audio']
    if len(streams)!=1:
        result['reason']='Exactly one recorded audio stream required';write(output/'summary.json',result);return result
    stream=streams[0];rate=int(stream['sample_rate']);channels=int(stream['channels']);duration=float(info.get('format',{}).get('duration',stream.get('duration',0)))
    if rate not in (44100,48000,96000) or not 1<=channels<=8 or not 0<duration<=MAX_RECORDING_SECONDS:raise ValueError(f'Unsupported audio rate/channels or duration outside 0..{MAX_RECORDING_SECONDS} seconds')
    decoded=process([ffmpeg,'-v','error','-nostdin','-i',str(local),'-map',f'0:{stream["index"]}','-vn','-t',str(MAX_RECORDING_SECONDS),'-f','f32le','-acodec','pcm_f32le','pipe:1'])
    if len(decoded)%(4*channels) or len(decoded)>rate*MAX_RECORDING_SECONDS*channels*4:raise ValueError('Decoded PCM dimensions exceed bounds')
    samples=np.frombuffer(decoded,dtype='<f4').reshape(-1,channels)
    if not len(samples) or not np.isfinite(samples).all():raise ValueError('Invalid decoded PCM')
    channel=int(np.argmax(np.mean(samples[::8].astype(float)**2,axis=0)));mono=samples[:,channel].copy();chunk_size=round(.25*rate);frame_start=round(.1*rate);frame_size=8192 if rate==96000 else 4096
    result['decode']={'sampleRateHz':rate,'channelCount':channels,'selectedChannel':channel+1,'decodedSampleCount':len(mono),'pcmSha256':sha(mono.astype('<f4').tobytes()),'codec':stream.get('codec_name'),'durationSeconds':duration,'policy':'highest energy every eighth sample; earliest tie'}
    # Grid selection uses only duration, never the agreement of a window with a model.
    offsets=window_offsets(len(mono),rate,chunk_size);used=[]
    result['analysisPolicy']=VERSION
    with Engine() as engine:
        from singing_physics import engine as engine_module,pcm_inverse as pcm_module
        result['sourceConditions']={'sourceInfo':engine.source_info,'fixedPressurePa':8000,'pressureRampSeconds':.025,'F0':'10th, 50th and 90th percentile measured voiced pitch anchors; nearest within 100 cents','otherControls':'native source_info defaults','engineSha256':sha(Path(engine_module.__file__).read_bytes()),'fitterSha256':sha(Path(pcm_module.__file__).read_bytes()),'nativeProvenance':engine.provenance}
        native_synthesize=engine.synthesize
        synthesis_cache={}
        def counted_synthesis(*args,**kwargs):
            key=json.dumps([engine.anatomy(),args,kwargs],sort_keys=True,separators=(',',':'),allow_nan=False)
            if key not in synthesis_cache:
                if result['actualSynthesisCalls']>=MAX_SYNTHESIS_CALLS:raise RuntimeError('Hard aggregate motion synthesis budget exhausted')
                result['actualSynthesisCalls']+=1
                synthesis_cache[key]=native_synthesize(*args,**kwargs)
            return synthesis_cache[key].copy()
        engine.synthesize=counted_synthesis
        for index,offset in enumerate(offsets):
            row={'index':index,'sourceStartSample':offset,'startSample':offset,'sampleRateHz':rate,'windowOffsetWithinExcerpt':frame_start,'status':'unavailable','fit':None};result['windows'].append(row)
            if offset+chunk_size>len(mono) or any(offset<end and start<offset+chunk_size for start,end in used):row['reason']='Insufficient disjoint source duration';continue
            used.append((offset,offset+chunk_size));excerpt=mono[offset:offset+chunk_size];raw=excerpt.astype('<f4').tobytes();artifact=f'{capture_id}:excerpt:{offset}'
            file=output/f'excerpt-{index}.f32';file.write_bytes(raw);file.chmod(0o600)
            frame=excerpt[frame_start:frame_start+frame_size]
            canonical=extract_pcm(frame,rate,measurement_id=artifact+':measurement',observation_id=artifact,artifact_id=artifact+':pcm',start_ms=100.,source_kind='engine-generated' if record.get('provenance',{}).get('kind') in ('development-fixture','engine-generated') else 'human-observation')
            row.update(measurement=canonical['measurement'],excerptSha256=sha(raw),frameSha256=sha(frame.astype('<f4').tobytes()),sourceKind=record.get('provenance',{}).get('kind','caller-declared-recording'))
            measurement=canonical['measurement'];values={m['name']:m['value'] for m in measurement['measurements']}
            pitch=next((m['value'] for m in measurement['measurements'] if m['name']=='pitchHz'),None)
            if pitch is None or not 65<=pitch<=1000 or measurement['quality']['missingReason'] or set(measurement['quality']['flags'])&{'clipping','invalid','dropped','low-signal-to-noise'}:row['reason']='Unvoiced or invalid canonical window';continue
            if any(values.get(name) is None or not math.isfinite(values[name]) for name in ('dbfs','centroidHz','flatness','pitchHz','periodicity')):
                row['reason']='Incomplete canonical objective descriptors';continue
            row.update(status='measured',reason=None)
        result['trajectoryBank'],banks=score_forward_bank(engine,result['windows'],selected,pose,rate,frame_start,frame_size,fitter=fit_pcm)
    # Complete bank predictions are kept once beside the summary; windows cite them by hash.
    for row,fitted in zip(result['trajectoryBank']['banks'],banks):
        if fitted is not None:write(output/row['artifact'],fitted)
    from singing_physics.motion_path import couple_motion_hypotheses
    result['temporalAnalysis']=couple_motion_hypotheses(result['windows'])
    result['warnings']+=result['temporalAnalysis']['warnings']
    result['status']='available' if any(w['status']=='scored' for w in result['windows']) else 'insufficient-quality'
    write(output/'summary.json',result);return result


if __name__=='__main__':
    if os.getpgrp()!=os.getpid():os.setsid()
    parent=os.getppid()
    def watchdog():
        deadline=time.monotonic()+230
        while time.monotonic()<deadline and os.getppid()==parent:time.sleep(.1)
        os.killpg(os.getpid(),signal.SIGKILL)
    threading.Thread(target=watchdog,daemon=True).start()
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('data-root','capture-id','pose','output'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--expected-model-id')
    a=parser.parse_args();print(json.dumps({k:v for k,v in run(a.data_root,a.capture_id,a.pose,a.output,a.expected_model_id).items() if k!='windows'}))
