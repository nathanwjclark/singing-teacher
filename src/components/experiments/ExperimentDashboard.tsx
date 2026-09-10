import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { canonicalJson, validateRecord } from '../../contracts/index.ts'
import type { AudioMeasurement, CandidateAnatomy, ContractRecord, ObservationBundle } from '../../contracts/index.ts'
import { readExperimentLedger, subscribeExperimentLedger } from '../../experiment/ledger.ts'
import { compareModalities, isMeasuredDepth, MODALITIES, parseComparisonImport } from '../../evaluation/modalityComparison.ts'
import type { ComparisonImport } from '../../evaluation/modalityComparison.ts'
import './ExperimentDashboard.css'

const EMPTY_OBSERVATIONS: ObservationBundle[] = []
const EMPTY_MEASUREMENTS: AudioMeasurement[] = []
interface Props {
  observations?: ObservationBundle[]
  measurements?: AudioMeasurement[]
  children?: ReactNode
  onCandidates?: (candidates: CandidateAnatomy[]) => void
  onRecords?: (records: ContractRecord[]) => void
}
const number = (value: number | null) => value === null ? '—' : Number(value.toPrecision(4)).toString()
function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = `singing-experiments-${new Date().toISOString().replaceAll(':', '-')}.json`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function ExperimentDashboard({ observations = EMPTY_OBSERVATIONS, measurements = EMPTY_MEASUREMENTS, children, onCandidates, onRecords }: Props) {
  const [ledger, setLedger] = useState(readExperimentLedger)
  const [imported, setImported] = useState<ComparisonImport>({ records: [], runs: [] })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  useEffect(() => subscribeExperimentLedger(() => setLedger(readExperimentLedger())), [])
  const records = useMemo(() => {
    const items = [...observations, ...measurements, ...ledger.flatMap(trial => [trial.forecast, trial.commit, trial.observation, trial.evaluation].filter((record): record is NonNullable<typeof record> => !!record)), ...imported.records]
    const valid = items.filter(record => validateRecord(record).valid)
    return [...new Map(valid.map(record => [record.id, record])).values()]
  }, [observations, measurements, ledger, imported.records])
  const candidates = useMemo(() => records.filter((record): record is CandidateAnatomy => record.kind === 'candidate-anatomy'), [records])
  useEffect(() => { onCandidates?.(candidates) }, [candidates, onCandidates])
  useEffect(() => { onRecords?.(records) }, [records, onRecords])
  const comparisons = useMemo(() => compareModalities(records, imported.runs), [records, imported.runs])
  const captured = records.filter((record): record is ObservationBundle => record.kind === 'observation')
  const evaluations = records.filter(record => record.kind === 'evaluation')
  const scored = evaluations.filter(record => record.outcome === 'scored').length
  const failed = evaluations.filter(record => record.outcome !== 'scored').length
  const hasEngine = candidates.some(candidate => candidate.availability === 'available' && candidate.provenance.kind === 'engine-generated')
  const depthCount = captured.filter(isMeasuredDepth).length
  async function importFile(file: File | undefined) {
    if (!file) return
    setBusy(true); setNotice('')
    try {
      if (file.size > 20_000_000) throw new Error('Import metadata under 20 MB; keep media in separate files.')
      const parsed = await parseComparisonImport(JSON.parse(await file.text()))
      // Import replaces the previous imported package; live records and trial history stay intact.
      const localById = new Map(records.filter(record => !imported.records.some(item => item.id === record.id)).map(record => [record.id, record]))
      for (const record of parsed.records) {
        const existing = localById.get(record.id)
        if (existing && canonicalJson(existing) !== canonicalJson(record)) throw new Error(`Record ${record.id} conflicts with live evidence. Use unique immutable IDs.`)
      }
      setImported(parsed)
      setNotice(`Imported ${parsed.records.length} validated records and ${parsed.runs.length} comparison arms. Producer claims still require scientific review.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not import metadata.') }
    finally { setBusy(false); if (upload.current) upload.current.value = '' }
  }
  return <section className="experiment-dashboard" aria-label="Experiments dashboard">
    <div className="experiment-dashboard-toolbar">
      <div><h2>Experiments</h2><p>Capture evidence, freeze predictions, then compare observed outcomes.</p></div>
      <div className="experiment-dashboard-actions">
        <button onClick={() => upload.current?.click()} disabled={busy}>{busy ? 'Validating…' : 'Import results'}</button>
        <button onClick={() => download({ kind: 'modality-comparison', version: 1, records, runs: imported.runs, comparisons, trials: ledger })}>Export JSON</button>
        {imported.records.length > 0 && <button onClick={() => { setImported({ records: [], runs: [] }); setNotice('Imported package removed from this view.') }}>Clear import</button>}
        <input ref={upload} type="file" accept=".json,application/json" hidden onChange={event => { void importFile(event.target.files?.[0]) }} />
      </div>
    </div>
    {notice && <p className="experiment-dashboard-notice" role="status">{notice}</p>}
    <div className="experiment-summary">
      <div><strong>{captured.length}</strong><span>Recording bundles</span></div>
      <div><strong>{scored} / {failed}</strong><span>Scored / failed or excluded</span></div>
      <div><strong>{records.filter(record => record.kind === 'audio-measurement').length}</strong><span>Acoustic measurements</span></div>
      <div><strong>{depthCount}</strong><span>Calibrated depth bundles</span></div>
    </div>
    <p className="experiment-dashboard-availability">{hasEngine ? 'Engine candidate imported.' : 'Mapped anatomy awaits an engine-generated candidate from the scientific producer.'} {depthCount ? 'Sensor depth metadata available; device accuracy remains to be evaluated.' : 'Measured depth unavailable. Webcam landmark depth is an estimate.'}</p>
    {children}
    <section className="experiment-dashboard-section">
      <h3>Modality comparison</h3>
      <p>Audio → audio + RGB → audio + RGB + measured depth. Match held-out audio, scoring rules, solver budgets and articulation freedom. Positive depth improvement means lower error.</p>
      {!comparisons.length ? <div className="experiment-empty">No comparison runs yet. Import frozen forecasts, evaluations, fitting observations and explicit modality/budget metadata from the scientific producer. No depth benefit has been measured.</div> : comparisons.map(comparison => <article className="experiment-comparison" key={`${comparison.comparisonId}/${comparison.protocolId}/${comparison.caseId}`}>
        <h4>{comparison.comparisonId} · {comparison.caseId} <span className={`experiment-status ${comparison.status}`}>{comparison.status}</span></h4>
        <p>Protocol {comparison.protocolId} · {comparison.budget === null ? 'Equal-budget comparison not established' : `${comparison.budget} solver calls permitted per arm`}</p>
        {comparison.reasons.length > 0 && <ul>{comparison.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {comparison.features.length > 0 && <div className="experiment-table-wrap"><table><thead><tr><th>Feature / error unit</th><th>Audio</th><th>Audio + RGB</th><th>+ measured depth</th><th>Depth improvement</th></tr></thead><tbody>{comparison.features.map(feature => <tr key={`${feature.name}/${feature.unit}`}><th>{feature.name} ({feature.unit})</th>{MODALITIES.map(modality => <td key={modality}>{number(feature.scores[modality])}</td>)}<td>{number(feature.depthImprovement)}</td></tr>)}</tbody></table></div>}
      </article>)}
    </section>
    <section className="experiment-dashboard-section">
      <h3>Evidence</h3>
      <p>Contract validation checks structure and provenance fields; imported values are producer-reported. Media is exported separately from this metadata.</p>
      {!records.length ? <div className="experiment-empty">Start and stop a recording to collect the first observation. Capture never starts from this dashboard.</div> : <div className="experiment-table-wrap"><table><thead><tr><th>Record</th><th>Type</th><th>Origin</th><th>Result / availability</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td title={record.id}>{record.id}</td><td>{record.kind}</td><td>{record.provenance.kind}<small>{record.provenance.producer}</small></td><td>{record.kind === 'observation' ? record.streams.map(stream => `${stream.modality}: ${stream.samples.length ? `${stream.samples.length} samples` : stream.missingReason}`).join(' · ') : record.kind === 'evaluation' ? `${record.outcome}${record.exclusions.length ? `: ${record.exclusions.map(item => item.reason).join('; ')}` : ''}` : record.kind === 'candidate-anatomy' || record.kind === 'forecast' ? `${record.availability}${record.missingReason ? `: ${record.missingReason}` : ''}` : record.kind === 'prediction-commit' ? 'Frozen prediction' : record.kind === 'audio-measurement' ? `${record.measurements.filter(item => item.value !== null).length} available features` : record.kind === 'job' ? record.state : record.interpretation}</td></tr>)}</tbody></table></div>}
    </section>
    {ledger.length > 0 && <section className="experiment-dashboard-section"><h3>All attempts</h3><div className="experiment-table-wrap"><table><thead><tr><th>Task</th><th>State</th><th>Latest event</th></tr></thead><tbody>{ledger.map(trial => <tr key={trial.id}><td>{trial.proposal.task}<small>{trial.id}{trial.retryOf ? ` · retry of ${trial.retryOf}` : ''}</small></td><td>{trial.state}</td><td>{trial.history.at(-1)?.reason}</td></tr>)}</tbody></table></div></section>}
  </section>
}
