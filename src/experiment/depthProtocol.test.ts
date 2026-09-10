import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTRACT_VERSION, createPredictionCommit } from '../contracts/index.ts'
import type { Forecast, ObservationBundle } from '../contracts/index.ts'
import { DEFAULT_DEPTH_PROTOCOL, inspectDepthTrial } from './depthProtocol.ts'

test('prospective depth gate rejects late commitment, missing and estimated depth', async () => {
  const provenance = { kind: 'human-observation' as const, producer: 'test-only-receipt', producerVersion: '1', sourceIds: [], sourceHashes: [] }
  const base = { schemaVersion: CONTRACT_VERSION, createdAt: '2026-09-10T12:00:00Z', provenance }
  const forecast: Forecast = { ...base, kind: 'forecast', id: 'f', modelId: 'test', modelVersion: '1', evidenceIds: [], experimentId: 'e', intervention: 'test', availability: 'available', missingReason: null, outcomes: [{ name: 'f0', value: 220, unit: 'Hz', uncertainty: 1, missingReason: null }], scoringRule: 'test', evaluationMode: 'human-held-out', budget: { unit: 'solver-calls', limit: 1 } }
  const commit = await createPredictionCommit(forecast, { id: 'p', committedAt: '2026-09-10T12:01:00Z', provenance })
  const observation: ObservationBundle = { ...base, kind: 'observation', id: 'o', participantId: 'test', sessionId: 's', trialId: 't', predictionId: 'p', consentScope: ['test'], task: 'test', artifacts: [{ id: 'a', uri: 'test-only.bin', sha256: '0'.repeat(64), mediaType: 'application/octet-stream', byteLength: 1 }], streams: (['audio', 'rgb', 'depth'] as const).map(modality => ({ modality, timebase: { clockId: 'c', origin: 'session-start', unit: 'ms', syncUncertaintyMs: 5, referenceClockId: null, offsetToReferenceMs: null }, samples: [{ captureMs: 0, sequence: 0, artifactId: 'a', quality: { flags: [], missingReason: null } }], missingReason: null, droppedSamples: 0, settings: { depthSource: 'hardware' }, calibration: { artifactId: 'a', missingReason: null }, depth: modality === 'depth' ? { representation: 'depth', unit: 'm', coordinateFrame: 'camera-optical', filtered: false } : null })) }
  const inspect = (start?: string) => inspectDepthTrial(DEFAULT_DEPTH_PROTOCOL, observation, commit, start)
  assert.equal((await inspect('2026-09-10T12:02:00Z')).status, 'ready-for-review')
  assert.equal((await inspect()).status, 'blocked')
  assert.equal((await inspect('2026-09-10T12:00:00Z')).status, 'blocked')
  observation.streams[2].settings.depthSource = 'landmark-estimate'
  assert.equal((await inspect('2026-09-10T12:02:00Z')).checks.find(check => check.id === 'measured-depth')?.status, 'blocked')
  observation.streams[2].samples = []
  observation.streams[2].missingReason = 'not-supported'
  observation.streams[2].depth = null
  assert.equal((await inspect('2026-09-10T12:02:00Z')).checks.find(check => check.id === 'capture-depth')?.status, 'blocked')
})
