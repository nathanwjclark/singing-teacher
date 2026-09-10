"""Export a paired teaching view of an existing, already committed PCM design."""
import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re

import numpy as np
from scipy.io import wavfile

from live_capture_jobs import HTTPBackend, wait
from singing_physics.pcm_inverse import resample_native_pcm, extract_pcm


def sha(raw):return hashlib.sha256(raw).hexdigest()
def digest(value):return sha(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode())
def read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>64_000_000:raise ValueError('Teaching artifact unavailable')
    return path.read_bytes()
def load(path):return json.loads(read(path))
def save(path,value):
    raw=json.dumps(value,allow_nan=False).encode()
    if path.exists():
        if read(path)!=raw:raise ValueError('Frozen teaching artifact changed')
    else:path.write_bytes(raw);path.chmod(0o600)


def run(root,output,request,*,backend=None,audio_enabled=False):
    current=load(root/'science-current.json');run_id=current.get('runId','')
    if current.get('status')!='succeeded' or not re.fullmatch(r'run-[A-Za-z0-9_-]+',run_id):raise ValueError('A completed voice fit is required')
    directory=root/'science-runs'/run_id;summary=load(directory/'summary.json')
    if request.get('demonstrationId')!='tongue-jaw-vowels':raise ValueError('This mechanism has educational support only')
    if (directory/'astra-rest.json').exists():raise ValueError('Astra selected rest')
    pointer=load(directory/'astra-current.json') if (directory/'astra-current.json').exists() else summary
    if any(request.get(key)!=pointer.get(key) for key in ('modelId','designId')):raise ValueError('Requested teaching design is not current')
    backend=backend or HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],summary['sessionId'])
    state=backend.execute({'action':'state'})['state'];snapshot=state.get('snapshot');design=state.get('designs',{}).get(request['designId'])
    if state.get('pending') or not snapshot or snapshot['model_id']!=request['modelId'] or not design or design['status']!='committed':raise ValueError('A current committed recording design is required')
    frozen=design['data'];forecast_hash=digest(frozen)
    if frozen['model_id']!=snapshot['model_id'] or frozen['hypothesis_snapshot_sha256']!=digest(snapshot):raise ValueError('Forecast snapshot binding mismatch')
    after=next((row for row in frozen['rankings'] if row['experiment']['experiment_id']==frozen['selected_experiment_id']),None)
    before=next((row for row in frozen['rankings'] if after and row['experiment']['pose']!=after['experiment']['pose'] and all(row['experiment'][key]==after['experiment'][key] for key in ('JA','f0_hz','gain'))),None)
    if before is None or after is None:raise ValueError('No matched-source vowel pair exists in this frozen forecast')
    hypothesis=snapshot['hypotheses'][0]
    if any(not any(p['hypothesis_id']==hypothesis['hypothesis_id'] for p in row['predictions']) for row in (before,after)):raise ValueError('Paired candidate predictions unavailable')
    intent={'request':request,'runId':run_id,'sessionId':summary['sessionId'],'snapshotSha256':digest(snapshot),
        'forecastSha256':forecast_hash,'audioEnabled':audio_enabled}
    output.mkdir(parents=True,exist_ok=True,mode=0o700);save(output/'intent.json',intent)
    if (output/'result.json').exists():
        result=load(output/'result.json')
        for name,entry in result['files'].items():
            raw=read(output/name)
            if sha(raw)!=entry['sha256'] or len(raw)!=entry['byteLength']:raise ValueError('Teaching asset integrity mismatch')
        return result
    files={};sides={};playback={};audio_reason='Model synthesis playback is disabled';audio_ok=audio_enabled
    def artifact(name,raw):
        path=output/name
        if path.exists() and read(path)!=raw:raise ValueError('Teaching export changed')
        if not path.exists():path.write_bytes(raw);path.chmod(0o600)
        entry={'name':name,'sha256':sha(raw),'byteLength':len(raw)};files[name]=entry;return entry
    for side,row in (('before',before),('after',after)):
        experiment=row['experiment'];prediction=next(p for p in row['predictions'] if p['hypothesis_id']==hypothesis['hypothesis_id'])
        native_request={'operation':'forward','session_id':summary['sessionId'],'model_id':snapshot['model_id'],
            'parameters':{'pose':experiment['pose'],'anatomy':hypothesis['anatomy'],'articulation':{'JA':experiment['JA']},
                'f0_hz':experiment['f0_hz'],'duration_s':frozen['profile']['duration_s']}}
        job=backend.submit(native_request,'teaching:'+output.name+':'+side)
        status=wait(backend,job)
        if status['status']!='succeeded':raise ValueError('Native teaching export failed')
        result=backend.result(job);bundle=backend.exports(job)
        if bundle.get('job_id')!=job or result.get('provenance')!=frozen['provenance'] or result.get('articulation')!=prediction['native_controls']:raise ValueError('Native teaching operator differs from frozen prediction')
        exported={}
        for name in ('tract.svg','geometry.json')+ (('audio.wav',) if audio_enabled and 'audio.wav' in bundle['files'] else ()):
            entry=bundle['files'][name];raw=base64.b64decode(entry['base64'],validate=True)
            if sha(raw)!=entry['sha256'] or len(raw)!=entry['byteLength'] or sha(raw)!=result['files'][name]:raise ValueError('Native teaching export integrity mismatch')
            exported[name]=raw
        sides[side]={'experimentId':experiment['experiment_id'],'pose':experiment['pose'],
            'controls':{key:experiment[key] for key in ('JA','f0_hz','gain')},'jobId':job,
            'geometry':{'svg':artifact(side+'-tract.svg',exported['tract.svg']),'data':artifact(side+'-geometry.json',exported['geometry.json'])},
            'prediction':{'canonical':deepcopy(prediction['canonical']),'features':deepcopy(prediction['features']),
                'missingReason':prediction['missing_reason'],'alternatives':deepcopy(row['predictions'])}}
        if audio_enabled:
            try:
                if 'audio.wav' not in exported:raise ValueError('Native audio export unavailable')
                rate,pcm=wavfile.read(io.BytesIO(exported['audio.wav']));profile=frozen['profile']
                pcm,resampling=resample_native_pcm(pcm,rate,profile['sample_rate_hz']);pcm=pcm*experiment['gain']
                start=profile['frame_start_sample'];frame=pcm[start:start+profile['frame_size']]
                measured=extract_pcm(frame,profile['sample_rate_hz'],measurement_id='teaching-'+side,
                    observation_id=frozen['target_observation_id'],artifact_id='teaching-synthesis-'+side,
                    start_ms=start/profile['sample_rate_hz']*1000)
                original=prediction['canonical']['measurement']['measurements']
                replay=measured['measurement']['measurements']
                if any(measured.get(k)!=v for k,v in frozen['extractor'].items()) or len(original)!=len(replay):
                    raise ValueError('Playback extractor differs from the frozen forecast')
                for expected,actual in zip(original,replay):
                    left,right=expected.get('value'),actual.get('value')
                    if expected.get('name')!=actual.get('name') or expected.get('unit')!=actual.get('unit') or (left is None)!=(right is None) or left is not None and not np.isclose(left,right,rtol=1e-5,atol=1e-5):
                        raise ValueError('Playback synthesis differs from frozen descriptors beyond float32 export tolerance')
                playback[side]=(pcm,profile['sample_rate_hz'])
                sides[side]['audioProvenance']={'nativeWavSha256':sha(exported['audio.wav']),'resampling':resampling,
                    'forecastGain':experiment['gain'],'extractor':deepcopy(frozen['extractor'])}
            except (ValueError,RuntimeError,OSError) as error:audio_ok=False;audio_reason='Matched model playback unavailable: '+str(error)
    latest=backend.execute({'action':'state'})['state']
    if latest.get('snapshot',{}).get('model_id')!=snapshot['model_id'] or latest['designs'].get(request['designId'],{}).get('status')!='committed' or digest(latest['designs'][request['designId']]['data'])!=forecast_hash:raise ValueError('Teaching design changed during export')
    normalized=None
    if audio_ok:
        peak=max(float(np.max(np.abs(pcm))) for pcm,_ in playback.values());gain=min(1.,.8/peak) if peak else 1.
        for side,(pcm,rate) in playback.items():
            stream=io.BytesIO();wavfile.write(stream,rate,(pcm*gain).astype(np.float32));sides[side]['audio']=artifact(side+'-audio.wav',stream.getvalue())
        normalized={'gainApplied':gain,'normalization':'Common peak attenuation for explicit playback only','storedMeasurementsUnchanged':True}
    available=all(sides[side]['prediction']['features'] is not None for side in sides)
    result={'schemaVersion':'visual-teaching-model-1','demonstrationVersion':'visual-teaching-1',
        'demonstrationId':'tongue-jaw-vowels','evidenceMode':'model-prediction','attemptId':output.name,
        'runId':run_id,'sessionId':summary['sessionId'],'modelId':snapshot['model_id'],'designId':request['designId'],
        'targetObservationId':frozen['target_observation_id'],'committedAt':design['committed_at'],'forecastSha256':forecast_hash,
        'frozenForecast':deepcopy(frozen),'createdAt':datetime.now(timezone.utc).isoformat(),'hypothesisId':hypothesis['hypothesis_id'],
        'hypothesisCount':len(snapshot['hypotheses']),'files':files,**sides,
        'capabilities':{'geometry':{'available':True},'acoustics':{'available':available,'reason':None if available else 'Some frozen acoustic features are unavailable'},
            'synthesis':{'available':audio_ok,'reason':None if audio_ok else audio_reason}},'playback':normalized,
        'parameterRoles':{'anatomy':'Retained candidate hypothesis, not a scan','vowel':'Native library articulation','JA':'Declared fixed simulator control','source':'Geometric-glottis source at matched declared pitch and gain'},
        'assumptions':['Before and after are model conditions, not recordings of your movement.',
            'The before vowel is a matched reference condition; the after vowel is the already committed recording target.',
            'Surfaces combine candidate anatomy and fixed native templates; hidden movement is not verified.',
            'Canonical microphone-style descriptors are compared with the same extractor; no transfer curve is substituted.',
            'Model synthesis is not your future voice. Cartilage motion and nasal coupling remain educational-only.'],
        'sources':[{'title':'Native VocalTractLab forward export','kind':'model-generated','license':'Dependency terms retained; scientific adapter AGPL-3.0-or-later','reference':'science/README.md#licensing'}],
        'nativeProvenance':frozen['provenance']}
    save(output/'result.json',result);return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--request',type=Path,required=True);parser.add_argument('--audio',action='store_true');args=parser.parse_args()
    run(args.data_root.resolve(),args.output.resolve(),load(args.request),audio_enabled=args.audio)
