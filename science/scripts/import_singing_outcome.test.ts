import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

test('original native outcome reaches committed session update, replay and rejection paths', () => {
 const script = `
import hashlib,json,os,tempfile,time
from pathlib import Path
from datetime import datetime,timezone
from singing_physics.engine import Engine
from singing_physics.service import JobService
from singing_physics.session import SessionController
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.pcm_inverse import FEATURES,resample_native_pcm
import subprocess

def now(): return datetime.now(timezone.utc).isoformat()
def sha(b): return hashlib.sha256(b).hexdigest()
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp)
 rate=int(os.environ.get('OUTCOME_TEST_RATE','44100'));start=round(rate*.1);size=4096 if rate<96000 else 8192
 profile=dict(sample_rate_hz=rate,frame_start_sample=start,frame_size=size,duration_s=.25)
 with Engine() as e: provenance=e.provenance
 snapshot=freeze_pcm_hypotheses(model_id='initial',evidence_ids=['past'],evidence_hashes=['a'*64],provenance=provenance,hypotheses=[{'hypothesis_id':'one','anatomy':{'hard_palate_length':4.2}},{'hypothesis_id':'two','anatomy':{'hard_palate_length':4.8}}],frozen_at=now()).data
 with JobService(root/'jobs') as service:
  controller=SessionController(root/'sessions',service,'session')
  def send(action,**fields):
   version=controller.execute({'action':'state'})['state']['version']
   return controller.execute(dict(action=action,command_id=str(version)+action,expected_version=version,**fields))['state']
  def collect():
   current=controller.execute({'action':'state'})['state'];assert current['pending'],current
   job=current['pending']['job_id']
   assert service.wait(job,timeout_s=60)['status']=='succeeded',service.status(job)
   return send('collect_job',job_id=job)
  send('register_model',snapshot=snapshot)
  send('propose_design',parameters={'design_id':'design','target_observation_id':'target','experiments':[{'experiment_id':'a','pose':'a','JA':-2.,'f0_hz':180.,'gain':.1}], 'feature_scales':{name:{'unit':unit,'scale':scale,'assumption':'Declared test engineering scale'} for name,(unit,scale) in FEATURES.items()},'minimum_separation':.000001,'max_synthesis_calls':4,'profile':profile})
  state=collect()
  statebytes=json.dumps({'state':state}).encode();(root/'state.json').write_bytes(statebytes)
  capture=root/'capture';capture.mkdir()
  started=now()
  with Engine() as e:
   e.set_anatomy({'hard_palate_length':4.2})
   pcm=resample_native_pcm(e.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.25),44100,rate)[0]*.1
  raw=pcm.astype('<f4').tobytes();(capture/'voice.raw').write_bytes(raw)
  count=len(pcm)
  def stamp(v):return dict(value=v,timescale=rate,epoch=0,flags=1,seconds=v/rate)
  manifest=dict(schema_version='singing-native-rgbd-1.0.0',capture_mode='one-held-pose',capture_id='outcome-fixture',created_at=started,task='Synthetic native forward fixture',device=dict(device_type='AVCaptureDeviceTypeBuiltInTrueDepthCamera',position='front',output_mirrored=False),frames=[],audio=dict(samples=[dict(presentation_timestamp=stamp(rate),duration=stamp(count),num_samples=count,gap_before_seconds=None,artifact=dict(path='voice.raw',bytes=len(raw),sha256=sha(raw)),asbd=dict(sample_rate=rate,format_id=1819304813,format_flags=9,bytes_per_packet=4,frames_per_packet=1,bytes_per_frame=4,channels_per_frame=1,bits_per_channel=32))]))
  mb=json.dumps(manifest).encode();(capture/'manifest.json').write_bytes(mb)
  config=dict(kind='singing_outcome_import_configuration',schema_version='0.1.0',command_id='outcome-import',participant_id='fixture-participant',session_id='session',design_id='design',experiment_id='a',observation_id='target',artifact_id='new-outcome-frame',pose='a',expected_version=state['version'],segment_index=0,frame_start_sample=start,recording_kind='ordinary-singing',contains_external_excitation=False,evidence_kind='development-fixture',session_state_artifact=dict(path='state.json',sha256=sha(statebytes),byteCount=len(statebytes)),source_manifest_sha256=sha(mb))
  cp=root/'config.json';cp.write_text(json.dumps(config))
  def run(out):return subprocess.run([os.environ['OUTCOME_NODE'],'--experimental-strip-types',os.environ['OUTCOME_SCRIPT'],str(capture),str(root/out),str(cp)],capture_output=True,text=True)
  done=run('out');assert done.returncode==0,done.stderr
  command=json.loads((root/'out/singing-outcome-command.json').read_text())
  assert command['parameters']['observed_at']==started
  assert command['parameters']['pcm']==pcm[start:start+size].astype('float32').tolist()
  controller.execute(command);final=collect()
  assert final['snapshot']['model_id']!=snapshot['model_id']
  assert 'target' in final['snapshot']['evidence_ids']
  replay=controller.execute({'action':'replay'})
  assert SessionController(root/'sessions',service,'session').execute({'action':'replay'})==replay
  config['session_id']='other';cp.write_text(json.dumps(config));bad=run('wrongsession');assert bad.returncode!=0 and 'identity/version' in bad.stderr
  config['session_id']='session'
  config['pose']='i';cp.write_text(json.dumps(config));bad=run('badpose');assert bad.returncode!=0 and 'pose' in bad.stderr
  config['pose']='a';manifest['created_at']='2020-01-01T00:00:00Z';mb=json.dumps(manifest).encode();(capture/'manifest.json').write_bytes(mb);config['source_manifest_sha256']=sha(mb);cp.write_text(json.dumps(config));bad=run('old');assert bad.returncode!=0 and 'capture start' in bad.stderr
  print('native-outcome-controller-update-replay-passed')
`
 for (const rate of [44100,48000]) {
 const output = execFileSync(process.env.OUTCOME_PYTHON ?? 'python3', ['-c', script], { encoding: 'utf8', timeout: 90000, env: { ...process.env, OUTCOME_TEST_RATE: String(rate), OUTCOME_NODE: process.execPath, OUTCOME_SCRIPT: resolve('science/scripts/import_singing_outcome.ts') } })
 assert.match(output, /native-outcome-controller-update-replay-passed/)
 console.log(`${rate}: ${output.trim()}`)
 }
})
