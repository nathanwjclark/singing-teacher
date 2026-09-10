import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { importSingingSession } from './import_singing_session.ts'

async function fixture(amplitude = .1) {
  const root = await mkdtemp(join(tmpdir(), 'ordinary-singing-')), capture = join(root, 'original')
  await mkdir(capture)
  const rate = 48000, count = 14400, raw = Buffer.alloc(count * 4)
  for (let i = 0; i < count; i++) raw.writeFloatLE(amplitude * Math.sin(2 * Math.PI * 180 * i / rate), i * 4)
  await writeFile(join(capture, 'ordinary.pcm.raw'), raw)
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  const stamp = (value: number) => ({ value, timescale: rate, epoch: 0, flags: 1, seconds: value / rate })
  const manifest: any = { schema_version: 'singing-native-rgbd-1.0.0', capture_mode: 'one-held-pose', capture_id: 'ordinary-software-fixture', created_at: '2026-01-01T00:00:00Z',
    task: 'Software sine PCM for ingestion validation; not phone evidence', device: { device_type: 'AVCaptureDeviceTypeBuiltInTrueDepthCamera', position: 'front', output_mirrored: false }, frames: [],
    audio: { samples: [{ presentation_timestamp: stamp(rate), duration: stamp(count), num_samples: count, gap_before_seconds: null, artifact: { path: 'ordinary.pcm.raw', bytes: raw.length, sha256: sha(raw) }, asbd: { sample_rate: rate, format_id: 1819304813, format_flags: 9, bytes_per_packet: 4, frames_per_packet: 1, bytes_per_frame: 4, channels_per_frame: 1, bits_per_channel: 32 } }] } }
  const bytes = Buffer.from(JSON.stringify(manifest)); await writeFile(join(capture, 'manifest.json'), bytes)
  const config: any = { schema_version: '0.1.0', kind: 'singing_session_import_configuration', source_manifest_sha256: sha(bytes), participant_id: 'fixture-participant', session_id: 'fixture-session', evidence_kind: 'development-fixture', recording_kind: 'ordinary-singing', contains_external_excitation: false, expected_session_version: 0, command_id: 'import-calibration-1',
    selections: [{ trial_id: 'sing', segment_index: 0, frame_start_sample: 4800, pose: 'a', execution_controls: 'unknown' }],
    candidates: [4.2, 4.8].map(length => ({ candidate_id: String(length), anatomy: { hard_palate_length: length }, trials: { sing: { JA: -2, f0_hz: 180, gain: .1 } } })), max_synthesis_calls: 4 }
  const configPath = join(root, 'configuration.json')
  const save = async () => { const b = Buffer.from(JSON.stringify(manifest)); await writeFile(join(capture, 'manifest.json'), b); config.source_manifest_sha256 = sha(b); await writeFile(configPath, JSON.stringify(config)) }
  await save(); return { root, capture, config, configPath, manifest, save }
}

