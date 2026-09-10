import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTRACT_VERSION, createPredictionCommit } from '../contracts/index.ts'
import type { ContractRecord, EvaluationRecord, Forecast, ObservationBundle } from '../contracts/index.ts'
import { compareModalities, MODALITIES, parseComparisonImport } from './modalityComparison.ts'
import type { ModalityRun } from './modalityComparison.ts'

test('compares matched budgets, retains missing arms, rejects estimated depth and altered commits', async () => {
  // Test-only human/engine tags exercise the boundary. These are never app sample data.
  const provenance = { kind: 'human-observation' as const, producer: 'comparison-test', producerVersion: '1', sourceIds: [], sourceHashes: [] }
  const base = { schemaVersion: CONTRACT_VERSION, createdAt: '2026-09-10T12:00:00Z', provenance }
  const timebase = { clockId: 'clock', origin: 'session-start' as const, unit: 'ms' as const, syncUncertaintyMs: 0, referenceClockId: null, offsetToReferenceMs: null }
  const fit: ObservationBundle = { ...base, id: 'fit', kind: 'observation', participantId: 'person', sessionId: 'session', trialId: 'fit', predictionId: null, consentScope: ['test'], task: 'vowel', artifacts: [{ id: 'media', uri: 'test', sha256: 'a'.repeat(64), mediaType: 'application/octet-stream', byteLength: 1 }], streams: (['audio', 'rgb', 'depth'] as const).map(modality => ({ modality, timebase, samples: [{ captureMs: 0, artifactId: 'media', sequence: 0, quality: { flags: [], missingReason: null } }], missingReason: null, droppedSamples: 0, settings: { depthSource: 'hardware' }, calibration: { artifactId: 'media', missingReason: null }, depth: modality === 'depth' ? { representation: 'depth', unit: 'm', coordinateFrame: 'camera-optical', filtered: false } : null })) }
  const target: ObservationBundle = { ...structuredClone(fit), id: 'target', createdAt: '2026-09-10T12:02:00Z', artifacts: [{ ...fit.artifacts[0], sha256: 'b'.repeat(64) }] }
  const records: ContractRecord[] = [fit, target]
  const runs: ModalityRun[] = []
  for (const [i, modality] of MODALITIES.entries()) {
    const forecast: Forecast = { ...base, provenance: { ...provenance, kind: 'engine-generated' }, id: `forecast-${i}`, kind: 'forecast', modelId: 'model', modelVersion: '1', evidenceIds: ['fit'], experimentId: 'experiment', intervention: 'vowel', availability: 'available', missingReason: null, outcomes: [{ name: 'f0', value: 220, unit: 'Hz', uncertainty: null, missingReason: null }], scoringRule: 'absolute-error-v1', evaluationMode: 'human-held-out', budget: { unit: 'solver-calls', limit: 10 } }
    const commit = await createPredictionCommit(forecast, { id: `commit-${i}`, committedAt: '2026-09-10T12:01:00Z', provenance })
    const evaluation: EvaluationRecord = { ...base, id: `score-${i}`, kind: 'evaluation', predictionId: commit.id, predictionSha256: commit.sha256, observationIds: ['target'], captureStartedAt: '2026-09-10T12:02:00Z', scoredAt: '2026-09-10T12:03:00Z', outcome: 'scored', errors: [{ name: 'f0-absolute-error', value: 3-i, unit: 'Hz', uncertainty: null, missingReason: null }], exclusions: [], baseline: null, executionNotes: 'test-only score' }
    records.push(commit, evaluation)
    runs.push({ id: `run-${i}`, comparisonId: 'comparison', caseId: 'case', protocolId: 'protocol', modality, predictionId: commit.id, evaluationId: evaluation.id, inputObservationIds: ['fit'], solverCallsUsed: 5, articulationParameterCount: 2 })
  }
  const parsed = await parseComparisonImport({ records, runs })
  const result = compareModalities(parsed.records, parsed.runs)[0]
  assert.equal(result.status, 'complete')
  assert.equal(result.features[0].depthImprovement, 1)
  assert.equal(compareModalities(records, runs.slice(0, 2))[0].features[0].depthImprovement, null)
  assert.equal(compareModalities(records, runs.map((run, i) => ({ ...run, articulationParameterCount: i === 2 ? 3 : 2 })))[0].status, 'incomplete')
  fit.streams[2].settings.depthSource = 'landmark-estimate'
  assert.equal(compareModalities(records, runs)[0].status, 'incomplete')
  const tampered = structuredClone(records)
  const commit = tampered.find(record => record.kind === 'prediction-commit')!
  if (commit.kind === 'prediction-commit') commit.forecast.budget.limit = 99
  await assert.rejects(parseComparisonImport({ records: tampered, runs }), /digest/)
})
