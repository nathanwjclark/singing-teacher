import { validateRecord, verifyPredictionCommit } from '../contracts/index.ts'
import type { ObservationBundle, ObservationStream, PredictionCommit } from '../contracts/index.ts'

export type DepthModality = ObservationStream['modality']
export interface DepthProtocol {
  version: '1.0.0'
  id: string
  modalities: DepthModality[]
  repeats: number
  trialDurationSeconds: number
  syncGoalMs: number
  steps: { id: string; instruction: string; phase: 'bench' | 'calibration' | 'trial' }[]
}
export const DEFAULT_DEPTH_PROTOCOL: DepthProtocol = {
  version: '1.0.0', id: 'comfortable-vowel-depth-v1', modalities: ['audio', 'rgb', 'depth'],
  repeats: 3, trialDurationSeconds: 5, syncGoalMs: 20,
  steps: [
    { id: 'rigid-target', phase: 'bench', instruction: 'Before human depth trials, capture a known-size rigid target and cavity-like bench object at repeatable distances and angles. Retain scale error, repeatability and missing-depth fraction.' },
    { id: 'alignment', phase: 'calibration', instruction: 'Record a visible and audible event at the beginning and end of a test recording. Measure clock offset and drift over the intended trial duration.' },
    { id: 'room', phase: 'calibration', instruction: 'Keep microphone gain, room, phone, camera mode and lighting fixed. Retain ambient-noise and microphone calibration results.' },
    { id: 'baseline', phase: 'trial', instruction: 'Face the selected camera in a comfortable position. Record a five-second comfortable sustained “ah” at your usual pitch and loudness. Do not force your mouth open.' },
    { id: 'repeat', phase: 'trial', instruction: 'Rest, then repeat the same vowel twice. Use a separate trial ID and freeze the corresponding forecast before each recording. Preserve failed trials.' },
    { id: 'comparison', phase: 'trial', instruction: 'Use the same recorded trials for the audio, audio + RGB and audio + RGB + measured-depth comparison. Keep held-out trials and fitting budgets identical.' },
  ],
}
export interface DepthCheck { id: string; label: string; status: 'pass' | 'blocked' | 'review'; detail: string }
export interface DepthProtocolReport {
  protocolId: string
  observationId: string | null
  predictionId: string | null
  captureStartedAt: string | null
  status: 'ready-for-review' | 'blocked'
  checks: DepthCheck[]
}
/** Capture start is a capture-owner receipt, never the bundle's export/creation timestamp. */
export async function inspectDepthTrial(protocol: DepthProtocol, observation?: ObservationBundle, commit?: PredictionCommit, captureStartedAt?: string): Promise<DepthProtocolReport> {
  const checks: DepthCheck[] = []
  const add = (id: string, label: string, condition: boolean, detail: string) => checks.push({ id, label, status: condition ? 'pass' : 'blocked', detail })
  add('protocol', 'Protocol requirements', protocol.modalities.includes('audio') && new Set(protocol.modalities).size === protocol.modalities.length && protocol.modalities.every(value => ['audio', 'rgb', 'depth'].includes(value)) && Number.isFinite(protocol.syncGoalMs) && protocol.syncGoalMs > 0, 'Audio is required; requested modalities and a positive synchronization goal must be explicit.')
  const validObservation = observation ? validateRecord(observation) : null
  add('bundle', 'Observation bundle', !!validObservation?.valid, observation ? validObservation?.valid ? observation.id : validObservation?.errors.join('; ') ?? 'Invalid bundle' : 'Record deliberately or import a capture bundle; nothing is recorded by this protocol.')
  const validCommit = commit ? await verifyPredictionCommit(commit) : false
  add('prediction', 'Frozen numerical forecast', validCommit, validCommit ? `${commit!.id}: digest verified` : 'Import a valid committed forecast from the modeling engine. This panel does not create predictions.')
  const started = captureStartedAt && /T.*(Z|[+-]\d\d:\d\d)$/.test(captureStartedAt) ? Date.parse(captureStartedAt) : NaN
  add('prospective', 'Prediction before acquisition', validCommit && Number.isFinite(started) && started > Date.parse(commit!.committedAt), captureStartedAt ? `Capture-owner start receipt: ${captureStartedAt}` : 'Capture-start receipt unavailable. Bundle creation time cannot establish prospective acquisition.')
  if (observation && validObservation?.valid) {
    add('link', 'Prediction and held-out evidence', !!commit && observation.predictionId === commit.id && !commit.forecast.evidenceIds.includes(observation.id), 'Observation must reference this commit and must not already be its fitting evidence.')
    add('human', 'Actual human observation', observation.provenance.kind === 'human-observation' && commit?.forecast.evaluationMode === 'human-held-out', 'Development fixtures and synthetic outcomes cannot establish prospective human depth performance.')
    const selected = observation.streams.filter(stream => protocol.modalities.includes(stream.modality))
    for (const modality of protocol.modalities) {
      const stream = selected.find(item => item.modality === modality)
      const captured = !!stream?.samples.some(sample => sample.quality.missingReason === null)
      add(`capture-${modality}`, `${modality.toUpperCase()} acquisition`, captured, captured ? `${stream!.samples.length} timestamped samples; ${stream!.droppedSamples} dropped` : `Unavailable: ${stream?.missingReason ?? 'not captured'}. ${modality === 'depth' ? 'Browser video and landmark estimates are not measured depth.' : ''}`)
      if (!stream || !captured) continue
      const uncertainty = stream.timebase.syncUncertaintyMs
      add(`sync-${modality}`, `${modality.toUpperCase()} synchronization`, uncertainty !== null && uncertainty <= protocol.syncGoalMs, uncertainty === null ? 'Measured synchronization uncertainty missing.' : `${uncertainty} ms uncertainty; provisional goal ≤ ${protocol.syncGoalMs} ms.`)
      if (modality === 'depth') {
        add('measured-depth', 'Measured sensor depth', stream.settings.depthSource === 'hardware' && stream.depth !== null, 'Requires settings.depthSource = hardware and raw depth/disparity units. A fitted face mesh does not qualify.')
        add('depth-calibration', 'Depth calibration', stream.calibration.artifactId !== null, stream.calibration.artifactId ?? 'Missing camera intrinsics / depth alignment calibration artifact.')
      }
      const flags = [...new Set(stream.samples.flatMap(sample => sample.quality.flags))]
      checks.push({ id: `quality-${modality}`, label: `${modality.toUpperCase()} quality`, status: stream.droppedSamples || flags.length ? 'review' : 'pass', detail: `Dropped: ${stream.droppedSamples}. Flags: ${flags.join(', ') || 'none reported'}.` })
    }
    const captured = selected.filter(stream => stream.samples.length)
    const references = captured.map(stream => stream.timebase.referenceClockId ?? stream.timebase.clockId)
    add('common-clock', 'Shared acquisition timebase', references.length === protocol.modalities.length && new Set(references).size === 1, 'Requested streams must share a clock or have measured offsets to one common reference; network arrival time is not alignment.')
  }
  checks.push({ id: 'bench-review', label: 'Bench and calibration review', status: 'review', detail: 'Review scale bias, repeatability, missing-depth fraction, filtered/filled regions, camera alignment, drift and room calibration artifacts. A valid manifest alone does not establish sensor accuracy.' })
  return { protocolId: protocol.id, observationId: observation?.id ?? null, predictionId: commit?.id ?? null, captureStartedAt: captureStartedAt ?? null, status: checks.some(check => check.status === 'blocked') ? 'blocked' : 'ready-for-review', checks }
}
