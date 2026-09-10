/** Replay the contract boundary from saved JSON, without running a scientific engine. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateRecord, verifyPredictionCommit, validateProspectiveEvaluation, sha256 } from '../src/contracts/index.ts'
import type { ContractRecord, PredictionCommit } from '../src/contracts/index.ts'

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--artifact-root')
const artifactRoot = rootIndex >= 0 ? args[rootIndex + 1] : undefined
if (rootIndex >= 0) args.splice(rootIndex, 2)
if (!args.length || rootIndex >= 0 && !artifactRoot) {
  console.error('Usage: node --experimental-strip-types scripts/validate-contracts.ts [--artifact-root directory] manifest.json [...]')
  process.exit(1)
}
const records: ContractRecord[] = []
let failed = false
for (const file of args) {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
      const result = validateRecord(value)
      if (!result.valid) throw new Error(result.errors.join('\n'))
      const record = result.record
      if (record.kind === 'prediction-commit' && !(await verifyPredictionCommit(record))) throw new Error('Prediction digest mismatch')
      if (artifactRoot && record.kind === 'observation') {
        for (const artifact of record.artifacts) {
          // Artifact URIs in a portable bundle are paths relative to the supplied root.
          const base = resolve(artifactRoot)
          const path = resolve(base, artifact.uri)
          if (!path.startsWith(`${base}/`) || /^[a-z]+:/i.test(artifact.uri)) throw new Error(`Artifact must be a relative bundle path: ${artifact.uri}`)
          const bytes = await readFile(path)
          if (bytes.byteLength !== artifact.byteLength || await sha256(bytes) !== artifact.sha256) throw new Error(`Artifact bytes/hash mismatch: ${artifact.id}`)
        }
      }
      records.push(record)
      console.log(`VALID ${record.kind} ${record.id} (${record.provenance.kind})`)
    }
  } catch (error) { failed = true; console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`) }
}
const predictions = new Map(records.filter((record): record is PredictionCommit => record.kind === 'prediction-commit').map(record => [record.id, record]))
const ids = new Set<string>()
for (const record of records) {
  if (ids.has(record.id)) { failed = true; console.error(`Duplicate record ID: ${record.id}`) }
  ids.add(record.id)
  if (record.kind === 'evaluation') {
    const prediction = predictions.get(record.predictionId)
    if (!prediction) { failed = true; console.error(`Evaluation ${record.id}: include its prediction commit to replay chronology`) }
    else {
      const errors = await validateProspectiveEvaluation(prediction, record)
      if (errors.length) { failed = true; console.error(`${record.id}: ${errors.join('; ')}`) }
    }
  }
}
console.log('Contract validation only: no physiological reconstruction or benchmark result is implied.')
process.exitCode = failed ? 1 : 0
