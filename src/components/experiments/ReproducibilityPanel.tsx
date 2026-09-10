import { useState } from 'react'
import type { ContractRecord } from '../../contracts/index.ts'
import { auditEvidence, createEvidenceManifest } from '../../reproducibility/index.ts'
import type { TrialSummary } from '../../reproducibility/index.ts'

export function ReproducibilityPanel({ records = [], trials = [] }: { records?: ContractRecord[]; trials?: TrialSummary[] }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  async function exportEvidence() {
    setBusy(true)
    try {
      const manifest = await createEvidenceManifest(records, trials)
      const report = await auditEvidence(manifest)
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'evidence.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus(`Exported ${report.recordCount} records and ${trials.length} trials, including failures. ${report.missing.join('. ')}${report.errors.length ? ` Errors: ${report.errors.join('; ')}` : ''}`)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Export failed') }
    finally { setBusy(false) }
  }
  return <section className="experiment-panel" aria-label="Reproducibility">
    <h3>Reproduce & export</h3>
    <p>Save evidence metadata, predictions, scores and every retained attempt. Download recordings separately and keep their relative filenames beside the manifest.</p>
    <button type="button" disabled={busy} onClick={() => void exportEvidence()}>{busy ? 'Exporting…' : 'Export evidence manifest'}</button>
    <p role="status">{status}</p>
    <details><summary>Local replay</summary><code>node --experimental-strip-types scripts/replay-experiment.ts evidence.json evidence-report</code><p>Checks hashes and prospective ordering; reports missing media and engine outputs. This audit does not rerun the physics engine or establish scientific accuracy.</p></details>
  </section>
}
