#!/usr/bin/env -S node --experimental-strip-types
/** Original native probe bundle -> private, explicitly conditioned A fit input. */
import { constants } from 'node:fs'
import { open, realpath, mkdir, writeFile, chmod, readdir } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { importAcousticProbe } from '../../scripts/import-acoustic-probe.ts'
import { probeSource } from '../../src/contracts/probes.ts'

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const id = (x: unknown) => typeof x === 'string' && !!x.trim()
const sha = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
async function read(root: string, name: string, limit = 128 * 1024 * 1024) {
  if (typeof name !== 'string' || name !== basename(name) || !/^[\w][\w.-]*$/.test(name)) throw Error('Unsafe evidence path')
  const file = await open(resolve(root, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const st = await file.stat()
    if (!st.isFile() || st.size > limit) throw Error('Invalid evidence file type/size')
    const bytes = await file.readFile()
    if (bytes.length !== st.size) throw Error('Evidence changed during read')
    return bytes
  } finally { await file.close() }
}
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message) }
/** No step yet derives calibration arrays from measurement recordings (e.g. a reference-microphone sweep), so a
 * package's calibration, processing and placement are declarations. Hashing its evidence files is not measurement. */
export const DECLARED_CALIBRATION_REASON = 'Calibration is declared, not measured; no measured-calibration evidence was derived. Human recordings stay ineligible for scientific fitting until calibration is derived from measurement recordings.'

/** `receiptPath` names the app's `usb-receipt.json`, with the pulled `original.zip` beside it. Without it the
 * source is classified from the manifest alone (attestation `none`), as for a direct command-line import. */
