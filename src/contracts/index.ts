/** File-backed interchange contract. Media bytes are stored separately, never in prompts. */
export const CONTRACT_VERSION = '1.0.0' as const
export type MissingReason = 'not-supported' | 'not-requested' | 'permission-denied' | 'not-visible' | 'low-confidence' | 'dropped' | 'not-calibrated' | 'engine-unavailable' | 'not-captured' | 'invalid'
export type ProvenanceKind = 'human-observation' | 'engine-generated' | 'derived-measurement' | 'development-fixture'
export interface Provenance { kind: ProvenanceKind; producer: string; producerVersion: string; sourceIds: string[]; sourceHashes: string[] }
export interface BaseRecord { schemaVersion: typeof CONTRACT_VERSION; id: string; createdAt: string; provenance: Provenance }
export interface Artifact { id: string; uri: string; sha256: string; mediaType: string; byteLength: number }
/** captureMs is relative to this source clock, not network arrival time. */
export interface Timebase { clockId: string; origin: 'session-start' | 'device-monotonic'; unit: 'ms'; syncUncertaintyMs: number | null; referenceClockId: string | null; offsetToReferenceMs: number | null }
export interface Quality { flags: string[]; missingReason: MissingReason | null }
export interface CaptureSample { captureMs: number; artifactId: string; sequence: number; quality: Quality }
export interface ObservationStream { modality: 'audio' | 'rgb' | 'depth'; timebase: Timebase; samples: CaptureSample[]; missingReason: MissingReason | null; droppedSamples: number; settings: Record<string, string | number | boolean>; calibration: { artifactId: string | null; missingReason: MissingReason | null }; depth: { representation: 'depth' | 'disparity'; unit: 'm' | 'mm' | '1/m'; coordinateFrame: 'camera-optical'; filtered: boolean } | null }
export interface ObservationBundle extends BaseRecord { kind: 'observation'; participantId: string; sessionId: string; trialId: string; predictionId: string | null; consentScope: string[]; task: string; streams: ObservationStream[]; artifacts: Artifact[] }
export interface ProfileCapture extends BaseRecord { kind: 'profile-capture'; participantId: string; sessionId: string; observationIds: string[]; steps: { instruction: string; status: 'captured' | 'skipped' | 'failed'; artifactId: string | null; missingReason: MissingReason | null }[]; interpretation: 'visible-surface-only' }
export interface Measurement { name: string; value: number | null; unit: 'Hz' | 'dBFS' | 'ratio' | 's' | 'ms' | 'm' | 'mm' | 'degrees' | 'semitones'; uncertainty: number | null; missingReason: MissingReason | null }
export interface AudioMeasurement extends BaseRecord { kind: 'audio-measurement'; observationId: string; artifactId: string; timebase: Timebase; window: { startMs: number; endMs: number }; method: string; measurements: Measurement[]; quality: Quality; calibrationId: string | null }
export interface AnatomyParameter { name: string; value: number; unit: string; bounds: [number, number]; role: 'global' | 'dynamic' | 'nuisance'; status: 'measured' | 'inferred' | 'fixed'; interpretation: string; simulatorMapping: string }
export interface CandidateAnatomy extends BaseRecord { kind: 'candidate-anatomy'; modelVersion: string; parentModelId: string | null; evidenceIds: string[]; availability: 'available' | 'unavailable'; missingReason: MissingReason | null; parameters: AnatomyParameter[]; geometry: Artifact | null; solver: { name: string; version: string; configSha256: string } | null; uncertaintyMethod: string | null; mismatch: boolean }
export interface Forecast extends BaseRecord { kind: 'forecast'; modelId: string; modelVersion: string; evidenceIds: string[]; experimentId: string; intervention: string; availability: 'available' | 'unavailable'; missingReason: MissingReason | null; outcomes: Measurement[]; scoringRule: string; evaluationMode: 'human-held-out' | 'synthetic-held-out'; budget: { unit: 'solver-calls'; limit: number } }
/** Digest covers the complete forecast and metadata. Write once, then verify on read. */
export interface PredictionCommit extends BaseRecord { kind: 'prediction-commit'; forecast: Forecast; committedAt: string; sha256: string }
export interface EvaluationRecord extends BaseRecord { kind: 'evaluation'; predictionId: string; predictionSha256: string; observationIds: string[]; captureStartedAt: string; scoredAt: string; outcome: 'scored' | 'excluded' | 'failed'; errors: Measurement[]; exclusions: { observationId: string; reason: string }[]; baseline: { name: string; errors: Measurement[]; budget: { unit: 'solver-calls'; limit: number } } | null; executionNotes: string }
export interface JobRecord extends BaseRecord { kind: 'job'; operation: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked'; idempotencyKey: string; modelId: string | null; inputIds: string[]; outputIds: string[]; missingReason: MissingReason | null }
export type ContractRecord = ObservationBundle | ProfileCapture | AudioMeasurement | CandidateAnatomy | Forecast | PredictionCommit | EvaluationRecord | JobRecord

// Deliberately small dependency-free validator, shared by browser and Node producers.
type Check = (value: unknown, path: string, errors: string[]) => void
const issue = (path: string, expected: string, errors: string[]) => { errors.push(`${path}: expected ${expected}`) }
const text: Check = (v, p, e) => { if (typeof v !== 'string' || !v.trim()) issue(p, 'nonempty string', e) }
const finite: Check = (v, p, e) => { if (typeof v !== 'number' || !Number.isFinite(v)) issue(p, 'finite number', e) }
const nonnegative: Check = (v, p, e) => { finite(v, p, e); if (typeof v === 'number' && v < 0) issue(p, 'nonnegative number', e) }
const count: Check = (v, p, e) => { nonnegative(v, p, e); if (typeof v === 'number' && !Number.isInteger(v)) issue(p, 'integer', e) }
const bool: Check = (v, p, e) => { if (typeof v !== 'boolean') issue(p, 'boolean', e) }
const choice = (...values: string[]): Check => (v, p, e) => { if (typeof v !== 'string' || !values.includes(v)) issue(p, values.join(' | '), e) }
const nullable = (check: Check): Check => (v, p, e) => { if (v !== null) check(v, p, e) }
const list = (check: Check): Check => (v, p, e) => { if (!Array.isArray(v)) issue(p, 'array', e); else v.forEach((item, i) => check(item, `${p}[${i}]`, e)) }
const object = (shape: Record<string, Check>): Check => (v, p, e) => { if (!v || typeof v !== 'object' || Array.isArray(v)) { issue(p, 'object', e); return }; const record = v as Record<string, unknown>; for (const [key, check] of Object.entries(shape)) check(record[key], `${p}.${key}`, e) }
const iso: Check = (v, p, e) => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v)) || !/(Z|[+-]\d\d:\d\d)$/.test(v)) issue(p, 'ISO timestamp with timezone', e) }
const hash: Check = (v, p, e) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) issue(p, 'lowercase SHA-256 hex digest', e) }
const missing = choice('not-supported', 'not-requested', 'permission-denied', 'not-visible', 'low-confidence', 'dropped', 'not-calibrated', 'engine-unavailable', 'not-captured', 'invalid')
const quality = object({ flags: list(text), missingReason: nullable(missing) })
const artifact = object({ id: text, uri: text, sha256: hash, mediaType: text, byteLength: count })
const provenance = object({ kind: choice('human-observation', 'engine-generated', 'derived-measurement', 'development-fixture'), producer: text, producerVersion: text, sourceIds: list(text), sourceHashes: list(hash) })
const timebase = object({ clockId: text, origin: choice('session-start', 'device-monotonic'), unit: choice('ms'), syncUncertaintyMs: nullable(nonnegative), referenceClockId: nullable(text), offsetToReferenceMs: nullable(finite) })
const measurement = object({ name: text, value: nullable(finite), unit: choice('Hz', 'dBFS', 'ratio', 's', 'ms', 'm', 'mm', 'degrees', 'semitones'), uncertainty: nullable(nonnegative), missingReason: nullable(missing) })
const budget = object({ unit: choice('solver-calls'), limit: count })
const settings: Check = (v, p, e) => { if (!v || typeof v !== 'object' || Array.isArray(v)) { issue(p, 'settings object', e); return }; for (const [key, value] of Object.entries(v)) if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) issue(`${p}.${key}`, 'string, finite number or boolean', e) }
const bounds: Check = (v, p, e) => { if (!Array.isArray(v) || v.length !== 2) issue(p, '[min, max]', e); else { finite(v[0], `${p}[0]`, e); finite(v[1], `${p}[1]`, e); if (v[0] > v[1]) issue(p, 'min <= max', e) } }
const base = { schemaVersion: choice(CONTRACT_VERSION), id: text, createdAt: iso, provenance }
const forecastShape = { ...base, kind: choice('forecast'), modelId: text, modelVersion: text, evidenceIds: list(text), experimentId: text, intervention: text, availability: choice('available', 'unavailable'), missingReason: nullable(missing), outcomes: list(measurement), scoringRule: text, evaluationMode: choice('human-held-out', 'synthetic-held-out'), budget }
const validators: Record<ContractRecord['kind'], Check> = {
  observation: object({ ...base, kind: choice('observation'), participantId: text, sessionId: text, trialId: text, predictionId: nullable(text), consentScope: list(text), task: text, artifacts: list(artifact), streams: list(object({ modality: choice('audio', 'rgb', 'depth'), timebase, samples: list(object({ captureMs: nonnegative, artifactId: text, sequence: count, quality })), missingReason: nullable(missing), droppedSamples: count, settings, calibration: object({ artifactId: nullable(text), missingReason: nullable(missing) }), depth: nullable(object({ representation: choice('depth', 'disparity'), unit: choice('m', 'mm', '1/m'), coordinateFrame: choice('camera-optical'), filtered: bool })) })) }),
  'profile-capture': object({ ...base, kind: choice('profile-capture'), participantId: text, sessionId: text, observationIds: list(text), steps: list(object({ instruction: text, status: choice('captured', 'skipped', 'failed'), artifactId: nullable(text), missingReason: nullable(missing) })), interpretation: choice('visible-surface-only') }),
  'audio-measurement': object({ ...base, kind: choice('audio-measurement'), observationId: text, artifactId: text, timebase, window: object({ startMs: nonnegative, endMs: nonnegative }), method: text, measurements: list(measurement), quality, calibrationId: nullable(text) }),
  'candidate-anatomy': object({ ...base, kind: choice('candidate-anatomy'), modelVersion: text, parentModelId: nullable(text), evidenceIds: list(text), availability: choice('available', 'unavailable'), missingReason: nullable(missing), parameters: list(object({ name: text, value: finite, unit: text, bounds, role: choice('global', 'dynamic', 'nuisance'), status: choice('measured', 'inferred', 'fixed'), interpretation: text, simulatorMapping: text })), geometry: nullable(artifact), solver: nullable(object({ name: text, version: text, configSha256: hash })), uncertaintyMethod: nullable(text), mismatch: bool }),
  forecast: object(forecastShape),
  'prediction-commit': object({ ...base, kind: choice('prediction-commit'), forecast: object(forecastShape), committedAt: iso, sha256: hash }),
  evaluation: object({ ...base, kind: choice('evaluation'), predictionId: text, predictionSha256: hash, observationIds: list(text), captureStartedAt: iso, scoredAt: iso, outcome: choice('scored', 'excluded', 'failed'), errors: list(measurement), exclusions: list(object({ observationId: text, reason: text })), baseline: nullable(object({ name: text, errors: list(measurement), budget })), executionNotes: text }),
  job: object({ ...base, kind: choice('job'), operation: text, state: choice('queued', 'running', 'completed', 'failed', 'cancelled', 'blocked'), idempotencyKey: text, modelId: nullable(text), inputIds: list(text), outputIds: list(text), missingReason: nullable(missing) }),
}
export type ValidationResult = { valid: true; record: ContractRecord; errors: [] } | { valid: false; errors: string[] }
export function validateRecord(value: unknown): ValidationResult {
  const errors: string[] = []
  const kind = value && typeof value === 'object' ? (value as Record<string, unknown>).kind : null
  if (typeof kind !== 'string' || !Object.hasOwn(validators, kind)) return { valid: false, errors: ['record.kind: unknown contract kind'] }
  validators[kind as ContractRecord['kind']](value, 'record', errors)
  if (errors.length) return { valid: false, errors }
  const record = value as ContractRecord
  const require = (condition: boolean, message: string) => { if (!condition) errors.push(message) }
  const measurements = (items: Measurement[]) => items.forEach(item => require((item.value === null) === (item.missingReason !== null), `Measurement ${item.name}: null values require a reason; present values cannot be missing`))
  if (record.kind === 'observation') {
    const ids = new Set(record.artifacts.map(item => item.id))
    require(ids.size === record.artifacts.length, 'Artifact IDs must be unique')
    require(new Set(record.streams.map(stream => stream.modality)).size === record.streams.length, 'Only one stream per modality is supported in v1')
    require(['audio', 'rgb', 'depth'].every(modality => record.streams.some(stream => stream.modality === modality)), 'Describe audio, RGB and depth, including missing modalities')
    for (const stream of record.streams) {
      require(stream.samples.length > 0 ? stream.missingReason === null : stream.missingReason !== null, `${stream.modality}: absent samples need a reason`)
      require(stream.modality === 'depth' && stream.samples.length > 0 ? stream.depth !== null : stream.depth === null, 'Depth metadata must accompany captured depth only')
      require(stream.timebase.referenceClockId === null ? stream.timebase.offsetToReferenceMs === null : stream.timebase.offsetToReferenceMs !== null, 'Clock reference and offset must be provided together')
      require(stream.calibration.artifactId !== null ? ids.has(stream.calibration.artifactId) && stream.calibration.missingReason === null : stream.calibration.missingReason !== null, 'Calibration must reference a bundled artifact or report a missing reason')
      stream.samples.forEach((sample, i) => {
        require(ids.has(sample.artifactId), `Unknown sample artifact: ${sample.artifactId}`)
        if (i) require(sample.captureMs >= stream.samples[i - 1].captureMs && sample.sequence > stream.samples[i - 1].sequence, 'Samples must have ordered capture timestamps and increasing sequence numbers')
      })
      if (stream.depth) require(stream.depth.representation === 'disparity' ? stream.depth.unit === '1/m' : stream.depth.unit !== '1/m', 'Depth representation and units disagree')
    }
  }
  if (record.kind === 'profile-capture') record.steps.forEach(step => require(step.status === 'captured' ? step.artifactId !== null && step.missingReason === null : step.missingReason !== null, 'Profile steps need an artifact or failure reason'))
  if (record.kind === 'audio-measurement') { measurements(record.measurements); require(record.window.endMs > record.window.startMs, 'Audio window end must follow its start') }
  if (record.kind === 'candidate-anatomy' || record.kind === 'forecast') {
    require(record.availability === 'available' ? record.missingReason === null : record.missingReason !== null, 'Unavailable results require an explicit reason')
    if (record.kind === 'candidate-anatomy') {
      require(record.availability === 'available' ? record.solver !== null : record.geometry === null && record.parameters.length === 0, 'Available anatomy requires solver provenance; unavailable anatomy cannot contain fabricated geometry/parameters')
      record.parameters.forEach(parameter => require(parameter.value >= parameter.bounds[0] && parameter.value <= parameter.bounds[1], `Parameter ${parameter.name}: value outside bounds`))
    } else { measurements(record.outcomes); require(record.availability === 'available' ? record.outcomes.some(item => item.value !== null) : record.outcomes.length === 0, 'Available forecast needs outcomes; unavailable forecast must be empty') }
  }
  if (record.kind === 'prediction-commit') {
    const nested = validateRecord(record.forecast)
    if (!nested.valid) errors.push(...nested.errors)
    require(record.forecast.availability === 'available', 'Cannot commit an unavailable forecast')
    require(Date.parse(record.committedAt) >= Date.parse(record.forecast.createdAt), 'Commit cannot predate its forecast')
  }
  if (record.kind === 'evaluation') {
    measurements(record.errors)
    if (record.baseline) measurements(record.baseline.errors)
    require(Date.parse(record.scoredAt) >= Date.parse(record.captureStartedAt), 'Score cannot predate capture')
    require(record.outcome !== 'scored' || record.observationIds.length > 0 && record.errors.some(item => item.value !== null), 'A scored evaluation needs observations and numerical errors')
    require(record.outcome === 'scored' || record.exclusions.length > 0, 'Unscored evaluations must retain failure/exclusion reasons')
  }
  if (record.kind === 'job') require(!['failed', 'blocked'].includes(record.state) || record.missingReason !== null, 'Failed/blocked jobs need a reason')
  return errors.length ? { valid: false, errors } : { valid: true, record, errors: [] }
}
export function assertRecord(value: unknown): asserts value is ContractRecord {
  const result = validateRecord(value)
  if (!result.valid) throw new Error(result.errors.join('\n'))
}
/** Deterministic JSON; object keys sorted, array order preserved. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  throw new Error('Artifacts must contain plain JSON values')
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value) }
  return value
}
export async function createPredictionCommit(forecast: Forecast, metadata: { id: string; committedAt: string; provenance: Provenance }): Promise<Readonly<PredictionCommit>> {
  const payload = { schemaVersion: CONTRACT_VERSION, kind: 'prediction-commit' as const, id: metadata.id, createdAt: metadata.committedAt, committedAt: metadata.committedAt, provenance: metadata.provenance, forecast }
  const snapshot = JSON.parse(canonicalJson(payload)) as typeof payload
  const record: PredictionCommit = { ...snapshot, sha256: await sha256(canonicalJson(snapshot)) }
  assertRecord(record)
  return deepFreeze(record)
}
export async function verifyPredictionCommit(value: unknown): Promise<boolean> {
  const result = validateRecord(value)
  if (!result.valid || result.record.kind !== 'prediction-commit') return false
  const { sha256: expected, ...payload } = result.record
  try { return await sha256(canonicalJson(payload)) === expected } catch { return false }
}
/** Cross-record checks that an isolated JSON validator cannot establish. */
export async function validateProspectiveEvaluation(commit: PredictionCommit, evaluation: EvaluationRecord): Promise<string[]> {
  const errors: string[] = []
  const checked = validateRecord(evaluation)
  if (!checked.valid) return checked.errors
  if (!(await verifyPredictionCommit(commit))) errors.push('Prediction digest is invalid')
  if (evaluation.predictionId !== commit.id || evaluation.predictionSha256 !== commit.sha256) errors.push('Evaluation references a different prediction')
  if (Date.parse(evaluation.captureStartedAt) <= Date.parse(commit.committedAt)) errors.push('Prospective capture must begin after commitment')
  if (evaluation.observationIds.some(id => commit.forecast.evidenceIds.includes(id))) errors.push('Held-out observations overlap fit evidence')
  if (evaluation.baseline && evaluation.baseline.budget.limit !== commit.forecast.budget.limit) errors.push('Baseline solver budget differs from forecast budget')
  return errors
}
