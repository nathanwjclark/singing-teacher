import { canonicalJson, validateRecord, validateProspectiveEvaluation, verifyPredictionCommit } from '../contracts/index.ts'
import type { ContractRecord, EvaluationRecord, ObservationBundle, PredictionCommit } from '../contracts/index.ts'

export const MODALITIES = ['audio', 'audio+rgb', 'audio+rgb+measured-depth'] as const
export type ComparisonModality = typeof MODALITIES[number]
/** Run metadata is supplied by the producer, never inferred from which sensors happen to be on. */
export interface ModalityRun {
  id: string
  comparisonId: string
  caseId: string
  protocolId: string
  modality: ComparisonModality
  predictionId: string
  evaluationId: string
  inputObservationIds: string[]
  solverCallsUsed: number
  articulationParameterCount: number
}
export interface ComparisonImport { records: ContractRecord[]; runs: ModalityRun[] }
export interface ComparisonCase {
  comparisonId: string
  caseId: string
  protocolId: string
  status: 'complete' | 'incomplete'
  budget: number | null
  reasons: string[]
  runs: Partial<Record<ComparisonModality, ModalityRun>>
  features: { name: string; unit: string; scores: Record<ComparisonModality, number | null>; depthImprovement: number | null }[]
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
export function isMeasuredDepth(observation: ObservationBundle): boolean {
  const depth = observation.streams.find(stream => stream.modality === 'depth')
  // A sensor declaration plus calibrated, captured depth is required. Landmark z is not sensor depth.
  return observation.provenance.kind !== 'development-fixture' && !!depth?.samples.length && depth.missingReason === null && !!depth.depth && depth.calibration.artifactId !== null && depth.calibration.missingReason === null && depth.settings.depthSource === 'hardware' && depth.samples.some(sample => sample.quality.missingReason === null)
}
export async function parseComparisonImport(value: unknown): Promise<ComparisonImport> {
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const rawRecords = Array.isArray(value) ? value : Array.isArray(envelope?.records) ? envelope.records : [value]
  if (rawRecords.length > 10_000) throw new Error('Import at most 10,000 metadata records at a time.')
  const records: ContractRecord[] = []
  for (const raw of rawRecords) {
    const parsed = validateRecord(raw)
    if (!parsed.valid) throw new Error(parsed.errors.join('\n'))
    if (parsed.record.kind === 'prediction-commit' && !(await verifyPredictionCommit(parsed.record))) throw new Error(`Prediction ${parsed.record.id}: digest does not match.`)
    records.push(parsed.record)
  }
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Imported record IDs must be unique.')
  const rawRuns = envelope?.runs ?? []
  if (!Array.isArray(rawRuns)) throw new Error('Comparison runs must be an array.')
  const runs: ModalityRun[] = []
  for (const raw of rawRuns) {
    const run = raw as ModalityRun
    if (!run || !['id', 'comparisonId', 'caseId', 'protocolId', 'predictionId', 'evaluationId'].every(key => nonempty((raw as Record<string, unknown>)[key])) || !MODALITIES.includes(run.modality) || !Array.isArray(run.inputObservationIds) || !run.inputObservationIds.every(nonempty) || !count(run.solverCallsUsed) || !count(run.articulationParameterCount)) throw new Error('Comparison runs need IDs, protocol, modality, input observation IDs, solver usage and articulation count.')
    const commit = records.find(record => record.id === run.predictionId)
    const evaluation = records.find(record => record.id === run.evaluationId)
    if (commit?.kind !== 'prediction-commit' || evaluation?.kind !== 'evaluation') throw new Error(`Run ${run.id}: include its prediction commit and evaluation records.`)
    const errors = await validateProspectiveEvaluation(commit, evaluation)
    if (errors.length) throw new Error(`Run ${run.id}: ${errors.join('; ')}`)
    runs.push(run)
  }
  if (new Set(runs.map(run => run.id)).size !== runs.length) throw new Error('Comparison run IDs must be unique.')
  return { records, runs }
}

/** Per-case, per-feature comparison. Incomplete arms remain visible and never become zero errors. */
export function compareModalities(records: ContractRecord[], runs: ModalityRun[]): ComparisonCase[] {
  const byId = new Map(records.map(record => [record.id, record]))
  const groups = new Map<string, ModalityRun[]>()
  for (const run of runs) {
    const key = canonicalJson([run.comparisonId, run.protocolId, run.caseId])
    groups.set(key, [...groups.get(key) ?? [], run])
  }
  return [...groups.values()].map(group => {
    const first = group[0]
    const reasons: string[] = []
    const rows: { run: ModalityRun; commit: PredictionCommit; evaluation: EvaluationRecord; signature: string }[] = []
    const mapped: ComparisonCase['runs'] = {}
    for (const modality of MODALITIES) {
      const selected = group.filter(run => run.modality === modality)
      if (selected.length !== 1) { reasons.push(`${modality}: ${selected.length ? 'duplicate arms; assign separate case IDs to repeats' : 'run missing'}`); continue }
      const run = selected[0]
      mapped[modality] = run
      const commit = byId.get(run.predictionId)
      const evaluation = byId.get(run.evaluationId)
      if (commit?.kind !== 'prediction-commit' || evaluation?.kind !== 'evaluation' || !validateRecord(commit).valid || !validateRecord(evaluation).valid) { reasons.push(`${modality}: valid prediction/evaluation missing`); continue }
      if (evaluation.predictionId !== commit.id || evaluation.predictionSha256 !== commit.sha256) reasons.push(`${modality}: prediction reference mismatch`)
      if (Date.parse(evaluation.captureStartedAt) <= Date.parse(commit.committedAt)) reasons.push(`${modality}: capture did not follow the frozen forecast`)
      if (evaluation.outcome !== 'scored') reasons.push(`${modality}: ${evaluation.outcome} — ${evaluation.exclusions.map(item => item.reason).join('; ')}`)
      if (commit.forecast.provenance.kind !== 'engine-generated') reasons.push(`${modality}: engine forecast unavailable`)
      if (!count(run.solverCallsUsed) || run.solverCallsUsed > commit.forecast.budget.limit) reasons.push(`${modality}: solver budget exceeded or invalid`)
      const inputs = run.inputObservationIds.map(id => byId.get(id))
      if (!inputs.length || inputs.some(record => record?.kind !== 'observation' || !validateRecord(record).valid || !commit.forecast.evidenceIds.includes(record.id))) reasons.push(`${modality}: declared fitting observations unavailable or absent from forecast evidence`)
      const observations = inputs.filter((record): record is ObservationBundle => record?.kind === 'observation')
      const has = (name: string) => observations.some(observation => observation.streams.some(stream => stream.modality === name && stream.samples.some(sample => sample.quality.missingReason === null) && stream.missingReason === null))
      if (!has('audio')) reasons.push(`${modality}: captured fitting audio missing`)
      if (modality !== 'audio' && !has('rgb')) reasons.push(`${modality}: captured fitting RGB missing`)
      if (modality === 'audio+rgb+measured-depth' && !observations.some(isMeasuredDepth)) reasons.push(`${modality}: calibrated sensor depth missing; browser landmarks do not qualify`)
      const targets = evaluation.observationIds.map(id => byId.get(id))
      if (!targets.length || targets.some(record => record?.kind !== 'observation' || !validateRecord(record).valid)) reasons.push(`${modality}: held-out observations missing`)
      if (targets.some(record => record?.kind === 'observation' && (commit.forecast.evaluationMode === 'human-held-out' ? record.provenance.kind !== 'human-observation' : record.provenance.kind !== 'engine-generated'))) reasons.push(`${modality}: held-out evidence origin does not match evaluation mode`)
      if (new Set(evaluation.errors.map(error => `${error.name}:${error.unit}`)).size !== evaluation.errors.length) reasons.push(`${modality}: duplicate scoring features`)
      const targetHashes = targets.flatMap(record => record?.kind === 'observation' ? record.streams.filter(stream => stream.modality === 'audio').flatMap(stream => stream.samples.map(sample => record.artifacts.find(artifact => artifact.id === sample.artifactId)?.sha256 ?? 'missing')) : []).sort()
      if (!targetHashes.length || targetHashes.includes('missing')) reasons.push(`${modality}: held-out audio artifact hashes missing`)
      if (evaluation.observationIds.some(id => commit.forecast.evidenceIds.includes(id) || run.inputObservationIds.includes(id))) reasons.push(`${modality}: held-out evidence overlaps fitting inputs`)
      const inputHashes = observations.flatMap(observation => observation.artifacts.map(artifact => artifact.sha256))
      if (targetHashes.some(hash => inputHashes.includes(hash))) reasons.push(`${modality}: held-out audio hash overlaps fitting inputs`)
      if (evaluation.errors.some(error => error.value === null || error.value < 0)) reasons.push(`${modality}: missing or invalid feature errors`)
      const signature = canonicalJson({ budget: commit.forecast.budget, articulation: run.articulationParameterCount, mode: commit.forecast.evaluationMode, scoringRule: commit.forecast.scoringRule, intervention: commit.forecast.intervention, targets: targetHashes, features: evaluation.errors.map(error => [error.name, error.unit]).sort() })
      rows.push({ run, commit, evaluation, signature })
    }
    if (new Set(rows.map(row => row.signature)).size > 1) reasons.push('Arms differ in held-out audio, intervention, scoring features, evaluation mode, budget or articulation freedom.')
    const complete = reasons.length === 0 && rows.length === MODALITIES.length
    const featureKeys = new Map(rows.flatMap(row => row.evaluation.errors.map(error => [canonicalJson([error.name, error.unit]), error] as const)))
    const features = [...featureKeys.values()].map(feature => {
      const scores = Object.fromEntries(MODALITIES.map(modality => {
        const row = rows.find(item => item.run.modality === modality)
        const error = row?.evaluation.errors.find(error => error.name === feature.name && error.unit === feature.unit)
        return [modality, row?.evaluation.outcome === 'scored' ? error?.value ?? null : null]
      })) as Record<ComparisonModality, number | null>
      return { name: feature.name, unit: feature.unit, scores, depthImprovement: complete ? scores['audio+rgb']! - scores['audio+rgb+measured-depth']! : null }
    })
    return { comparisonId: first.comparisonId, caseId: first.caseId, protocolId: first.protocolId, status: complete ? 'complete' : 'incomplete', budget: complete ? rows[0].commit.forecast.budget.limit : null, reasons, runs: mapped, features }
  })
}
