import { CONTRACT_VERSION, canonicalJson, validateRecord, verifyPredictionCommit } from '../contracts/index.ts'
import type { AudioMeasurement, EvaluationRecord, Forecast, Measurement, ObservationBundle, PredictionCommit } from '../contracts/index.ts'

export const SCORING_RULE = 'absolute-error-v1'
/** Kept by the evaluator; do not expose target measurements to fitting/planning. */
export interface HeldOutSet {
  observationIds: string[]
  participantIds?: string[]
  sessionIds?: string[]
  fitParticipantIds?: string[]
  fitSessionIds?: string[]
  fitArtifactHashes?: string[]
}
export interface BaselineInput {
  name: string
  commit: PredictionCommit
  solverCallsUsed: number
  articulationParameterCount: number
}
export interface EvaluationInput {
  commit: PredictionCommit
  observation: ObservationBundle
  audio: AudioMeasurement
  captureStartedAt: string
  scoredAt?: string
  evaluationId?: string
  heldOut: HeldOutSet
  solverCallsUsed: number
  articulationParameterCount: number
  baseline?: BaselineInput
}
const count = (n: number) => Number.isInteger(n) && n >= 0
const key = (m: Measurement) => `${m.name}:${m.unit}`
function score(forecast: Forecast, actual: AudioMeasurement): Measurement[] {
  return forecast.outcomes.map(predicted => {
    const measured = actual.measurements.find(m => key(m) === key(predicted))
    const reason = predicted.missingReason ?? measured?.missingReason ?? (measured ? null : 'not-captured')
    return { name: `${predicted.name}-absolute-error`, unit: predicted.unit, value: reason || predicted.value === null || measured?.value == null ? null : Math.abs(predicted.value - measured.value), uncertainty: null, missingReason: reason }
  })
}
/** Pure scoring boundary: never fits, updates or calls an inference engine. */
export async function evaluatePrediction(input: EvaluationInput): Promise<EvaluationRecord> {
  // Own a JSON snapshot before awaiting digest work; callers cannot change the target mid-score.
  const x = JSON.parse(canonicalJson(input)) as EvaluationInput
  const { commit, observation, audio, heldOut } = x
  const scoredAt = x.scoredAt ?? new Date().toISOString()
  const failed: string[] = []
  const excluded: string[] = []
  for (const record of [commit, observation, audio]) {
    const result = validateRecord(record)
    if (!result.valid) failed.push(...result.errors)
  }
  const captureTime = Date.parse(x.captureStartedAt)
  if (!Number.isFinite(captureTime) || !Number.isFinite(Date.parse(scoredAt))) throw new Error('Evaluation requires valid capture and score timestamps')
  if (Date.parse(scoredAt) < captureTime) throw new Error('Score cannot predate capture')
  if (!(await verifyPredictionCommit(commit))) failed.push('Prediction digest is invalid')
  if (captureTime <= Date.parse(commit.committedAt)) failed.push('Capture must begin after prediction commitment')
  if (Date.parse(observation.createdAt) < captureTime || Date.parse(audio.createdAt) < captureTime || Date.parse(audio.createdAt) > Date.parse(scoredAt)) failed.push('Observation/measurement chronology conflicts with capture or scoring')
  if (commit.forecast.scoringRule !== SCORING_RULE) failed.push(`Unsupported scoring rule: ${commit.forecast.scoringRule}`)
  if (observation.predictionId !== commit.id) failed.push('Observation references a different prediction')
  if (audio.observationId !== observation.id) failed.push('Audio measurement references a different observation')
  const stream = observation.streams.find(s => s.modality === 'audio')
  const artifact = observation.artifacts.find(a => a.id === audio.artifactId)
  if (!artifact || !stream?.samples.some(s => s.artifactId === audio.artifactId)) failed.push('Audio measurement artifact is not a captured audio sample')
  if (stream && audio.timebase.clockId !== stream.timebase.clockId) failed.push('Audio measurement uses a different capture clock')
  if (!heldOut.observationIds.includes(observation.id)) failed.push('Observation is outside declared held-out set')
  if (heldOut.participantIds && !heldOut.participantIds.includes(observation.participantId)) failed.push('Participant is outside declared held-out set')
  if (heldOut.sessionIds && !heldOut.sessionIds.includes(observation.sessionId)) failed.push('Session is outside declared held-out set')
  if (heldOut.participantIds && heldOut.fitParticipantIds?.includes(observation.participantId)) failed.push('Held-out participant overlaps fitting participants')
  if (heldOut.sessionIds && heldOut.fitSessionIds?.includes(observation.sessionId)) failed.push('Held-out session overlaps fitting sessions')
  const targetIds = [observation.id, audio.id, ...observation.artifacts.map(a => a.id)]
  const targetHashes = observation.artifacts.map(a => a.sha256)
  for (const candidate of [commit, ...(x.baseline ? [x.baseline.commit] : [])]) {
    if (targetIds.some(id => [...candidate.forecast.evidenceIds, ...candidate.forecast.provenance.sourceIds].includes(id))) failed.push('Held-out target overlaps prediction fitting evidence')
    if (targetHashes.some(hash => [...candidate.forecast.provenance.sourceHashes, ...(heldOut.fitArtifactHashes ?? [])].includes(hash))) failed.push('Held-out media hash overlaps fitting media')
  }
  if (!count(x.solverCallsUsed) || x.solverCallsUsed > commit.forecast.budget.limit) failed.push('Solver usage exceeds declared budget or is invalid')
  if (!count(x.articulationParameterCount)) failed.push('Articulation parameter count is invalid')
  if (commit.forecast.evaluationMode === 'human-held-out' && observation.provenance.kind !== 'human-observation') failed.push('Human evaluation requires a human observation')
  if (commit.forecast.evaluationMode === 'synthetic-held-out' && observation.provenance.kind !== 'engine-generated') excluded.push('Synthetic evaluation requires engine-generated evidence; development fixtures are not scientific results')
  for (const items of [commit.forecast.outcomes, audio.measurements]) if (new Set(items.map(key)).size !== items.length) failed.push('Duplicate feature names/units are ambiguous')
  if (audio.quality.missingReason || !stream?.samples.length) excluded.push(`Audio unavailable: ${audio.quality.missingReason ?? stream?.missingReason ?? 'not-captured'}`)
  if (x.baseline) {
    const b = x.baseline
    if (!(await verifyPredictionCommit(b.commit))) failed.push('Baseline prediction digest is invalid')
    if (Date.parse(b.commit.committedAt) >= captureTime) failed.push('Baseline was not committed before capture')
    if (b.commit.forecast.budget.limit !== commit.forecast.budget.limit || b.commit.forecast.budget.unit !== commit.forecast.budget.unit) failed.push('Baseline budget differs from forecast budget')
    if (!count(b.solverCallsUsed) || b.solverCallsUsed > b.commit.forecast.budget.limit) failed.push('Baseline solver usage is invalid or over budget')
    if (b.articulationParameterCount !== x.articulationParameterCount) failed.push('Baseline articulation freedom differs')
    if (b.commit.forecast.scoringRule !== SCORING_RULE || b.commit.forecast.evaluationMode !== commit.forecast.evaluationMode || b.commit.forecast.experimentId !== commit.forecast.experimentId || b.commit.forecast.intervention !== commit.forecast.intervention) failed.push('Baseline protocol differs')
    if (canonicalJson(b.commit.forecast.outcomes.map(key).sort()) !== canonicalJson(commit.forecast.outcomes.map(key).sort())) failed.push('Baseline target features differ')
  }
  const errors = failed.length || excluded.length ? [] : score(commit.forecast, audio)
  if (!failed.length && !excluded.length && (errors.some(m => m.value === null) || (x.baseline && score(x.baseline.commit.forecast, audio).some(m => m.value === null)))) excluded.push('One or more preregistered target features are unavailable; no partial-score comparison')
  const reasons = [...failed, ...excluded]
  return {
    schemaVersion: CONTRACT_VERSION, kind: 'evaluation', id: x.evaluationId ?? globalThis.crypto.randomUUID(), createdAt: scoredAt,
    provenance: { kind: 'derived-measurement', producer: 'independent-evaluator', producerVersion: '1.0.0', sourceIds: [commit.id, observation.id, audio.id], sourceHashes: [commit.sha256, ...targetHashes] },
    predictionId: commit.id, predictionSha256: commit.sha256, observationIds: [observation.id], captureStartedAt: x.captureStartedAt, scoredAt,
    outcome: failed.length ? 'failed' : excluded.length ? 'excluded' : 'scored', errors: reasons.length ? [] : errors,
    exclusions: reasons.map(reason => ({ observationId: observation.id, reason })),
    baseline: x.baseline ? { name: x.baseline.name, errors: reasons.length ? [] : score(x.baseline.commit.forecast, audio), budget: x.baseline.commit.forecast.budget } : null,
    executionNotes: `${SCORING_RULE}; per-feature native units, no cross-unit aggregate. Solver calls ${x.solverCallsUsed}/${commit.forecast.budget.limit}; articulation parameters ${x.articulationParameterCount}. ${x.baseline ? `Baseline solver calls ${x.baseline.solverCallsUsed}.` : 'No baseline supplied; comparative improvement unavailable.'} ${reasons.join('; ')}`,
  }
}
