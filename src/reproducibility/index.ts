import { canonicalJson, CONTRACT_VERSION, sha256, validateRecord, validateProspectiveEvaluation, verifyPredictionCommit } from '../contracts/index.ts'
import type { Artifact, ContractRecord } from '../contracts/index.ts'

export interface TrialSummary {
  id: string; state: string; retryOf: string | null
  history: { state: string; at: string; reason: string }[]
  forecast?: ContractRecord | null; commit?: ContractRecord | null; observation?: ContractRecord | null; evaluation?: ContractRecord | null
}
export interface EvidenceManifest {
  format: 'singing-teacher-evidence/1'; exportedAt: string
  versions: { contract: string; reporter: string; producers: string[]; sourceCommit: string | null }
  execution: { seeds: number[] | null; solverCallsUsed: number | null; parallelism: number | null; declaredBudgets: { forecastId: string; unit: string; limit: number }[] }
  records: ContractRecord[]; trials: TrialSummary[]
  limitations: string[]; replayCommand: string; sha256: string
}
export interface EvidenceReport {
  status: 'valid-metadata' | 'incomplete' | 'invalid'
  errors: string[]; missing: string[]; limitations: string[]
  recordCount: number; trialCount: number; unsuccessfulAttempts: { id: string; state: string; reasons: string[] }[]
  artifacts: Artifact[]
}
export async function createEvidenceManifest(records: ContractRecord[] = [], trials: TrialSummary[] = []): Promise<EvidenceManifest> {
  const all = [...records, ...trials.flatMap(t => [t.forecast, t.commit, t.observation, t.evaluation].filter((r): r is ContractRecord => !!r))]
  const unique = new Map<string, ContractRecord>()
  for (const record of all) {
    const previous = unique.get(record.id)
    if (previous && canonicalJson(previous) !== canonicalJson(record)) throw new Error(`Conflicting records share ID ${record.id}`)
    unique.set(record.id, record)
  }
  const values = [...unique.values()]
  const forecasts = values.flatMap(r => r.kind === 'forecast' ? [r] : r.kind === 'prediction-commit' ? [r.forecast] : [])
  const payload: Omit<EvidenceManifest, 'sha256'> = {
    format: 'singing-teacher-evidence/1', exportedAt: new Date().toISOString(),
    versions: { contract: CONTRACT_VERSION, reporter: '1.0.0', producers: [...new Set(values.map(r => `${r.provenance.producer}@${r.provenance.producerVersion}`))], sourceCommit: null },
    execution: { seeds: null, solverCallsUsed: null, parallelism: null, declaredBudgets: [...new Map(forecasts.map(f => [f.id, { forecastId: f.id, ...f.budget }])).values()] },
    records: values, trials,
    limitations: ['Metadata audit only; no simulator or independent score recomputation is run.', 'Media remains in separate files. Copy exported artifacts beside this manifest preserving relative paths.', 'Seeds, actual solver usage, parallelism and source commit are unknown unless supplied by the producer. Null is not zero.', 'Hashes detect changes; they do not authenticate the original recording or externally prove commitment time.'],
    replayCommand: 'node --experimental-strip-types scripts/replay-experiment.ts evidence.json evidence-report',
  }
  return { ...payload, sha256: await sha256(canonicalJson(payload)) }
}
export async function auditEvidence(value: unknown): Promise<EvidenceReport> {
  const report: EvidenceReport = { status: 'invalid', errors: [], missing: [], limitations: ['Evidence audit does not rerun synthesis, extraction or scoring, and does not establish anatomical recovery.'], recordCount: 0, trialCount: 0, unsuccessfulAttempts: [], artifacts: [] }
  if (!value || typeof value !== 'object') { report.errors.push('Expected evidence manifest'); return report }
  const manifest = value as EvidenceManifest
  if (manifest.format !== 'singing-teacher-evidence/1' || !Array.isArray(manifest.records) || !Array.isArray(manifest.trials)) { report.errors.push('Unsupported or malformed evidence manifest'); return report }
  try {
    const { sha256: expected, ...payload } = manifest
    if (await sha256(canonicalJson(payload)) !== expected) report.errors.push('Manifest SHA-256 mismatch')
  } catch { report.errors.push('Manifest cannot be hashed') }
  if (manifest.versions?.contract !== CONTRACT_VERSION) report.errors.push('Unsupported contract version')
  if (!Number.isFinite(Date.parse(manifest.exportedAt))) report.errors.push('Invalid export time')
  if (!manifest.execution || !Array.isArray(manifest.execution.declaredBudgets)) report.errors.push('Missing execution metadata')
  if (manifest.execution?.seeds == null) report.missing.push('Random seeds not supplied')
  if (manifest.execution?.solverCallsUsed == null) report.missing.push('Actual solver usage not supplied')
  if (!manifest.versions?.sourceCommit) report.missing.push('Source commit not supplied')
  const records = new Map<string, ContractRecord>()
  for (const value of manifest.records) {
    const checked = validateRecord(value)
    if (!checked.valid) { report.errors.push(...checked.errors); continue }
    const record = checked.record
    if (records.has(record.id)) report.errors.push(`Duplicate record ID ${record.id}`)
    records.set(record.id, record)
    if (record.kind === 'prediction-commit' && !(await verifyPredictionCommit(record))) report.errors.push(`Invalid prediction digest ${record.id}`)
    if (record.kind === 'observation') report.artifacts.push(...record.artifacts)
    if (record.kind === 'candidate-anatomy' && record.geometry) report.artifacts.push(record.geometry)
    if (record.kind === 'job' && ['failed', 'cancelled', 'blocked'].includes(record.state)) report.unsuccessfulAttempts.push({ id: record.id, state: record.state, reasons: [record.missingReason ?? record.state] })
    if (record.kind === 'evaluation' && record.outcome !== 'scored') report.unsuccessfulAttempts.push({ id: record.id, state: record.outcome, reasons: record.exclusions.map(e => e.reason) })
  }
  report.recordCount = records.size
  report.trialCount = manifest.trials.length
  for (const trial of manifest.trials) {
    if (!trial || typeof trial.id !== 'string' || !Array.isArray(trial.history) || typeof trial.state !== 'string') { report.errors.push('Malformed trial history'); continue }
    if (['failed', 'cancelled', 'excluded'].includes(trial.state)) report.unsuccessfulAttempts.push({ id: trial.id, state: trial.state, reasons: trial.history.map(h => h.reason) })
  }
  for (const record of records.values()) {
    if (record.kind !== 'evaluation') continue
    const commit = records.get(record.predictionId)
    if (commit?.kind !== 'prediction-commit') report.missing.push(`Evaluation ${record.id}: prediction commit missing`)
    else report.errors.push(...(await validateProspectiveEvaluation(commit, record)).map(e => `${record.id}: ${e}`))
    for (const id of record.observationIds) {
      const observation = records.get(id)
      if (observation?.kind !== 'observation') report.missing.push(`Evaluation ${record.id}: observation ${id} missing`)
      else if (observation.predictionId !== record.predictionId) report.errors.push(`Observation ${id}: prediction mismatch`)
    }
  }
  if (![...records.values()].some(r => r.provenance.kind === 'engine-generated')) report.missing.push('Lead A engine outputs absent; scientific benchmark unavailable')
  if (!records.size) report.missing.push('No observations or experimental records exported')
  report.status = report.errors.length ? 'invalid' : report.missing.length ? 'incomplete' : 'valid-metadata'
  return report
}
export function readableReport(report: EvidenceReport): string {
  return [`# Evidence audit: ${report.status}`, '', `${report.recordCount} records; ${report.trialCount} trials; ${report.unsuccessfulAttempts.length} retained unsuccessful attempts.`, '', ...report.errors.map(s => `ERROR: ${s}`), ...report.missing.map(s => `MISSING: ${s}`), ...report.unsuccessfulAttempts.map(a => `ATTEMPT ${a.id} (${a.state}): ${a.reasons.join('; ')}`), '', ...report.limitations.map(s => `LIMITATION: ${s}`), ''].join('\n')
}
