import { CONTRACT_VERSION, createPredictionCommit, validateRecord, validateProspectiveEvaluation, verifyPredictionCommit } from '../contracts/index.ts'
import type { Forecast, PredictionCommit, ObservationBundle, EvaluationRecord } from '../contracts/index.ts'

export type ExperimentState = 'proposed' | 'validated' | 'committed' | 'capturing' | 'captured' | 'scored' | 'excluded' | 'failed' | 'cancelled' | 'update-eligible'
export interface ExperimentTrial {
  id: string
  proposal: { experimentId: string; task: string }
  state: ExperimentState
  forecast: Forecast | null
  commit: PredictionCommit | null
  observation: ObservationBundle | null
  evaluation: EvaluationRecord | null
  captureStartedAt: string | null
  retryOf: string | null
  history: { state: ExperimentState; at: string; reason: string }[]
}
const now = () => new Date().toISOString()
const copy = <T,>(value: T): T => structuredClone(value)
function requireState(trial: ExperimentTrial, ...states: ExperimentState[]) {
  if (!states.includes(trial.state)) throw new Error(`Cannot perform this action while ${trial.state}.`)
}
function transition(trial: ExperimentTrial, state: ExperimentState, reason: string, at = now()): ExperimentTrial {
  return { ...copy(trial), state, history: [...trial.history, { state, at, reason }] }
}
export function proposeExperiment(experimentId: string, task: string, retryOf: string | null = null): ExperimentTrial {
  if (!experimentId.trim() || !task.trim()) throw new Error('An experiment ID and capture instruction are required.')
  return { id: crypto.randomUUID(), proposal: { experimentId: experimentId.trim(), task: task.trim() }, state: 'proposed', forecast: null, commit: null, observation: null, evaluation: null, captureStartedAt: null, retryOf, history: [{ state: 'proposed', at: now(), reason: retryOf ? `Retry of ${retryOf}; requires a new prediction commit.` : 'User proposed an experiment.' }] }
}
export function importForecast(trial: ExperimentTrial, value: unknown): ExperimentTrial {
  requireState(trial, 'proposed', 'validated')
  const parsed = validateRecord(value)
  if (!parsed.valid) throw new Error(parsed.errors.join('\n'))
  if (parsed.record.kind !== 'forecast') throw new Error('Import a KIT forecast record.')
  const forecast = parsed.record
  if (forecast.availability !== 'available') throw new Error(`Forecast blocked: ${forecast.missingReason}. A numerical engine forecast is required.`)
  if (forecast.provenance.kind !== 'engine-generated' || forecast.provenance.sourceIds.length === 0 || forecast.provenance.sourceHashes.length === 0) throw new Error('Forecast must include engine provenance and source hashes.')
  if (forecast.experimentId !== trial.proposal.experimentId || forecast.intervention !== trial.proposal.task) throw new Error('Forecast experiment ID and intervention must exactly match the proposal.')
  if (forecast.evaluationMode !== 'human-held-out') throw new Error('Live recording requires a human-held-out forecast. Synthetic evaluation belongs in offline replay.')
  return { ...transition(trial, 'validated', 'Forecast schema, proposal and provenance validated; engine claims remain subject to scientific review.'), forecast: copy(forecast) }
}
export async function commitExperiment(trial: ExperimentTrial): Promise<ExperimentTrial> {
  requireState(trial, 'validated')
  if (!trial.forecast) throw new Error('A validated numerical forecast is required.')
  const commit = await createPredictionCommit(trial.forecast, { id: crypto.randomUUID(), committedAt: now(), provenance: { kind: 'derived-measurement', producer: 'singing-teacher/experiment-ledger', producerVersion: CONTRACT_VERSION, sourceIds: [trial.forecast.id], sourceHashes: trial.forecast.provenance.sourceHashes } })
  return { ...transition(trial, 'committed', 'Prediction frozen before recording.'), commit }
}
export async function startExperimentCapture(trial: ExperimentTrial, at = now()): Promise<ExperimentTrial> {
  requireState(trial, 'committed')
  if (!trial.commit || !(await verifyPredictionCommit(trial.commit))) throw new Error('Prediction digest is invalid.')
  if (Date.parse(at) <= Date.parse(trial.commit.committedAt)) throw new Error('Capture must start after the prediction commit.')
  return { ...transition(trial, 'capturing', 'User explicitly started capture.', at), captureStartedAt: at }
}
export function finishExperimentCapture(trial: ExperimentTrial, value: unknown): ExperimentTrial {
  requireState(trial, 'capturing')
  const parsed = validateRecord(value)
  if (!parsed.valid) throw new Error(parsed.errors.join('\n'))
  if (parsed.record.kind !== 'observation') throw new Error('Capture must return an observation bundle.')
  const observation = parsed.record
  if (observation.provenance.kind === 'development-fixture') throw new Error('Development fixtures cannot be used in human prospective trials.')
  if (observation.predictionId !== trial.commit?.id || observation.trialId !== trial.id || observation.task !== trial.proposal.task) throw new Error('Capture does not belong to this committed trial.')
  if (trial.commit.forecast.evidenceIds.includes(observation.id)) throw new Error('Captured observation overlaps the forecast fitting evidence.')
  return { ...transition(trial, 'captured', 'Recording stopped; awaiting independent evaluation.'), observation: copy(observation) }
}
export async function scoreExperiment(trial: ExperimentTrial, value: unknown): Promise<ExperimentTrial> {
  requireState(trial, 'captured')
  const parsed = validateRecord(value)
  if (!parsed.valid) throw new Error(parsed.errors.join('\n'))
  if (parsed.record.kind !== 'evaluation' || !trial.commit || !trial.observation) throw new Error('An evaluation of the captured trial is required.')
  const evaluation = parsed.record
  if (evaluation.provenance.kind === 'development-fixture') throw new Error('Development fixture scores cannot release human evidence for update.')
  const errors = await validateProspectiveEvaluation(trial.commit, evaluation)
  if (evaluation.captureStartedAt !== trial.captureStartedAt || evaluation.observationIds.length !== 1 || evaluation.observationIds[0] !== trial.observation.id) errors.push('Evaluation must reference this exact capture and start time.')
  if (errors.length) throw new Error(errors.join('\n'))
  return { ...transition(trial, evaluation.outcome, evaluation.outcome === 'scored' ? 'Independent evaluation recorded before any model update.' : evaluation.exclusions.map(item => item.reason).join('; ')), evaluation: copy(evaluation) }
}
export function markUpdateEligible(trial: ExperimentTrial): ExperimentTrial {
  requireState(trial, 'scored')
  return transition(trial, 'update-eligible', 'Scored evidence may now be sent to the fitting engine. No model was changed by this action.')
}
export function stopExperiment(trial: ExperimentTrial, state: 'failed' | 'cancelled', reason: string): ExperimentTrial {
  requireState(trial, 'proposed', 'validated', 'committed', 'capturing', 'captured')
  if (!reason.trim()) throw new Error('Keep a reason for failed or cancelled trials.')
  return transition(trial, state, reason)
}
export function retryExperiment(trial: ExperimentTrial): ExperimentTrial {
  requireState(trial, 'failed', 'cancelled', 'excluded')
  return proposeExperiment(trial.proposal.experimentId, trial.proposal.task, trial.id)
}

