#!/usr/bin/env -S node --experimental-strip-types
import { constants } from 'node:fs'
import { open, realpath, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { audioFrameSize, extractAudioMeasurement } from '../../src/lib/audio.ts'
import { importNativePcm } from './import_native_pcm.ts'

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
function check(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message) }
const id = (v: unknown) => typeof v === 'string' && !!v.trim()
async function read(root: string, name: string, limit = 64 * 1024 * 1024) {
  check(typeof name === 'string' && basename(name) === name && /^[\w][\w.-]*$/.test(name), 'Unsafe artifact path')
  const file = await open(resolve(root, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const st = await file.stat(); check(st.isFile() && st.size <= limit, 'Invalid artifact size/type'); const bytes = await file.readFile(); check(bytes.length === st.size, 'Artifact changed during read'); return bytes } finally { await file.close() }
}

export async function importSingingOutcome(captureDirectory: string, outputDirectory: string, configPath: string) {
  const root = await realpath(captureDirectory), configRoot = await realpath(dirname(resolve(configPath)))
  const configBytes = await read(configRoot, basename(configPath), 2 * 1024 * 1024), c = JSON.parse(configBytes.toString())
  check(c.kind === 'singing_outcome_import_configuration' && c.schema_version === '0.1.0', 'Unsupported outcome configuration')
  for (const key of ['command_id', 'participant_id', 'session_id', 'design_id', 'experiment_id', 'observation_id', 'artifact_id', 'pose']) check(id(c[key]), `Explicit ${key} required`)
  check(c.observation_id !== c.artifact_id && Number.isSafeInteger(c.expected_version) && c.expected_version >= 0, 'Invalid command version/identities')
  check(Number.isSafeInteger(c.segment_index) && c.segment_index >= 0 && Number.isSafeInteger(c.frame_start_sample) && c.frame_start_sample >= 0, 'Select explicit segment and prospective start sample')
  check(c.recording_kind === 'ordinary-singing' && c.contains_external_excitation === false && ['human-observation', 'development-fixture'].includes(c.evidence_kind), 'Explicit ordinary singing provenance required')
  const binding = c.session_state_artifact
  check(binding && /^[a-f0-9]{64}$/.test(binding.sha256) && Number.isSafeInteger(binding.byteCount), 'Bound committed session-state artifact required')
  const stateBytes = await read(configRoot, binding.path, 2 * 1024 * 1024)
  check(stateBytes.length === binding.byteCount && hash(stateBytes) === binding.sha256, 'Session-state artifact hash/size mismatch')
  const exported = JSON.parse(stateBytes.toString()), state = exported.state ?? exported
  check(state.version === c.expected_version && state.session_id === c.session_id, 'Configuration identity/version differs from bound session state')
  const design = state.designs?.[c.design_id]
  check(state.snapshot?.model_id && design?.data?.model_id === state.snapshot.model_id && design?.status === 'committed' && design.data?.target_observation_id === c.observation_id && design.data?.selected_experiment_id === c.experiment_id, 'Committed design/target/experiment mismatch')
  const experiment = design.data.rankings?.find((r: any) => r.experiment?.experiment_id === c.experiment_id)?.experiment
  check(experiment?.pose === c.pose, 'Declared pose differs from selected frozen experiment')
  const profile = design.data.profile
  check(profile && [44100, 48000, 96000].includes(profile.sample_rate_hz) && Number.isSafeInteger(profile.frame_start_sample) && profile.frame_start_sample >= 0 && Number.isSafeInteger(profile.frame_size) && profile.frame_size > 0 && profile.frame_size <= 16384 && Number.isFinite(profile.duration_s) && profile.duration_s >= .1 && profile.duration_s <= 5 && c.frame_start_sample === profile.frame_start_sample, 'Unsupported or mismatched frozen outcome profile')
  check(profile.frame_size === audioFrameSize(profile.sample_rate_hz) && profile.frame_start_sample + profile.frame_size <= Math.floor(profile.duration_s * profile.sample_rate_hz), 'Frozen frame dimensions differ from canonical extractor')
  const start = profile.frame_start_sample, end = start + profile.frame_size
  const manifestBytes = await read(root, 'manifest.json'), native = JSON.parse(manifestBytes.toString())
  check(hash(manifestBytes) === c.source_manifest_sha256, 'Original native manifest binding mismatch')
  check(native.schema_version === 'singing-native-rgbd-1.0.0' && !native.drive && !native.protocol && native.containsProbe !== true && native.audio?.containsProbe !== true && native.contains_external_excitation !== true, 'Probe/external excitation cannot enter singing outcome')
  if (native.pose !== undefined) check(native.pose === c.pose, 'Native pose mismatch')
  const started = Date.parse(native.created_at), committed = Date.parse(design.committed_at)
  check(Number.isFinite(started) && Number.isFinite(committed) && started > committed && started <= Date.now(), 'Native capture start must follow design commitment and precede import')
  const out = resolve(outputDirectory); await mkdir(dirname(out), { recursive: true }); await mkdir(out, { mode: 0o700 })
  const nativeOut = resolve(out, 'native-pcm')
  const imported = await importNativePcm(root, nativeOut, { participantId: c.participant_id, sessionId: c.session_id, evidenceKind: c.evidence_kind })
  check(imported.source_manifest_sha256 === c.source_manifest_sha256, 'Native manifest changed during import')
  for (const a of imported.source_import.records[0].artifacts) { const bytes = await read(root, a.uri); check(bytes.length === a.byteLength && hash(bytes) === a.sha256, 'Original bytes changed after validation') }
  const segment = imported.segments[c.segment_index]; check(segment, 'Selected segment missing')
  const bytes = await read(nativeOut, segment.derived_artifact.uri)
  check(hash(bytes) === segment.derived_artifact.sha256 && bytes.length === segment.derived_artifact.byteLength, 'Derived PCM hash/size mismatch')
  const reasons: string[] = []
  if (segment.sample_rate_hz !== profile.sample_rate_hz) reasons.push('Source rate differs from frozen outcome profile; no resampling or profile substitution')
  if (segment.sample_count < end) reasons.push('Selected segment does not contain complete prospective window')
  let pcm: number[] = [], frameHash: string | null = null
  if (!reasons.length) {
    const frame = bytes.subarray(start * 4, end * 4); frameHash = hash(frame)
    pcm = Array.from({ length: profile.frame_size }, (_, i) => frame.readFloatLE(i * 4))
    const observation = imported.records.find(r => r.kind === 'observation' && r.id === segment.segment_id)
    check(observation?.kind === 'observation', 'Derived source observation missing')
    const timebase = observation.streams.find(stream => stream.modality === 'audio')!.timebase
    const measurement = extractAudioMeasurement(Float32Array.from(pcm), profile.sample_rate_hz, { id: c.observation_id + ':import-canonical', observationId: segment.segment_id, artifactId: segment.derived_artifact.id, startMs: start / profile.sample_rate_hz * 1000, timebase, sourceKind: c.evidence_kind, sourceHashes: [segment.derived_artifact.sha256], qualityFlags: ['native-source-bound-crop', ...(pcm.some(x => Math.abs(x) >= .995) ? ['clipping'] : [])] })
    if (measurement.quality.missingReason) reasons.push(measurement.quality.missingReason)
    reasons.push(...measurement.quality.flags.filter(f => ['clipping', 'invalid', 'dropped', 'low-signal-to-noise'].includes(f)))
    if (state.snapshot?.evidence_hashes?.includes(frameHash) || [c.observation_id, c.artifact_id, c.observation_id + ':canonical'].some(x => state.snapshot?.evidence_ids?.includes(x))) reasons.push('Outcome reuses prior source evidence')
  }
  const command = reasons.length ? null : { action: 'submit_outcome', command_id: c.command_id, expected_version: c.expected_version, design_id: c.design_id,
    parameters: { experiment_id: c.experiment_id, observation_id: c.observation_id, artifact_id: c.artifact_id, observed_at: native.created_at, pcm, sample_rate_hz: profile.sample_rate_hz, frame_start_sample: start, frame_size: profile.frame_size,
      source_kind: c.evidence_kind === 'development-fixture' ? 'engine-generated' : 'human-observation' } }
  const receipt = { kind: 'singing_outcome_import_receipt', schema_version: '0.1.0', eligible_for_submission: !!command, submitted: false, reasons,
    source_manifest_sha256: imported.source_manifest_sha256, configuration_sha256: hash(configBytes), session_state_sha256: hash(stateBytes), frame_sha256: frameHash,
    selected_segment: segment, selected_window: { start_sample: start, frame_size: profile.frame_size, sample_rate_hz: segment.sample_rate_hz }, cuts: imported.cuts,
    evidence_kind: c.evidence_kind, observed_at: native.created_at, timestamp_scope: 'Native-declared capture start UTC, not inferred UTC of the selected sample; source sample clock retained separately',
    limitations: ['Package hashes verify consistency, not device or UTC-clock authenticity.', 'No resampling, fabricated timing, probe-to-singing substitution or measured execution control claim.', 'Development fixture maps to the existing synthetic engine-generated update label; receipt retains original development-fixture kind.'] }
  for (const [name, value] of Object.entries({ 'singing-outcome-command.json': command, 'singing-outcome-receipt.json': receipt })) await writeFile(resolve(out, name), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
  await writeFile(resolve(out, 'singing-outcome-configuration.json'), configBytes, { mode: 0o600, flag: 'wx' })
  return { command, receipt }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [capture, output, config] = process.argv.slice(2)
  if (!capture || !output || !config) throw Error('Usage: import_singing_outcome.ts RAW_NATIVE_CAPTURE FRESH_PRIVATE_OUTPUT CONFIG_JSON')
  console.log(JSON.stringify((await importSingingOutcome(capture, output, config)).receipt, null, 2))
}