export async function importProbeScience(captureDirectory: string, outputDirectory: string, configPath: string, receiptPath?: string) {
  const root = await realpath(captureDirectory), configRoot = await realpath(dirname(resolve(configPath)))
  const configBytes = await read(configRoot, basename(configPath), 2 * 1024 * 1024)
  const config = JSON.parse(configBytes.toString())
  requireValue(config.schema_version === '0.1.0' && config.kind === 'probe_science_import_configuration', 'Unsupported bridge configuration')
  requireValue(id(config.trial_id) && id(config.pose) && config.pose_state === 'held-quiet', 'Explicit held-quiet pose and trial identity required')
  requireValue(['complex', 'magnitude'].includes(config.comparison), 'Declare magnitude or complex comparison')
  requireValue(Array.isArray(config.selected_indices) && config.selected_indices.length >= 2 && config.selected_indices.length <= 512 && config.selected_indices.every((v: unknown, i: number, a: number[]) => Number.isSafeInteger(v) && (v as number) >= 0 && (!i || (v as number) > a[i - 1])), 'Declare 2..512 strictly increasing full-response indices')
  requireValue(Array.isArray(config.evidence) && config.evidence.length > 0 && config.evidence.length <= 32, 'Supplemental calibration evidence required')
  const evidence = []
  for (const item of config.evidence) {
    requireValue(sha(item.sha256) && Number.isSafeInteger(item.byteCount) && item.byteCount > 0, 'Invalid supplemental evidence descriptor')
    const bytes = await read(configRoot, item.path, 16 * 1024 * 1024)
    requireValue(bytes.length === item.byteCount && hash(bytes) === item.sha256, 'Supplemental evidence hash/byte mismatch')
    evidence.push({ path: item.path, sha256: item.sha256, byteCount: item.byteCount })
  }
  const verified = new Set(evidence.map(x => x.sha256))
  for (const name of ['calibration', 'nuisance_prior']) {
    const v = config[name]
    requireValue(v && Array.isArray(v.source_hashes) && v.source_hashes.length && v.source_hashes.every((h: unknown) => sha(h) && verified.has(h)), `${name} must bind verified supplemental evidence`)
  }
  const cal = config.calibration, p = config.placement
  requireValue(p && id(p.placement_id) && id(p.coordinate_frame) && ['source_m', 'microphone_m', 'mouth_m'].every(k => Array.isArray(p[k]) && p[k].length === 3 && p[k].every(finite)), 'Explicit metric placement required')
  requireValue(id(cal.calibration_id) && id(cal.route_id) && cal.placement_id === p.placement_id && ['measured', 'synthetic-fixture'].includes(cal.kind) && finite(cal.delay_s) && cal.delay_s >= 0 && cal.delay_s <= 1, 'Invalid instrument calibration identity/delay')
  for (const k of ['frequency_hz', 'source_volume_velocity_real', 'source_volume_velocity_imag', 'microphone_gain_real', 'microphone_gain_imag']) requireValue(Array.isArray(cal[k]) && cal[k].length === config.selected_indices.length && cal[k].every(finite), 'Complete exact-grid instrument calibration arrays required')
  requireValue(cal.source_volume_velocity_real.every((x: number, i: number) => Math.hypot(x, cal.source_volume_velocity_imag[i]) > 0) && cal.microphone_gain_real.every((x: number, i: number) => Math.hypot(x, cal.microphone_gain_imag[i]) > 0), 'Zero instrument calibration response')
  requireValue(Array.isArray(config.bands) && config.bands.length >= 1 && config.bands.length <= 32 && config.bands.every((b: any) => b && ['low_hz', 'high_hz', 'sigma', 'weight'].every(k => finite(b[k])) && b.low_hz >= 0 && b.high_hz > b.low_hz && b.high_hz <= 20001 && b.sigma > 0 && b.weight > 0 && b.weight <= 100), 'Declare bounded bands, discrepancy scales and weights')
  const limits: Record<string, number[]> = { gain: [.01, 100], direct_gain: [0, 2], coupling_gain: [0, 2], delay_s: [-.01, .01] }
  requireValue(id(config.nuisance_prior.prior_id) && config.nuisance_prior.bounds && Object.keys(config.nuisance_prior.bounds).length === 4 && Object.entries(limits).every(([k, bounds]) => { const v = config.nuisance_prior.bounds[k]; return Array.isArray(v) && v.length === 2 && v.every(finite) && v[0] >= bounds[0] && v[1] <= bounds[1] && v[0] <= v[1] }), 'Declare bounded scalar nuisance priors')
  const c = config.conditions
  requireValue(c && ['rigid', 'pressure-release', 'resistive'].includes(c.termination) && finite(c.attenuation_np_per_m) && c.attenuation_np_per_m >= 0 && c.attenuation_np_per_m <= 20 && (c.termination === 'resistive' ? finite(c.termination_resistance_pa_s_m3) && c.termination_resistance_pa_s_m3 >= 0 && c.termination_resistance_pa_s_m3 <= 1e12 : c.termination_resistance_pa_s_m3 === null), 'Declare supported tube termination/loss')
  const originalManifest = await read(root, 'manifest.json'), native = JSON.parse(originalManifest.toString())
  const originals = [{ path: 'manifest.json', sha256: hash(originalManifest), byteCount: originalManifest.length }, native.drive, native.received]
  if (native.calibration?.levelCheckArtifact) originals.push(native.calibration.levelCheckArtifact)
  async function verifyOriginals() {
    for (const original of originals) {
      const bytes = await read(root, original.path)
      requireValue(bytes.length === original.byteCount && hash(bytes) === original.sha256, 'Original capture changed or hash/byte mismatch')
    }
  }
  await verifyOriginals()
  let pull: any
  if (receiptPath !== undefined) {
    const pullRoot = await realpath(dirname(resolve(receiptPath)))
    pull = JSON.parse((await read(pullRoot, basename(receiptPath), 1024 * 1024)).toString())
    requireValue(pull && typeof pull === 'object' && sha(pull.sha256) && Number.isSafeInteger(pull.bytes), 'Pull receipt lacks the archive hash and byte count')
    const archive = await read(pullRoot, 'original.zip', 512 * 1024 * 1024)
    requireValue(archive.length === pull.bytes && hash(archive) === pull.sha256, 'Pulled archive does not match its pull receipt')
  }
  // The gate uses the source kind the manifest's own fields and pull receipt support, never the bare provenance label.
  const source = probeSource(native, pull ? pull.acquisition ?? null : undefined), human = source.kind === 'human-recording', fixture = source.kind === 'software-fixture'
  requireValue(source.attestation !== 'contradicted-fixture-receipt', 'Repository-fixture pull receipt contradicts the capture manifest: only a marked software fixture without iPhone recorder fields may carry one')
  requireValue(human || fixture || cal.kind === 'measured', 'Physical reference capture requires measured instrument calibration evidence')
  requireValue(!cal.source_hashes.includes(native.received.sha256) && !config.nuisance_prior.source_hashes.includes(native.received.sha256), 'Target response cannot calibrate itself')
  const out = resolve(outputDirectory)
  await mkdir(dirname(out), { recursive: true }); await mkdir(out, { mode: 0o700 }) // Fresh output required; never overwrite private artifacts.
  const bOut = resolve(out, 'b-import')
  await mkdir(bOut, { mode: 0o700 })
  const measurement = await importAcousticProbe(root, bOut)
  await chmod(bOut, 0o700)
  for (const file of await readdir(bOut)) await chmod(resolve(bOut, file), 0o600)
  await verifyOriginals()
  requireValue(measurement.sourceHashes.manifest === hash(originalManifest) && measurement.sourceHashes.drive === native.drive.sha256 && measurement.sourceHashes.received === native.received.sha256, 'B source binding mismatch')
  const artifact = measurement.artifacts.response, responseBytes = await read(bOut, artifact.path)
  requireValue(responseBytes.length === artifact.byteCount && hash(responseBytes) === artifact.sha256, 'Derived response hash/byte mismatch')
  const full = JSON.parse(responseBytes.toString())
  requireValue(full.units === 'recorded-PCM-per-digital-drive' && full.sourceHashes.drive === native.drive.sha256 && full.sourceHashes.received === native.received.sha256, 'Full response source/units mismatch')
  const reasons: string[] = human ? [DECLARED_CALIBRATION_REASON] : []
  const contradiction = source.nativeCaptureFields.length ? `carries iPhone recorder fields (${source.nativeCaptureFields.join(', ')})`
    : source.attestation === 'devicectl-receipt' ? 'its pull receipt shows it was copied from an iPhone by devicectl'
    : source.attestation === 'legacy-receipt' ? 'its pull receipt does not name a known transport' : "lacks the software fixture generator's marker"
  if (source.kind !== source.declared) reasons.push(`Manifest says ${String(source.declared)} but ${contradiction}; it is treated as a human recording.`)
  const binding = config.capture_binding
  const bound = binding && binding.manifest_sha256 === hash(originalManifest) && binding.pose === config.pose && binding.placement_id === p.placement_id && binding.route_id === cal.route_id
  if (!bound) reasons.push('Capture manifest/pose/route/placement binding missing or mismatched')
  if (!fixture && (!bound || native.pose !== config.pose || native.calibration?.placementId !== p.placement_id || !id(native.calibration?.levelCheck?.routeSignature) || binding.native_route_signature !== native.calibration.levelCheck.routeSignature)) reasons.push('Original physical pose, placement or route signature does not match calibration binding')
  const processing = config.processing
  const processingSupported = processing && id(processing.evidence_id) && processing.route_id === cal.route_id &&
    Array.isArray(processing.source_hashes) && processing.source_hashes.length && processing.source_hashes.every((h: unknown) => verified.has(h)) &&
    (fixture ? processing.kind === 'declared-software-fixture' : processing.kind === 'characterized-measurement')
  if (!processingSupported) reasons.push('Hardware processing/nonlinearity uncharacterized for declared route; explicit independent characterization required')
  if (!measurement.responseUsable.value) reasons.push(measurement.responseUsable.reason, ...measurement.quality.flags)
  if (measurement.quality.clippedSamples || native.bufferDiscontinuities?.length || native.failures?.length) reasons.push('Clipping, discontinuity or failed acquisition retained; not eligible for fitting')
  if (config.comparison === 'complex' && !measurement.phaseUsable) reasons.push('Native timing does not support complex phase')
  let trial: any = null
  if (!reasons.length) {
    const indices: number[] = config.selected_indices
    requireValue(indices.every(i => i < full.frequencyHz.length), 'Selection index outside full response')
    const frequencies = indices.map(i => full.frequencyHz[i])
    requireValue(frequencies.every((f, i) => finite(f) && f >= 20 && f <= 20000 && f === cal.frequency_hz[i]), 'Selected full-response grid differs from calibration')
    requireValue(indices.every(i => typeof full.valid[i] === 'boolean' && finite(full.real[i]) && finite(full.imag[i])), 'Invalid full response components/mask')
    const valid = indices.map(i => full.valid[i])
    requireValue(frequencies.every(f => config.bands.filter((b: any) => f >= b.low_hz && f < b.high_hz).length <= 1), 'Overlapping selected bands')
    const active = frequencies.filter((f, i) => valid[i] && config.bands.some((b: any) => f >= b.low_hz && f < b.high_hz))
    if (!active.length) reasons.push('No selected valid response bands')
    if (config.comparison === 'complex' && (measurement.timing.uncertaintySeconds === null || 2 * Math.PI * Math.max(...active) * measurement.timing.uncertaintySeconds > .1)) reasons.push('Native timing uncertainty exceeds selected-band phase tolerance')
    if (!reasons.length) trial = {
      id: config.trial_id, split: 'calibration', channel: 'oral_external', quantity: 'recorded_pcm_per_digital_drive',
      pose_state: config.pose_state, pose: config.pose, quality_flags: [], frequency_hz: frequencies,
      response_real: indices.map(i => full.real[i]), response_imag: indices.map(i => full.imag[i]), valid_mask: valid,
      comparison: config.comparison, timing: { phase_verified: measurement.phaseUsable, uncertainty_s: measurement.timing.uncertaintySeconds, evidence_id: `${measurement.id}/native-timing`, source_hashes: [measurement.sourceHashes.manifest] },
      bands: config.bands, source: { kind: fixture ? 'synthetic-fixture' : source.kind, native_capture_fields: source.nativeCaptureFields,
        drive_artifact_id: `${measurement.id}/drive`, received_artifact_id: `${measurement.id}/received`, drive_sha256: native.drive.sha256, received_sha256: native.received.sha256 },
      placement: p, calibration: cal, nuisance_prior: config.nuisance_prior, conditions: c,
    }
  }
  const probe_document = trial ? { schema_version: '0.1.0', kind: 'external_probe_observations', trials: [trial] } : null
  const receipt = { kind: 'probe_science_import_receipt', schema_version: '0.1.0', captured: true,
    eligible_for_fit: !!trial, included_in_fit: false, reasons, b_measurement_id: measurement.id,
    original_artifacts: originals, full_response_artifact: artifact, full_response_bins: full.frequencyHz.length,
    selected_indices: config.selected_indices, configuration_sha256: hash(configBytes), supplemental_evidence: evidence,
    extractor: measurement.extractor, timing: measurement.timing, quality: measurement.quality,
    provenance: source.kind, declared_provenance: source.declared, native_capture_fields: source.nativeCaptureFields,
    attestation: source.attestation, acquisition: pull ? pull.acquisition ?? null : null, processing: processing ?? null, capture_binding: binding ?? null, calibration_authenticity_verified: false,
    limitations: ['Evidence bytes verified; physical calibration validity is caller-supported, not authenticated.', 'Immutable B measurement remains includedInFit=false; only an actual fitter may report evidence use.', 'No sampled summary, additional DSP, generated phase alignment or anatomical recovery claim.'] }
  await writeFile(resolve(out, 'probe-science-document.json'), JSON.stringify(probe_document, null, 2), { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(out, 'probe-science-receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(out, 'probe-science-configuration.json'), configBytes, { flag: 'wx', mode: 0o600 })
  return { probe_document, receipt, measurement }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [capture, output, config, receipt] = process.argv.slice(2)
  if (!capture || !output || !config) throw Error('Usage: import_probe_science.ts RAW_CAPTURE FRESH_PRIVATE_OUTPUT CONFIG_JSON [USB_RECEIPT_JSON]')
  const result = await importProbeScience(capture, output, config, receipt)
  console.log(JSON.stringify(result.receipt, null, 2))
}