const STORAGE_KEY = 'singing-teacher.experiments.v1'
const EVENT = 'singing-teacher:experiments'
/** Small metadata only. Recordings remain in separately exported media artifacts. */
export function readExperimentLedger(): ExperimentTrial[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); return Array.isArray(value) ? value.filter(isTrial) : [] } catch { return [] }
}
function isTrial(value: unknown): value is ExperimentTrial {
  if (!value || typeof value !== 'object') return false
  const trial = value as ExperimentTrial
  return typeof trial.id === 'string' && typeof trial.proposal?.experimentId === 'string' && typeof trial.proposal?.task === 'string' && Array.isArray(trial.history) && ['proposed', 'validated', 'committed', 'capturing', 'captured', 'scored', 'excluded', 'failed', 'cancelled', 'update-eligible'].includes(trial.state)
}
export function writeExperimentLedger(trials: ExperimentTrial[]): void {
  const json = JSON.stringify(trials)
  if (json.length > 2_000_000) throw new Error('Ledger storage is full. Export metadata before starting more trials.')
  localStorage.setItem(STORAGE_KEY, json)
  window.dispatchEvent(new Event(EVENT))
}
export function subscribeExperimentLedger(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', callback) }
}
export async function restoreExperimentLedger(): Promise<ExperimentTrial[]> {
  const records = readExperimentLedger()
  const restored: ExperimentTrial[] = []
  for (const trial of records) {
    if (trial.commit && !(await verifyPredictionCommit(trial.commit))) {
      restored.push(transition(trial, 'failed', 'Stored prediction digest failed verification. Trial quarantined.'))
    } else if (['committed', 'capturing', 'captured', 'scored', 'excluded', 'update-eligible'].includes(trial.state) && !trial.commit) {
      restored.push(transition(trial, 'failed', 'Stored trial is missing its committed prediction. Trial quarantined.'))
    } else if (['scored', 'update-eligible'].includes(trial.state) && (!trial.evaluation || !trial.observation || !validateRecord(trial.observation).valid || !validateRecord(trial.evaluation).valid || (await validateProspectiveEvaluation(trial.commit!, trial.evaluation)).length > 0 || trial.evaluation.outcome !== 'scored' || trial.evaluation.captureStartedAt !== trial.captureStartedAt || trial.evaluation.observationIds.length !== 1 || trial.evaluation.observationIds[0] !== trial.observation.id)) {
      restored.push(transition(trial, 'failed', 'Stored scored evidence failed verification. Trial quarantined.'))
    } else if (trial.state === 'capturing') {
      restored.push(transition(trial, 'failed', 'Page reloaded during capture. Interrupted trial retained; retry requires a new commit.'))
    } else restored.push(trial)
  }
  return restored
}
