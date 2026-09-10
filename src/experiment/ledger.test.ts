import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTRACT_VERSION } from '../contracts/index.ts'
import type { Forecast } from '../contracts/index.ts'
import { commitExperiment, importForecast, markUpdateEligible, proposeExperiment, retryExperiment, startExperimentCapture, stopExperiment } from './ledger.ts'

const forecast: Forecast = {
  schemaVersion: CONTRACT_VERSION, kind: 'forecast', id: 'forecast-1', createdAt: '2026-01-01T00:00:00Z',
  provenance: { kind: 'engine-generated', producer: 'test-engine', producerVersion: '1', sourceIds: ['candidate-1'], sourceHashes: ['a'.repeat(64)] },
  modelId: 'candidate-1', modelVersion: '1', evidenceIds: ['fit-1'], experimentId: 'vowel-trial', intervention: 'Sustain ah', availability: 'available', missingReason: null,
  outcomes: [{ name: 'pitch', value: 220, unit: 'Hz', uncertainty: 10, missingReason: null }], scoringRule: 'absolute-error-v1', evaluationMode: 'human-held-out', budget: { unit: 'solver-calls', limit: 1 },
}

test('capture requires frozen matching forecast, and digest tampering is rejected', async () => {
  const proposed = proposeExperiment('vowel-trial', 'Sustain ah')
  await assert.rejects(startExperimentCapture(proposed), /while proposed/)
  assert.throws(() => importForecast(proposed, { ...forecast, intervention: 'Different task' }), /exactly match/)
  const validated = importForecast(proposed, forecast)
  const committed = await commitExperiment(validated)
  assert.throws(() => importForecast(committed, forecast), /while committed/)
  const tampered = structuredClone(committed)
  tampered.commit!.forecast.outcomes[0].value = 999
  await assert.rejects(startExperimentCapture(tampered, '2099-01-01T00:00:00Z'), /digest/)
  assert.equal((await startExperimentCapture(committed, '2099-01-01T00:00:00Z')).state, 'capturing')
})

test('no update before scoring; retries preserve failed attempt and require a fresh commitment', async () => {
  const committed = await commitExperiment(importForecast(proposeExperiment('vowel-trial', 'Sustain ah'), forecast))
  assert.throws(() => markUpdateEligible(committed), /while committed/)
  const failed = stopExperiment(committed, 'failed', 'Microphone permission denied')
  const retry = retryExperiment(failed)
  assert.equal(retry.retryOf, failed.id)
  assert.notEqual(retry.id, failed.id)
  assert.equal(retry.commit, null)
  assert.equal(failed.history.at(-1)?.reason, 'Microphone permission denied')
  await assert.rejects(startExperimentCapture(retry), /while proposed/)
})
