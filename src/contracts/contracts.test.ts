import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTRACT_VERSION, createPredictionCommit, validateRecord, verifyPredictionCommit, validateProspectiveEvaluation } from './index.ts'
import type { Forecast, ObservationBundle, EvaluationRecord } from './index.ts'

test('contract boundary preserves missing depth, frozen predictions and held-out chronology', async () => {
  const provenance = { kind: 'development-fixture' as const, producer: 'contracts-smoke', producerVersion: '1', sourceIds: [], sourceHashes: [] }
  const base = { schemaVersion: CONTRACT_VERSION, createdAt: '2026-09-10T12:00:00Z', provenance }
  const bundle: ObservationBundle = { ...base, kind: 'observation', id: 'obs-1', participantId: 'fixture-person', sessionId: 'session-1', trialId: 'trial-1', predictionId: null, consentScope: ['local-only'], task: 'contract fixture', artifacts: [], streams: ['audio', 'rgb', 'depth'].map(modality => ({ modality: modality as 'audio' | 'rgb' | 'depth', timebase: { clockId: 'clock-1', origin: 'session-start', unit: 'ms', syncUncertaintyMs: null, referenceClockId: null, offsetToReferenceMs: null }, samples: [], missingReason: 'not-captured', droppedSamples: 0, settings: {}, calibration: { artifactId: null, missingReason: 'not-calibrated' }, depth: null })) }
  assert.equal(validateRecord(bundle).valid, true)
  assert.equal(validateRecord({ ...bundle, schemaVersion: '99.0.0' }).valid, false)
  assert.equal(validateRecord({ ...bundle, streams: bundle.streams.map(stream => ({ ...stream, missingReason: null })) }).valid, false)
  const forecast: Forecast = { ...base, kind: 'forecast', id: 'forecast-1', modelId: 'fixture-model', modelVersion: '1', evidenceIds: ['fit-1'], experimentId: 'experiment-1', intervention: 'fixture vowel', availability: 'available', missingReason: null, outcomes: [{ name: 'f0', value: 220, unit: 'Hz', uncertainty: 4, missingReason: null }], scoringRule: 'absolute-error-v1', evaluationMode: 'synthetic-held-out', budget: { unit: 'solver-calls', limit: 10 } }
  const commit = await createPredictionCommit(forecast, { id: 'prediction-1', committedAt: '2026-09-10T12:01:00Z', provenance })
  forecast.outcomes[0].value = 440
  assert.equal(commit.forecast.outcomes[0].value, 220)
  assert.equal(Object.isFrozen(commit.forecast.outcomes[0]), true)
  assert.equal(await verifyPredictionCommit(commit), true)
  assert.equal(await verifyPredictionCommit({ ...commit, id: 'edited-after-outcome' }), false)
  const evaluation: EvaluationRecord = { ...base, kind: 'evaluation', id: 'evaluation-1', predictionId: commit.id, predictionSha256: commit.sha256, observationIds: ['held-out-1'], captureStartedAt: '2026-09-10T12:02:00Z', scoredAt: '2026-09-10T12:03:00Z', outcome: 'scored', errors: [{ name: 'f0-error', value: 2, unit: 'Hz', uncertainty: null, missingReason: null }], exclusions: [], baseline: { name: 'fixture-baseline', errors: [], budget: forecast.budget }, executionNotes: 'Development fixture only' }
  assert.deepEqual(await validateProspectiveEvaluation(commit, evaluation), [])
  assert.ok((await validateProspectiveEvaluation(commit, { ...evaluation, captureStartedAt: '2026-09-10T12:00:00Z', observationIds: ['fit-1'] })).length >= 2)
  assert.equal(validateRecord({ ...forecast, availability: 'unavailable', missingReason: 'engine-unavailable' }).valid, false)
})
