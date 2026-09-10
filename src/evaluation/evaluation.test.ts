import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTRACT_VERSION, createPredictionCommit, validateRecord } from '../contracts/index.ts'
import type { Forecast, ObservationBundle, AudioMeasurement } from '../contracts/index.ts'
import { evaluatePrediction } from './index.ts'

async function fixture() {
  const provenance = { kind: 'development-fixture' as const, producer: 'evaluator-smoke', producerVersion: '1', sourceIds: [], sourceHashes: [] }
  const base = { schemaVersion: CONTRACT_VERSION, createdAt: '2026-09-10T12:00:00Z', provenance }
  const forecast: Forecast = { ...base, id: 'forecast', kind: 'forecast', modelId: 'model', modelVersion: '1', evidenceIds: ['fit'], experimentId: 'trial', intervention: 'vowel', availability: 'available', missingReason: null, outcomes: [{ name: 'f0', value: 220, unit: 'Hz', uncertainty: null, missingReason: null }], scoringRule: 'absolute-error-v1', evaluationMode: 'human-held-out', budget: { unit: 'solver-calls', limit: 10 } }
  const commit = await createPredictionCommit(forecast, { id: 'commit', committedAt: '2026-09-10T12:01:00Z', provenance })
  const timebase = { clockId: 'clock', origin: 'session-start' as const, unit: 'ms' as const, syncUncertaintyMs: 0, referenceClockId: null, offsetToReferenceMs: null }
  // Synthetic objects intentionally labelled human solely to exercise boundary logic; never saved as app data.
  const observation: ObservationBundle = { ...base, createdAt: '2026-09-10T12:02:00Z', provenance: { ...provenance, kind: 'human-observation' }, id: 'heldout', kind: 'observation', participantId: 'person', sessionId: 'session', trialId: 'trial', predictionId: commit.id, consentScope: ['fixture'], task: 'vowel', artifacts: [{ id: 'wav', uri: 'fixture.wav', sha256: 'a'.repeat(64), mediaType: 'audio/wav', byteLength: 100 }], streams: (['audio', 'rgb', 'depth'] as const).map(modality => ({ modality, timebase, samples: modality === 'audio' ? [{ captureMs: 0, artifactId: 'wav', sequence: 0, quality: { flags: [], missingReason: null } }] : [], missingReason: modality === 'audio' ? null : 'not-captured', droppedSamples: 0, settings: {}, calibration: { artifactId: null, missingReason: 'not-calibrated' }, depth: null })) }
  const audio: AudioMeasurement = { ...base, createdAt: '2026-09-10T12:02:03Z', id: 'measurement', kind: 'audio-measurement', observationId: observation.id, artifactId: 'wav', timebase, window: { startMs: 0, endMs: 1000 }, method: 'fixture', measurements: [{ name: 'f0', value: 222, unit: 'Hz', uncertainty: null, missingReason: null }], quality: { flags: [], missingReason: null }, calibrationId: null }
  return { commit, observation, audio, captureStartedAt: '2026-09-10T12:02:00Z', scoredAt: '2026-09-10T12:03:00Z', heldOut: { observationIds: ['heldout'] }, solverCallsUsed: 4, articulationParameterCount: 2 }
}
test('scores independently and rejects tampering, leakage, unfair baselines and missing data', async () => {
  const x = await fixture()
  const result = await evaluatePrediction(x)
  assert.equal(result.outcome, 'scored')
  assert.equal(result.errors[0].value, 2)
  assert.equal(validateRecord(result).valid, true)
  assert.equal((await evaluatePrediction({ ...x, commit: { ...x.commit, id: 'tampered' } })).outcome, 'failed')
  assert.equal((await evaluatePrediction({ ...x, captureStartedAt: x.commit.committedAt })).outcome, 'failed')
  assert.equal((await evaluatePrediction({ ...x, heldOut: { observationIds: ['heldout'], fitArtifactHashes: ['a'.repeat(64)] } })).outcome, 'failed')
  assert.equal((await evaluatePrediction({ ...x, baseline: { name: 'fixed', commit: x.commit, solverCallsUsed: 2, articulationParameterCount: 3 } })).outcome, 'failed')
  assert.equal((await evaluatePrediction({ ...x, audio: { ...x.audio, measurements: [] } })).outcome, 'excluded')
  const withBaseline = await evaluatePrediction({ ...x, baseline: { name: 'fixed', commit: x.commit, solverCallsUsed: 2, articulationParameterCount: 2 } })
  assert.equal(withBaseline.outcome, 'scored')
  assert.equal(withBaseline.baseline?.errors[0].value, 2)
})
