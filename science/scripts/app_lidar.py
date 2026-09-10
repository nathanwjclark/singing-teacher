"""Original rear depth archives -> explicit experimental annotation -> session fit."""
import argparse
import hashlib
import json
import os
import fcntl
from pathlib import Path
import re
import tempfile
import shutil
import base64
import numpy as np
from science.scripts.import_session_bundle import _archive, _phase, _json
from science.scripts.run_probe_fit import seal
from science.scripts.live_capture_jobs import backend_for, wait, EXPORTS
from observations.geometry.native_capture import read_native_capture
from singing_physics.service import canonical
from singing_physics.prediction import _encode


def digest(raw): return hashlib.sha256(raw).hexdigest()


def capture_state(directory, archive_hash):
    capture=read_native_capture(directory,allow_rear_lidar=True)
    rows=[]
    for frame in capture.frames:
        m=frame.source_metadata;c=frame.calibration
        rows.append({'sequence':frame.sequence,'width':frame.depth_m.shape[1] if frame.depth_m is not None else 0,
            'height':frame.depth_m.shape[0] if frame.depth_m is not None else 0,
            'depthFiltered':m.get('depth_filtered'),'depthAccuracy':m.get('depth_accuracy_label'),
            'validPixels':frame.readiness['positive_finite_pixels'],'rgbAvailable':bool(m.get('rgb')),
            'rgbArtifact':m.get('rgb'),
            'calibration':{k:c[k] for k in ('intrinsics_row_major','intrinsic_reference_dimensions','extrinsics_3x4_row_major')} if c else None})
    return {'captureId':capture.capture_id,'importId':archive_hash,'archiveSha256':archive_hash,
        'manifestSha256':capture.manifest_sha256,'frames':rows,'sensor':'rear-lidar',
        'separateScan':True,'sourceAuthenticity':'Original bytes verified; device origin and experimental declarations are not independently authenticated.'}


