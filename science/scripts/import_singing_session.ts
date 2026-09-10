#!/usr/bin/env -S node --experimental-strip-types
import { constants } from 'node:fs'
import { open, realpath, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { importNativePcm } from './import_native_pcm.ts'
import type { AudioMeasurement } from '../../src/contracts/index.ts'

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const id = (x: unknown): x is string => typeof x === 'string' && !!x.trim()
function check(ok: unknown, why: string): asserts ok { if (!ok) throw Error(why) }
async function read(root: string, name: string, limit = 64 * 1024 * 1024) {
  check(typeof name === 'string' && name === basename(name) && /^[\w][\w.-]*$/.test(name), 'Unsafe local path')
  const f = await open(resolve(root, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const st = await f.stat(); check(st.isFile() && st.size <= limit, 'File size/type unsupported'); const b = await f.readFile(); check(b.length === st.size, 'File changed during read'); return b } finally { await f.close() }
}

/** Fit-ready calibration payload, not automatic fitting or measured motor controls. */
export async function importSingingSession(captureDirectory: string, outputDirectory: string, configPath: string) {
  const root = await realpath(captureDirectory), cfgRoot = await realpath(dirname(resolve(configPath)))
  const configBytes = await read(cfgRoot, basename(configPath), 2 * 1024 * 1024), c = JSON.parse(configBytes.toString())
  check(c.schema_version === '0.1.0' && c.kind === 'singing_session_import_configuration', 'Unsupported configuration')
  check(id(c.participant_id) && id(c.session_id) && ['development-fixture', 'human-observation'].includes(c.evidence_kind), 'Explicit local identities and evidence kind required')
  check(c.recording_kind === 'ordinary-singing' && c.contains_external_excitation === false, 'Explicit ordinary singing without external excitation required')
  check(Array.isArray(c.selections) && c.selections.length >= 1 && c.selections.length <= 10, 'Select 1..10 calibration windows')
  const ids = new Set<string>()
  for (const s of c.selections) {
    check(id(s.trial_id) && !ids.has(s.trial_id) && typeof s.pose === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s.pose), 'Unique trial identity and explicit pose required')
    ids.add(s.trial_id)
    check(Number.isSafeInteger(s.segment_index) && s.segment_index >= 0 && Number.isSafeInteger(s.frame_start_sample) && s.frame_start_sample >= 0, 'Explicit segment and sample window required')
    check(s.execution_controls === 'unknown', 'Recorded execution is unknown; candidate controls are hypotheses')
  }
  check(Array.isArray(c.candidates) && c.candidates.length >= 1 && c.candidates.length <= 32, 'Declare 1..32 finite candidate hypotheses')
  const candidateIds = new Set<string>()
  for (const candidate of c.candidates) {
    check(Object.keys(candidate).sort().join() === 'anatomy,candidate_id,trials' && id(candidate.candidate_id) && !candidateIds.has(candidate.candidate_id), 'Unique candidate identity required'); candidateIds.add(candidate.candidate_id)
    check(candidate.anatomy && typeof candidate.anatomy === 'object' && !Array.isArray(candidate.anatomy) && Object.values(candidate.anatomy).every(finite), 'Finite anatomical hypothesis required')
    check(candidate.trials && Object.keys(candidate.trials).length === ids.size && [...ids].every(t => t in candidate.trials), 'Candidate must condition every selected trial')
    for (const control of Object.values(candidate.trials) as any[]) check(control && Object.keys(control).sort().join() === 'JA,f0_hz,gain' && finite(control.JA) && control.JA >= -5 && control.JA <= -1 && finite(control.f0_hz) && control.f0_hz >= 65 && control.f0_hz <= 1000 && finite(control.gain) && control.gain >= .001 && control.gain <= 100, 'Explicit bounded JA, source pitch and digital gain required')
  }
  const neededCalls = 2 * c.candidates.length * c.selections.length
  check(Number.isSafeInteger(c.max_synthesis_calls) && c.max_synthesis_calls >= neededCalls && c.max_synthesis_calls <= 4096, 'Insufficient or invalid equal-compute synthesis budget')
  const manifestBytes = await read(root, 'manifest.json'), manifestHash = hash(manifestBytes), manifest = JSON.parse(manifestBytes.toString())
  check(c.source_manifest_sha256 === manifestHash, 'Configuration does not bind original source manifest')
  check(manifest.schema_version === 'singing-native-rgbd-1.0.0' && !manifest.drive && !manifest.protocol && manifest.containsProbe !== true && manifest.audio?.containsProbe !== true && manifest.contains_external_excitation !== true, 'External excitation/probe cannot enter ordinary singing importer')
  if (manifest.pose !== undefined) check(c.selections.every((s: any) => s.pose === manifest.pose), 'Declared pose differs from native held pose')
  const out = resolve(outputDirectory); await mkdir(dirname(out), { recursive: true }); await mkdir(out, { mode: 0o700 })
  const nativeOut = resolve(out, 'native-pcm')
  const imported = await importNativePcm(root, nativeOut, { participantId: c.participant_id, sessionId: c.session_id, evidenceKind: c.evidence_kind })
  check(imported.source_manifest_sha256 === manifestHash, 'Manifest changed during native import')
  for (const artifact of imported.source_import.records[0].artifacts) {
    const b = await read(root, artifact.uri); check(hash(b) === artifact.sha256 && b.length === artifact.byteLength, 'Original source bytes changed after native import')
  }
  const trials: any[] = [], selections: any[] = [], intervals: { sha: string; start: number; end: number }[] = []
  for (const s of c.selections) {
    const segment = imported.segments[s.segment_index]
    check(segment, 'Selected segment does not exist')
    const b = await read(nativeOut, segment.derived_artifact.uri)
    check(hash(b) === segment.derived_artifact.sha256 && b.length === segment.derived_artifact.byteLength, 'Derived PCM hash/byte mismatch')
    const measurement = imported.records.find((r): r is AudioMeasurement => r.kind === 'audio-measurement' && r.observationId === segment.segment_id && Math.abs(r.window.startMs * segment.sample_rate_hz / 1000 - s.frame_start_sample) < 1e-6)
    const reasons: string[] = []
    if (!measurement) reasons.push('Selected start is not an existing canonical window; no implicit window replacement')
    if (segment.sample_count / segment.sample_rate_hz < .1) reasons.push('Segment shorter than native minimum synthesis duration')
    if (measurement) {
      const size = Math.round((measurement.window.endMs - measurement.window.startMs) * segment.sample_rate_hz / 1000)
      const interval = { sha: segment.derived_artifact.sha256, start: s.frame_start_sample, end: s.frame_start_sample + size }
      check(!intervals.some(v => v.sha === interval.sha && v.start < interval.end && interval.start < v.end), 'Duplicate or overlapping source windows cannot become independent calibration trials')
      const newIntervals = [interval]
      let segmentOffset = 0
      for (const source of segment.source_artifacts) {
        const lo = Math.max(interval.start, segmentOffset), hi = Math.min(interval.end, segmentOffset + source.sample_count)
        if (lo < hi) {
          const original = { sha: source.sha256, start: source.source_sample_offset + lo - segmentOffset, end: source.source_sample_offset + hi - segmentOffset }
          check(!intervals.some(v => v.sha === original.sha && v.start < original.end && original.start < v.end), 'Duplicate or overlapping original PCM source interval')
          newIntervals.push(original)
        }
        segmentOffset += source.sample_count
      }
      intervals.push(...newIntervals)
      if (measurement.quality.missingReason) reasons.push(measurement.quality.missingReason)
      const invalidFlags = measurement.quality.flags.filter(f => ['clipping', 'invalid', 'dropped', 'low-signal-to-noise'].includes(f))
      reasons.push(...invalidFlags)
      if (measurement.measurements.filter(m => m.value !== null).length < 3) reasons.push('Fewer than three available canonical descriptors')
      if (!reasons.length) trials.push({ id: s.trial_id, pose: s.pose, measurement, sample_rate_hz: segment.sample_rate_hz, frame_start_sample: s.frame_start_sample, frame_size: size, duration_s: segment.sample_count / segment.sample_rate_hz })
    }
    selections.push({ ...s, eligible: !reasons.length, reasons, measurement_id: measurement?.id ?? null, segment_id: segment.segment_id, source_sha256: segment.derived_artifact.sha256 })
  }
  // Partial evidence is retained; caller must explicitly reselect/redeclare a complete fit request.
  const eligible = trials.length === c.selections.length
  const observations = { schema_version: '0.1.0', kind: 'canonical_pcm_observations', trials }
  check(c.expected_session_version === undefined || (Number.isSafeInteger(c.expected_session_version) && c.expected_session_version >= 0), 'Invalid expected session version')
  const session_command = eligible && c.expected_session_version !== undefined ? { action: 'ingest_calibration', expected_version: c.expected_session_version, document: observations } : null
  const fit_params = eligible ? { observations, candidates: c.candidates, max_synthesis_calls: c.max_synthesis_calls } : null
  const receipt = { kind: 'singing_session_import_receipt', schema_version: '0.1.0', source_manifest_sha256: manifestHash, configuration_sha256: hash(configBytes), evidence_kind: c.evidence_kind,
    eligible_for_fit: eligible, fit_executed: false, selections, cuts: imported.cuts, source_bindings: imported.segments,
    execution_controls: 'unknown; candidate JA, f0_hz and gain are explicit hypotheses', limitations: ['Original and derived bytes verified; hardware authenticity is not established.', 'Caller declares ordinary singing and pose; no content-based proof of absence of excitation.', 'Unknown room/source acoustics remain model mismatch; no anatomical recovery or synchronized video claim.'] }
  for (const [name, value] of Object.entries({ 'singing-observations.json': observations, 'singing-fit-params.json': fit_params, 'singing-session-command.json': session_command, 'singing-import-receipt.json': receipt })) await writeFile(resolve(out, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(out, 'singing-import-configuration.json'), configBytes, { flag: 'wx', mode: 0o600 })
  return { observations, fit_params, session_command, receipt }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, config] = process.argv.slice(2)
  if (!input || !output || !config) throw Error('Usage: import_singing_session.ts RAW_NATIVE_CAPTURE FRESH_PRIVATE_OUTPUT CONFIG_JSON')
  console.log(JSON.stringify((await importSingingSession(input, output, config)).receipt, null, 2))
}
