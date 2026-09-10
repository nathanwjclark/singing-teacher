import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, CONTRACT_VERSION, sha256 } from '../src/contracts/index.ts'
import type { CandidateAnatomy } from '../src/contracts/index.ts'
import { auditEvidence, createEvidenceManifest } from '../src/reproducibility/index.ts'
import { replayExperiment } from './replay-experiment.ts'

test('retains failed attempts, rejects tampering, and never fabricates benchmark success', async () => {
  const manifest = await createEvidenceManifest([], [{ id: 'trial', state: 'failed', retryOf: null, history: [{ state: 'failed', at: new Date().toISOString(), reason: 'Microphone permission lost' }] }])
  const report = await auditEvidence(manifest)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.unsuccessfulAttempts[0].reasons[0], 'Microphone permission lost')
  assert.ok(report.missing.some(s => s.includes('engine')))
  manifest.trials[0].state = 'scored'
  assert.ok((await auditEvidence(manifest)).errors.includes('Manifest SHA-256 mismatch'))
})

test('checks bytes and rejects traversal and symlink escape; absent media stays distinct', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'singing-replay-'))
  try {
    const bytes = new TextEncoder().encode('geometry')
    const record: CandidateAnatomy = { schemaVersion: CONTRACT_VERSION, id: 'candidate', createdAt: new Date().toISOString(), provenance: { kind: 'engine-generated', producer: 'test-engine', producerVersion: 'fixture', sourceIds: [], sourceHashes: [] }, kind: 'candidate-anatomy', modelVersion: 'fixture', parentModelId: null, evidenceIds: [], availability: 'available', missingReason: null, parameters: [], geometry: { id: 'geometry', uri: 'geometry.bin', sha256: await sha256(bytes), mediaType: 'application/octet-stream', byteLength: bytes.length }, solver: { name: 'fixture', version: '1', configSha256: '0'.repeat(64) }, uncertaintyMethod: null, mismatch: false }
    const manifest = await createEvidenceManifest([record])
    const path = join(dir, 'evidence.json')
    async function save() {
      const { sha256: _digest, ...payload } = manifest
      manifest.sha256 = await sha256(canonicalJson(payload))
      await writeFile(path, JSON.stringify(manifest))
    }
    await save()
    assert.ok((await replayExperiment(path)).missing.some(s => s.includes('Missing external media')))
    await writeFile(join(dir, 'geometry.bin'), bytes)
    assert.deepEqual((await replayExperiment(path)).errors, [])
    await writeFile(join(dir, 'geometry.bin'), 'tampered')
    assert.ok((await replayExperiment(path)).errors.some(s => s.includes('SHA-256 mismatch')))
    record.geometry!.uri = '../outside.bin'; await save()
    assert.ok((await replayExperiment(path)).errors.some(s => s.includes('Unsafe artifact path')))
    await symlink('/etc/hosts', join(dir, 'escape.bin'))
    record.geometry!.uri = 'escape.bin'; await save()
    assert.ok((await replayExperiment(path)).errors.some(s => s.includes('escapes manifest directory')))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