def prepare(data_root):
    root=Path(data_root)
    receipt=_json((root/'native-pull-latest.json').read_bytes());name=receipt.get('name','')
    if not re.fullmatch(r'rear-lidar-[0-9a-fA-F-]{36}\.zip',name):raise ValueError('Pull a completed rear LiDAR archive before importing it.')
    with os.fdopen(os.open(root/'usb-imports'/name,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        size=os.fstat(stream.fileno()).st_size
        if not 0<size<=512*1024*1024 or size!=receipt.get('bytes'):raise ValueError('Rear archive byte count mismatch')
        raw=stream.read(size+1)
    sha=digest(raw)
    if len(raw)!=size or sha!=receipt.get('sha256'):raise ValueError('Rear archive hash mismatch')
    files=_archive(raw,[512*1024*1024]);manifest=_phase(files,'videoDepth')
    if manifest.get('capture_mode')!='separate-rear-lidar-held-pose' or manifest.get('capture_id','').upper()!=name[11:-4].upper():
        raise ValueError('Archive is not the declared separate rear LiDAR capture')
    parent=root/'lidar-imports';parent.mkdir(parents=True,exist_ok=True,mode=0o700);output=parent/sha
    if output.exists():
        if (output/'original.zip').read_bytes()!=raw:raise ValueError('Retained archive changed')
        if set(p.name for p in (output/'capture').iterdir())!=set(files):raise ValueError('Retained depth files changed')
        for filename,data in files.items():
            path=output/'capture'/filename
            if path.is_symlink() or path.read_bytes()!=data:raise ValueError('Retained original depth bytes changed')
    else:
        temporary=Path(tempfile.mkdtemp(prefix='.import-',dir=parent))
        try:
            (temporary/'capture').mkdir(mode=0o700)
            for path,data in [(temporary/'original.zip',raw),*[(temporary/'capture'/k,v) for k,v in files.items()]]:
                with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as stream:stream.write(data)
            capture_state(temporary/'capture',sha)
            os.rename(temporary,output)
        finally:
            if temporary.exists():shutil.rmtree(temporary)
    state=capture_state(output/'capture',sha)
    seal(output/'summary.json',state)
    temp=root/('.lidar-current-'+os.urandom(8).hex());temp.write_text(json.dumps(state));temp.chmod(0o600);os.replace(temp,root/'lidar-current.json')
    return state


def frame_data(data_root,capture_id,sequence):
    root=Path(data_root);state=_json((root/'lidar-current.json').read_bytes())
    if state['captureId']!=capture_id:raise ValueError('Selected capture changed; refresh the scan')
    capture=read_native_capture(root/'lidar-imports'/state['importId']/'capture',allow_rear_lidar=True)
    frame=next((f for f in capture.frames if f.sequence==sequence),None)
    if frame is None or frame.depth_m is None:raise ValueError('Selected frame has no original depth')
    return {'sequence':sequence,'width':frame.depth_m.shape[1],'height':frame.depth_m.shape[0],
        'depthM':[float(v) if np.isfinite(v) and v>0 else None for v in frame.depth_m.reshape(-1)],
        'calibration':next(f['calibration'] for f in state['frames'] if f['sequence']==sequence)}


def annotation_for(declaration,snapshot,capture,output):
    expected={'frameSequence','upperPixel','lowerPixel','depthToReference','referenceMappingExplanation','pose','jawValues','jawWeights',
        'measurementSigmaM','modelSigmaM','uncertaintyExplanation','correspondenceExplanation','registrationExplanation','experimentalDeclaration','sourceKind'}
    if not isinstance(declaration,dict) or set(declaration)!=expected or declaration['experimentalDeclaration'] is not True:
        raise ValueError('Complete the explicit experimental geometry declaration in the app')
    if declaration['sourceKind'] not in ('human-observation','development-fixture'):raise ValueError('Declare human observation or development fixture evidence')
    for field in ('referenceMappingExplanation','uncertaintyExplanation','correspondenceExplanation','registrationExplanation'):
        if not isinstance(declaration[field],str) or not 3<=len(declaration[field].strip())<=2000:raise ValueError('Explain '+field+' without claiming calibrated certainty')
    seal(output/'experimental-declaration.json',declaration)
    sha=digest((output/'experimental-declaration.json').read_bytes())
    return {'schema_version':'experimental-rear-lidar-lip-1','model_id':snapshot['model_id'],'snapshot_sha256':digest(_encode(snapshot)),
        'capture_id':capture['captureId'],'manifest_sha256':capture['manifestSha256'],'frame_sequence':declaration['frameSequence'],
        'depth_to_reference':declaration['depthToReference'],'reference_mapping_id':'user-declared-map:'+sha,
        'registration':{'kind':'rigid-distance-invariant','evidence_id':'user-declared-registration:'+sha,'source_hashes':[sha]},
        'correspondence':{'operator_id':'vtl-upper4-lower5-vertex89-distance-v1','upper_surface_vertex':[4,89],'lower_surface_vertex':[5,89],
            'evidence_id':'user-declared-correspondence:'+sha,'source_hashes':[sha],'upper_uv':declaration['upperPixel'],'lower_uv':declaration['lowerPixel']},
        'pose':declaration['pose'],'JA_values':declaration['jawValues'],'JA_weights':declaration['jawWeights'],
        'measurement_sigma_m':declaration['measurementSigmaM'],'model_sigma_m':declaration['modelSigmaM'],
        'uncertainty_scope':declaration['uncertaintyExplanation']+'; other evidence consists of user experimental declarations, not independently validated calibration.',
        'source_kind':declaration['sourceKind']}



def geometry_export_job(backend, request, output):
    """Resume an export identity; advance only past retained terminal failures."""
    for attempt in range(32):
        prefix = output / f'geometry-attempt-{attempt:02d}'
        terminal_path = prefix.with_suffix('.terminal.json')
        key = output.name + '-geometry' + (f'-retry-{attempt}' if attempt else '')
        seal(prefix.with_suffix('.request.json'), {'request': request, 'idempotencyKey': key})
        saved = _json(terminal_path.read_bytes()) if terminal_path.exists() else None
        if saved and saved['status'] in ('failed', 'cancelled'):
            continue
        # Repeating submit recovers acceptance even if its response was lost.
        job = backend.submit(request, key)
        seal(prefix.with_suffix('.job.json'), {'jobId': job})
        terminal = wait(backend, job)
        if terminal['status'] not in ('succeeded', 'failed', 'cancelled'):
            raise ValueError('Geometry export has no terminal result; retry to resume it')
        seal(terminal_path, {'jobId': job, 'status': terminal['status'], 'error': terminal.get('error')})
        if terminal['status'] != 'succeeded':
            raise ValueError('Adopted model geometry export failed; retry starts a new export attempt')
        return job
    raise ValueError('Geometry export retry limit reached; adopted model and failed attempts remain retained')


def finish(backend,intent,output):
    command=intent['command'];key='session:'+digest(canonical([intent['sessionId'],command['command_id']]).encode())
    def owned(state):return next((j for j in state['jobs'] if j.get('key')==key),None)
    state=backend.execute({'action':'state'})['state'];record=owned(state)
    if not record and (not state['pending'] or state['pending'].get('key')!=key):
        if state['pending']:raise ValueError('Another scientific job is running; retry after it completes')
        if state.get('snapshot',{}).get('model_id')!=intent['parentModelId']:raise ValueError('Baseline changed before LiDAR submission; start a new fit')
        for attempt in range(3):
            try:state=backend.execute({**command,'expected_version':state['version']})['state'];break
            except Exception:
                state=backend.execute({'action':'state'})['state']
                if owned(state) or state['pending'] and state['pending'].get('key')==key:break
                if attempt==2:raise
    record=owned(state)
    if record is None:
        pending=state['pending']
        if not pending or pending.get('key')!=key:raise ValueError('No recoverable LiDAR session job')
        job=pending['job_id'];seal(output/'job.json',{'jobId':job,'key':key})
        try:wait(backend,job)
        except TimeoutError:backend.cancel(job);wait(backend,job)
        for attempt in range(3):
            state=backend.execute({'action':'state'})['state'];record=owned(state)
            if record:break
            try:
                state=backend.execute({'action':'collect_job','command_id':output.name+'-collect','expected_version':state['version'],'job_id':job})['state'];record=owned(state);break
            except Exception:
                if attempt==2:raise
    if record is None:raise ValueError('LiDAR job is not yet available; retry to recover it')
    seal(output/'terminal.json',{'jobId':record.get('job_id'),'status':record['status']})
    if record['status']!='succeeded':
        seal(output/'failure.json',{'reason':'LiDAR job failed; session released for a fresh attempt'})
        raise ValueError('LiDAR job failed; retry in the app')
    result=record['result'];seal(output/'result.json',result)
    if not (output/'session-ledger.json').exists():seal(output/'session-ledger.json',backend.execute({'action':'replay'}))
    adoption=next((r for r in state.get('lidar_fusions',[]) if r.get('job_id')==record['job_id']),None)
    if adoption is None:raise ValueError('LiDAR collection did not retain its authoritative adoption receipt')
    accepted=result['status']=='ranked' and adoption.get('model_updated') is True
    answer={'captureId':intent['captureId'],'importId':intent['importId'],'archiveSha256':intent['archiveSha256'],
        'sessionId':intent['sessionId'],'parentModelId':intent['parentModelId'],'modelId':adoption.get('model_id',intent['parentModelId']),
        'jobId':record['job_id'],'fitId':output.name,'status':'ranked' if accepted else 'rejected' if adoption.get('status')=='rejected' else result['status'],
        'reason':adoption.get('reason') or result.get('reason'),'result':result,'includedInFit':accepted,'adoption':adoption,'geometry':None}
    # Native geometry is a subsequent export. Preserve the authoritative adoption
    # first so a failed export cannot conceal a model update that already occurred.
    seal(output/'adoption-summary.json',answer)
    geometry=None
    if adoption.get('model_updated'):
        target_model=adoption['model_id'];hypothesis_id=result['with_depth_order'][0]
        anatomy=next(h['anatomy'] for h in intent['parentSnapshot']['hypotheses'] if h['hypothesis_id']==hypothesis_id)
        annotation=intent['command']['parameters']['annotation']
        request={'operation':'forward','session_id':intent['sessionId'],'model_id':target_model,
            'parameters':{'pose':annotation['pose'],'anatomy':anatomy,'articulation':{'JA':annotation['JA_values'][0]},'f0_hz':180.,'duration_s':.25}}
        seal(output/'geometry-request.json',request)
        geometry_path=output/'geometry-receipt.json'
        if geometry_path.exists():geometry=_json(geometry_path.read_bytes())
        elif state['snapshot']['model_id']==target_model:
            geometry_job=geometry_export_job(backend,request,output)
            forward=backend.result(geometry_job);bundle=backend.exports(geometry_job)
            if bundle.get('job_id')!=geometry_job:raise ValueError('Geometry export job identity differs')
            folder=output/'geometry';folder.mkdir(mode=0o700,exist_ok=True);files={}
            for name in EXPORTS:
                entry=bundle['files'][name];raw=base64.b64decode(entry['base64'],validate=True)
                if len(raw)!=entry['byteLength'] or digest(raw)!=entry['sha256'] or name!='manifest.json' and digest(raw)!=forward['files'][name]:raise ValueError('Geometry export hash mismatch')
                if name=='manifest.json' and _json(raw)!=forward:raise ValueError('Geometry manifest mismatch')
                path=folder/name
                if path.exists():
                    if path.read_bytes()!=raw:raise ValueError('Retained geometry changed')
                else:
                    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as stream:stream.write(raw)
                files[name]={'sha256':digest(raw),'byteLength':len(raw)}
            reference=Path(intent['referenceDirectory'])
            if reference.is_dir():
                from science.scripts.model_space_diff import pair
                seal(folder/'space-diff.json',pair(folder,reference));raw=(folder/'space-diff.json').read_bytes()
                files['space-diff.json']={'sha256':digest(raw),'byteLength':len(raw)}
            geometry={'modelId':target_model,'hypothesisId':hypothesis_id,'pose':annotation['pose'],'JA':annotation['JA_values'][0],
                'role':'Native adopted hypothesis at the first declared jaw pose; not observed internal geometry','files':files}
            seal(geometry_path,geometry)
    answer['geometry']=geometry
    seal(output/'summary.json',answer);return answer


def run(data_root,request_path,output):
    root,output=Path(data_root),Path(output);request=_json(Path(request_path).read_bytes());output.mkdir(parents=True,exist_ok=True,mode=0o700)
    with os.fdopen(os.open(output/'run.lock',os.O_RDWR|os.O_CREAT,0o600),'w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('This LiDAR fit is already running')
        intent_path=output/'intent.json'
        if intent_path.exists():
            intent=_json(intent_path.read_bytes())
            if intent['request']!=request:raise ValueError('LiDAR retry differs from original declaration')
        else:
            capture=_json((root/'lidar-current.json').read_bytes())
            if capture['captureId']!=request['captureId']:raise ValueError('Selected rear capture changed')
            current=_json((root/'science-current.json').read_bytes())
            if current.get('status')!='succeeded' or not re.fullmatch(r'[A-Za-z0-9_-]+',current.get('runId','')):raise ValueError('Complete a baseline voice fit first')
            voice=_json((root/'science-runs'/current['runId']/'summary.json').read_bytes())
            with backend_for(output,voice['sessionId']) as backend:
                state=backend.execute({'action':'state'})['state'];snapshot=state.get('snapshot')
                if not snapshot or snapshot['model_id']!=request['expectedModelId']:raise ValueError('Baseline changed; refresh before fitting')
                annotation=annotation_for(request['annotation'],snapshot,capture,output)
                archive=root/'lidar-imports'/capture['importId']/'original.zip'
                if digest(archive.read_bytes())!=capture['archiveSha256']:raise ValueError('Original rear archive changed before fusion')
                params={'capture_directory':str(root/'lidar-imports'/capture['importId']/'capture'),'annotation':annotation,'enabled':True,'max_geometry_calls':96}
                intent={'request':request,'captureId':capture['captureId'],'importId':capture['importId'],'archiveSha256':capture['archiveSha256'],
                    'parentSnapshot':snapshot,'referenceDirectory':str(root/'science-runs'/current['runId']/'reference'),
                    'sessionId':voice['sessionId'],'parentModelId':snapshot['model_id'],'command':{'action':'fit_lidar','command_id':output.name+'-fit','parameters':params}}
                seal(intent_path,intent)
        with backend_for(output,intent['sessionId']) as backend:return finish(backend,intent,output)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--operation',choices=['import','frame','fit'],required=True);p.add_argument('--data-root',required=True)
    p.add_argument('--capture-id');p.add_argument('--sequence',type=int);p.add_argument('--request');p.add_argument('--output');a=p.parse_args()
    if a.operation=='import':value=prepare(a.data_root)
    elif a.operation=='frame':value=frame_data(a.data_root,a.capture_id,a.sequence)
    else:value=run(a.data_root,a.request,a.output)
    print(json.dumps(value,allow_nan=False))