test('original PCM reaches actual fit and session ingestion payload without fixture factories', async () => {
  const f = await fixture(), out = join(f.root, 'imported'), result = await importSingingSession(f.capture, out, f.configPath)
  assert.equal(result.receipt.eligible_for_fit, true)
  assert.equal(result.session_command!.action, 'ingest_calibration')
  assert.equal(result.session_command!.command_id, 'import-calibration-1')
  assert.equal(result.observations.trials[0].frame_start_sample, 4800)
  assert.equal(result.observations.trials[0].measurement.timebase.syncUncertaintyMs, null)
  assert.equal((await stat(out)).mode & 0o777, 0o700)
  assert.equal((await stat(join(out, 'singing-fit-params.json'))).mode & 0o777, 0o600)
  const code = `import json,os\nfrom singing_physics.engine import Engine\nfrom singing_physics.pcm_inverse import fit_pcm\np=json.load(open(os.environ['FIT_INPUT']))\nwith Engine() as e:\n r=fit_pcm(e,p['observations'],candidates=p['candidates'],max_synthesis_calls=p['max_synthesis_calls'],node_binary=os.environ['FIT_NODE'])\n assert r['actual_synthesis_calls']==4, r\n assert len(r['joint']['candidates'])==2\n print(json.dumps({'calls':r['actual_synthesis_calls'],'statuses':[x['status'] for x in r['joint']['candidates']]}))`
  const output = execFileSync(process.env.SINGING_PYTHON ?? 'python3', ['-c', code], { encoding: 'utf8', timeout: 60000, env: { ...process.env, FIT_NODE: process.execPath, FIT_INPUT: join(out, 'singing-fit-params.json') } })
  assert.match(output, /"calls": 4/); console.log(output.trim())
  const ingest = `import json,os,tempfile
from singing_physics.session import SessionController
from singing_physics.service import JobService
command=json.load(open(os.environ['SESSION_COMMAND']))
with tempfile.TemporaryDirectory() as root:
 with JobService(root+'/jobs') as service:
  controller=SessionController(root+'/sessions',service,'fixture-session')
  result=controller.execute(command)
  assert result['state']['calibration']==command['document']
  assert result['state']['version']==1
  assert controller.execute(command)['state']['version']==1
  print('native48k-session-ingestion-replay-passed')`
  const ingested = execFileSync(process.env.SINGING_PYTHON ?? 'python3', ['-c', ingest], { encoding: 'utf8', timeout: 60000, env: { ...process.env, SESSION_COMMAND: join(out, 'singing-session-command.json') } })
  assert.match(ingested, /ingestion-replay-passed/)
  console.log(ingested.trim())
  await assert.rejects(importSingingSession(f.capture, out, f.configPath), /EEXIST/)
})

test('duplicate and overlapping source windows reject; clipping and unavailable starts retained', async () => {
  const f = await fixture()
  f.config.selections.push({ ...f.config.selections[0], trial_id: 'alias' }); f.config.max_synthesis_calls = 8
  f.config.candidates.forEach((c: any) => { c.trials.alias = c.trials.sing }); await f.save()
  await assert.rejects(importSingingSession(f.capture, join(f.root, 'duplicate'), f.configPath), /overlapping/)
  const clipped = await fixture(1)
  const result = await importSingingSession(clipped.capture, join(clipped.root, 'clipped'), clipped.configPath)
  assert.equal(result.fit_params, null); assert.ok(result.receipt.selections[0].reasons.includes('clipping'))
  const missing = await fixture(); missing.config.selections[0].frame_start_sample = 1; await missing.save()
  const absent = await importSingingSession(missing.capture, join(missing.root, 'missing'), missing.configPath)
  assert.equal(absent.fit_params, null); assert.match(absent.receipt.selections[0].reasons.join(), /canonical window/)
})

test('source-bound configuration, probe exclusion and corrupt original bytes', async () => {
  const f = await fixture(); f.config.source_manifest_sha256 = 'a'.repeat(64); await writeFile(f.configPath, JSON.stringify(f.config))
  await assert.rejects(importSingingSession(f.capture, join(f.root, 'binding'), f.configPath), /bind original/)
  f.manifest.containsProbe = true; await f.save()
  await assert.rejects(importSingingSession(f.capture, join(f.root, 'probe'), f.configPath), /probe/)
  delete f.manifest.containsProbe; await f.save()
  const bytes = await readFile(join(f.capture, 'ordinary.pcm.raw')); bytes[0] ^= 1; await writeFile(join(f.capture, 'ordinary.pcm.raw'), bytes)
  await assert.rejects(importSingingSession(f.capture, join(f.root, 'corrupt'), f.configPath), /hash/)
})

test('session command identity and native fitter budget are validated', async () => {
  const f = await fixture(); f.config.max_synthesis_calls = 641; await f.save()
  await assert.rejects(importSingingSession(f.capture, join(f.root, 'budget'), f.configPath), /budget/)
  f.config.max_synthesis_calls = 4; delete f.config.command_id; await f.save()
  await assert.rejects(importSingingSession(f.capture, join(f.root, 'command'), f.configPath), /command_id/)
})
