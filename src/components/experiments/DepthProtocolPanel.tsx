import { useEffect, useState } from 'react'
import type { ObservationBundle, PredictionCommit } from '../../contracts/index.ts'
import { DEFAULT_DEPTH_PROTOCOL, inspectDepthTrial } from '../../experiment/depthProtocol.ts'
import type { DepthProtocol, DepthProtocolReport } from '../../experiment/depthProtocol.ts'

export interface DepthProtocolPanelProps {
  observation?: ObservationBundle
  commit?: PredictionCommit
  captureStartedAt?: string
  onProtocolChange?: (protocol: DepthProtocol) => void
}
export function DepthProtocolPanel({ observation, commit, captureStartedAt, onProtocolChange }: DepthProtocolPanelProps) {
  const [protocol, setProtocol] = useState(DEFAULT_DEPTH_PROTOCOL)
  const [report, setReport] = useState<DepthProtocolReport | null>(null)
  useEffect(() => {
    let active = true
    void inspectDepthTrial(protocol, observation, commit, captureStartedAt).then(value => { if (active) setReport(value) })
    return () => { active = false }
  }, [protocol, observation, commit, captureStartedAt])
  const exportProtocol = () => {
    const blob = new Blob([JSON.stringify({ protocol, report }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${protocol.id}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="depth-protocol-panel" aria-label="Prospective depth protocol">
    <h3>Prospective depth trials</h3>
    <p>Three comfortable vowel repetitions. Predictions are committed before capture; recording starts only when you choose it in Capture.</p>
    <label>Requested capture <select value={protocol.modalities.join(',')} onChange={event => {
      const modalities = event.target.value === 'audio' ? ['audio'] as const : event.target.value === 'audio,rgb' ? ['audio', 'rgb'] as const : ['audio', 'rgb', 'depth'] as const
      const next = { ...protocol, modalities: [...modalities] }
      setProtocol(next)
      setReport(null)
      onProtocolChange?.(next)
    }}>
      <option value="audio">Audio</option>
      <option value="audio,rgb">Audio + RGB</option>
      <option value="audio,rgb,depth">Audio + RGB + measured depth</option>
    </select></label>
    <p>Measured depth needs a native sensor capture with calibration. Browser camera frames and landmark depth estimates do not satisfy it.</p>
    <details><summary>Capture steps and quality checklist</summary><ol>{protocol.steps.map(step => <li key={step.id}>{step.instruction}</li>)}</ol></details>
    <p role="status">{report ? report.status === 'blocked' ? 'Waiting for required evidence' : 'Evidence ready for quality review' : 'Checking evidence…'}</p>
    {report && <ul>{report.checks.map(check => <li key={check.id}><strong>{check.status === 'pass' ? '✓' : check.status === 'blocked' ? 'Required' : 'Review'} — {check.label}:</strong> {check.detail}</li>)}</ul>}
    <button type="button" onClick={exportProtocol}>Export protocol and readiness report</button>
  </section>
}
