import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTRACT_VERSION, createPredictionCommit, validateRecord, verifyPredictionCommit, validateProspectiveEvaluation } from './index.ts'
import type { Forecast, ObservationBundle, EvaluationRecord } from './index.ts'
import { probeSource, receiptAcquisition, SOFTWARE_FIXTURE_CALIBRATION_ID } from './probes.ts'

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

test('probe source follows the pull receipt: a pulled recording cannot be relabelled as a fixture', () => {
  const fixture = { provenance: 'software-fixture', calibration: { id: SOFTWARE_FIXTURE_CALIBRATION_ID } }
  const phoneShaped = { ...fixture, route: { output: 'Speaker' } }, unmarked = { provenance: 'software-fixture', calibration: {} }
  const human = { provenance: 'human-recording', calibration: { placementId: 'fixture-placement' } }, reference = { provenance: 'physical-reference', calibration: { placementId: 'fixture-placement' } }
  const devicectl = { transport: 'devicectl', connection: { transportType: 'wired', tunnelState: 'connected' }, device: { coreDeviceId: '0B1C2D3E-4F50-4A6B-8C7D-9E0F1A2B3C4D', udid: null, productType: 'iPhone16,1', osVersion: '26.0' } }
  const repository = { transport: 'repository-fixture', generator: 'src/contracts/contracts.test.ts' }
  const cases: [string, unknown, unknown, string, string][] = [
    // The attack: a manifest stripped of iPhone fields and given the fixture marker, pulled by devicectl.
    ['devicectl + stripped fixture manifest', fixture, devicectl, 'human-recording', 'devicectl-receipt'],
    ['devicectl + human', human, devicectl, 'human-recording', 'devicectl-receipt'],
    // The app's recorder writes only human-recording, so a reference label on a pulled archive was edited or injected.
    ['devicectl + reference', reference, devicectl, 'human-recording', 'devicectl-receipt'],
    ['repository fixture + marked fixture', fixture, repository, 'software-fixture', 'repository-fixture-receipt'],
    ['repository fixture + iPhone fields', phoneShaped, repository, 'human-recording', 'contradicted-fixture-receipt'],
    ['repository fixture + unmarked fixture', unmarked, repository, 'human-recording', 'contradicted-fixture-receipt'],
    ['repository fixture + human', human, repository, 'human-recording', 'contradicted-fixture-receipt'],
    ['repository fixture + reference', reference, repository, 'human-recording', 'contradicted-fixture-receipt'],
    ['legacy receipt + marked fixture', fixture, null, 'human-recording', 'legacy-receipt'],
    ['receipt with empty acquisition + marked fixture', fixture, {}, 'human-recording', 'legacy-receipt'],
    ['unknown transport + marked fixture', fixture, { transport: 'airdrop' }, 'human-recording', 'legacy-receipt'],
    ['legacy receipt + human', human, null, 'human-recording', 'legacy-receipt'],
    ['legacy receipt + reference', reference, null, 'human-recording', 'legacy-receipt'],
    ['no receipt + reference with iPhone fields', { ...reference, route: {} }, undefined, 'human-recording', 'none'],
    // Labels outside the enum are never passed through.
    ['no receipt + miscased label', { ...fixture, provenance: 'Software-Fixture' }, undefined, 'human-recording', 'none'],
    ['no receipt + missing label', { calibration: fixture.calibration }, undefined, 'human-recording', 'none'],
    ['no receipt + array label', { ...fixture, provenance: ['software-fixture'] }, undefined, 'human-recording', 'none'],
    ['repository fixture + array calibration', { provenance: 'software-fixture', calibration: Object.assign([], { id: SOFTWARE_FIXTURE_CALIBRATION_ID }) }, repository, 'human-recording', 'contradicted-fixture-receipt'],
    ['array acquisition + marked fixture', fixture, ['repository-fixture'], 'human-recording', 'legacy-receipt'],
    ['no receipt + marked fixture', fixture, undefined, 'software-fixture', 'none'],
    ['no receipt + unmarked fixture', unmarked, undefined, 'human-recording', 'none'],
    ['no receipt + iPhone fields', phoneShaped, undefined, 'human-recording', 'none'],
    ['no receipt + human', human, undefined, 'human-recording', 'none'],
    ['no receipt + reference', reference, undefined, 'physical-reference', 'none'],
  ]
  for (const [name, manifest, acquisition, kind, attestation] of cases) {
    const source = probeSource(manifest, acquisition)
    assert.deepEqual([source.kind, source.attestation, source.declared], [kind, attestation, (manifest as { provenance?: unknown }).provenance], name)
  }
  assert.deepEqual(probeSource(phoneShaped, devicectl).nativeCaptureFields, ['route'])
  // Omitting the argument is the no-receipt row, unchanged from the manifest-only rule.
  assert.deepEqual([receiptAcquisition(undefined), receiptAcquisition(null), receiptAcquisition({ name: 'probe.zip' }), receiptAcquisition({ acquisition: repository })], [undefined, undefined, null, repository])
  assert.deepEqual(probeSource(fixture), { kind: 'software-fixture', declared: 'software-fixture', nativeCaptureFields: [], attestation: 'none' })
})
