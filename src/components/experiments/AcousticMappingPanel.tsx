import { useEffect, useState } from 'react'
import { validateProbeMeasurement } from '../../contracts/probes.ts'
import type { AcousticProbeMeasurement } from '../../contracts/probes.ts'
import { deleteProbeReview, readProbeReviews, saveProbeReview } from '../../experiment/probes/reviewStore.ts'
import type { SavedProbeReview } from '../../experiment/probes/reviewStore.ts'
import { ProbeCaptureGuide } from './ProbeCaptureGuide'
import { ProbeSetupPanel } from './ProbeSetupPanel'
import { fitLatestProbe, getProbeStatus, importLatestProbe } from './probeClient'
import type { ProbeStatus } from './probeClient'
import './AcousticMappingPanel.css'

function measurement(saved?: SavedProbeReview): AcousticProbeMeasurement | undefined {
  try { return saved && validateProbeMeasurement(saved.report).valid ? saved.report as AcousticProbeMeasurement : undefined } catch { return undefined }
}
function ResponseChart({ current, reference }: { current: AcousticProbeMeasurement; reference?: AcousticProbeMeasurement }) {
  const curves = [current, ...(reference ? [reference] : [])]
  const points = curves.flatMap(r => r.response.frequencyHz.flatMap((f, i) => r.response.valid[i] && f > 0 && r.response.magnitude[i] > 0 ? [[f, 20 * Math.log10(r.response.magnitude[i])]] : []))
  if (!points.length) return <p>No valid response bands to plot. See the retained quality reasons below.</p>
  const minF = Math.min(...points.map(p => p[0])), maxF = Math.max(minF * 1.01, ...points.map(p => p[0]))
  const low = Math.floor(Math.min(...points.map(p => p[1])) / 10) * 10 - 5, high = Math.ceil(Math.max(...points.map(p => p[1])) / 10) * 10 + 5
  const x = (f: number) => 55 + 675 * Math.log(f / minF) / Math.log(maxF / minF)
  const y = (db: number) => 190 - 160 * (db - low) / (high - low)
  return <><svg className="probe-chart" viewBox="0 0 760 230" role="img" aria-label="Measured response magnitude by frequency, with invalid bands omitted">
    {[low, (low + high) / 2, high].map(v => <g key={v}><path className="grid" d={`M55 ${y(v)}H730`}/><text x="5" y={y(v) + 4}>{v.toFixed(0)} dB</text></g>)}
    {[minF, Math.sqrt(minF * maxF), maxF].map(f => <text key={f} x={x(f)} y="211" textAnchor="middle">{Math.round(f)} Hz</text>)}
    {curves.map((r, n) => {
      let pen = false
      const d = r.response.frequencyHz.map((f, i) => { if (!r.response.valid[i] || f <= 0 || r.response.magnitude[i] <= 0) { pen = false; return '' }; const p = `${pen ? 'L' : 'M'}${x(f)},${y(20 * Math.log10(r.response.magnitude[i]))}`; pen = true; return p }).join(' ')
      return <path key={`${r.id}-${n}`} className={n ? 'reference' : 'response'} d={d}/>
    })}
  </svg><p className="probe-chart-legend"><span style={{ color: '#bce984' }}>Current measured response</span>{reference && <span style={{ color: '#80bcec' }}>Comparison response</span>} · dB relative to 1 recorded PCM / digital drive; log frequency. Invalid bands are gaps.</p></>
}
function download(saved: SavedProbeReview) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(saved.report, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'probe-measurement.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function ConnectedProbe() {
  const [state, setState] = useState<ProbeStatus | null>(null)
  const [error, setError] = useState(''), [starting, setStarting] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try { const next = await getProbeStatus(controller.signal); if (!controller.signal.aborted) setState(next) }
      catch (failure) { if (!controller.signal.aborted) { setState(null); setError(failure instanceof Error ? failure.message : String(failure)) } }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [refresh])
  async function run(action: 'import' | 'fit') {
    setStarting(true); setError('')
    try {
      if (action === 'import') await importLatestProbe(crypto.randomUUID())
      else {
        if (!state?.import || !state.currentModelId) throw new Error('Analyze a probe and fit a voice model first.')
        await fitLatestProbe(crypto.randomUUID(), state.import.importId, state.currentModelId)
      }
      setState(previous => previous ? { ...previous, busy: true } : previous)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setStarting(false); setRefresh(value => value + 1) }
  }
  const busy = starting || Boolean(state?.busy)
  const report = state?.measurement && validateProbeMeasurement(state.measurement).valid ? state.measurement : null
  const fit = state?.fit
  return <section className="probe-connected" aria-label="Native probe analysis and fitting" aria-busy={busy}>
    <h4>Analyze the latest iPhone probe</h4>
    <p>Use <strong>Pull iPhone</strong> after the sound capture. The app verifies the original drive and microphone recording, extracts their response, and checks whether its calibration supports fitting.</p>
    <div className="probe-review-actions"><button disabled={busy || !state} onClick={() => void run('import')}>Analyze latest probe</button>
      <button disabled={busy || !state?.canFit} onClick={() => void run('fit')}>Fit probe with voice model</button>
      <button onClick={() => { setError(''); setRefresh(value => value + 1) }}>Refresh probe status</button></div>
    <p role="status">{busy ? 'Processing original probe evidence…' : state ? 'Local probe service connected.' : 'Probe service unavailable.'}</p>
    {(error || state?.error) && <p role="alert" className="probe-error">{error || state?.error}</p>}
    {state?.import && <><p>Probe import: <strong>{state.import.eligible ? 'Eligible for scientific fitting' : 'Review available; fitting prerequisite not met'}</strong>.</p>
      {state.import.reasons.length > 0 && <ul>{state.import.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}</>}
    {state?.fitBlockedReason && <p>Before fitting: {state.fitBlockedReason}</p>}
    <ProbeSetupPanel status={state?.setup} busy={busy} onSaved={() => void run('import')}/>
    {report && <><ResponseChart current={report}/><p>Evidence source: {report.provenance}. {report.responseUsable.reason}</p></>}
    {fit && <div className="probe-fit-result"><h4>Joint fit result</h4>
      <p>Processing: {fit.status}. Probe contribution: <strong>{fit.includedInFit ? 'Included in this fit' : 'Not included'}</strong>. Model adoption: {fit.adoptionStatus}.</p>
      <p>{fit.probeRecords.length} probe records · {fit.nativeCalls} native model calls.
        {' '}Candidate discrepancy: {fit.score == null ? 'Unavailable' : fit.score.joint_discrepancy.toFixed(3)}.
        {' '}Baseline discrepancy: {fit.baselineScore == null ? 'Unavailable' : fit.baselineScore.joint_discrepancy.toFixed(3)}.</p>
      <ul>{fit.probeRecords.map(record => <li key={record.id}>{record.id}: {record.included_in_fit ? 'Included' : 'Rejected'} · {record.reason}</li>)}</ul>
      <p>These scores describe the fit under its declared calibration and placement. They do not establish correct internal anatomy.</p>
      <details><summary>Probe contribution and model lineage</summary><p>Import: {fit.importId}<br />Parent model: {fit.parentModelId || 'Unavailable'}<br />Result model: {fit.modelId || 'No new model'}</p></details></div>}
  </section>
}
export function AcousticMappingPanel() {
  const [reviews, setReviews] = useState<SavedProbeReview[]>([]), [selected, setSelected] = useState(''), [comparison, setComparison] = useState('')
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; void readProbeReviews().then(rows => { if (active) setReviews(rows.filter(r => measurement(r)).sort((a, b) => b.importedAt.localeCompare(a.importedAt))) }).catch(e => { if (active) setNotice(`Private review storage unavailable: ${String(e)}`) }); return () => { active = false } }, [])
  const saved = reviews.find(r => r.hash === selected) ?? reviews[0], current = measurement(saved)
  const reference = measurement(reviews.find(r => r.hash === comparison))
  async function importFile(file?: File) {
    if (!file) return
    setBusy(true); setNotice('')
    try {
      if (file.size > 2_000_000) throw new Error('Use the small probe-measurement.json review, not raw media or a ZIP (2 MB maximum).')
      const bytes = await file.arrayBuffer(), value: unknown = JSON.parse(new TextDecoder().decode(bytes))
      const result = validateProbeMeasurement(value)
      if (!result.valid) throw new Error(result.errors.join('; '))
      const row = await saveProbeReview(value, bytes, file.name)
      setReviews(old => old.some(r => r.hash === row.hash) ? old : [row, ...old]); setSelected(row.hash)
      setNotice('Review retained privately on this browser. Reimporting identical bytes does not add evidence. Raw-media verification was performed by the local importer, not by this JSON viewer.')
    } catch (e) { setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) }
  }
  async function remove() {
    if (!saved) return
    try { await deleteProbeReview(saved.hash); setReviews(rows => rows.filter(r => r.hash !== saved.hash)); setSelected(''); setComparison(''); setNotice('Removed this browser review copy. The original capture and Mac artifacts are unchanged.') } catch (e) { setNotice(`Delete failed: ${String(e)}`) }
  }
  return <section className="acoustic-mapping" aria-label="Acoustic mapping">
    <div className="probe-header"><div><h3>Acoustic mapping</h3><p>Measure how a short external sound changes across comfortable mouth poses. One native iPhone captures; this Mac reviews.</p></div><span className="probe-status">Private · explicit capture</span></div>
    <div className="probe-steps"><div><strong>1 · Capture</strong><span>Native route, output-level check, placement and repeats.</span></div><div><strong>2 · Analyze response</strong><span>Verified drive/recording lineage, valid bands and repeat quality.</span></div><div><strong>3 · Fit supported evidence</strong><span>Check calibration, run the external-drive joint fit and review its contribution.</span></div></div>
    <ProbeCaptureGuide/>
    <ConnectedProbe/>
    <h4>Separate saved-response review</h4><p>Importing a review below only changes this browser’s comparison view. Use the original-capture analysis above to submit evidence for fitting.</p>
    <label className="probe-import">Import local probe-measurement.json<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = '' }}/></label>
    <p role="status" className={notice.startsWith('Import failed') ? 'probe-error' : undefined}>{busy ? 'Validating and retaining review…' : notice}</p>
    {!current && <p>No probe responses imported. Ordinary singing audio and phone depth captures do not contain the known external excitation required for this measurement.</p>}
    {current && saved && <>
      <label>Retained attempt<select value={saved.hash} onChange={e => { setSelected(e.target.value); setComparison('') }}>{reviews.map(r => <option key={r.hash} value={r.hash}>{measurement(r)?.captureId} · {measurement(r)?.provenance} · {r.importedAt}</option>)}</select></label>
      <label>Compare with<select value={comparison} onChange={e => setComparison(e.target.value)}><option value="">None</option>{reviews.filter(r => r.hash !== saved.hash).map(r => <option key={r.hash} value={r.hash}>{measurement(r)?.captureId} · {r.importedAt}</option>)}</select></label>
      <div className="probe-steps">{[['Captured', current.captured], ['Response usable', current.responseUsable], ['Included in fit', current.includedInFit]].map(([name, state]) => { const s = state as { value: boolean; reason: string }; return <div key={String(name)}><strong>{String(name)} · {s.value ? 'Yes' : 'No'}</strong><span>{s.reason}</span></div> })}</div>
      <p><strong>Provenance: {current.provenance}.</strong> {current.interpretation}</p>
      <ResponseChart current={current} reference={reference}/>
      {reference && <p>Overlay only: different placements, routes or calibrations can explain changes. This is not a normalized reference ratio or an anatomical prediction.</p>}
      <div className="probe-detail-grid"><div><h4>Quality and timing</h4><p>{current.quality.repeats} repeated segments · {current.quality.clippedSamples} clipped samples · SNR {current.quality.snrDb === null ? 'unavailable' : `${current.quality.snrDb.toFixed(1)} dB`}</p><p>Timing: {current.timing?.support ?? 'unknown'}; uncertainty {current.timing?.uncertaintySeconds == null ? 'unknown' : `${current.timing.uncertaintySeconds} s`}. Phase {current.phaseUsable ? 'supported by this record' : 'not used'}.</p><ul>{current.quality.flags.map((flag, i) => <li key={i}>{flag}</li>)}</ul><details><summary>Per-band quality</summary><table><thead><tr><th>Hz</th><th>Valid</th><th>Coherence</th><th>Relative SD</th></tr></thead><tbody>{current.response.frequencyHz.map((f, i) => <tr key={i}><td>{Math.round(f)}</td><td>{current.response.valid[i] ? 'Yes' : 'No'}</td><td>{current.response.coherence[i]?.toFixed(3) ?? 'Unavailable'}</td><td>{current.response.relativeStd[i]?.toFixed(3) ?? 'Unavailable'}</td></tr>)}</tbody></table></details></div>
      <div><h4>Route / placement / calibration</h4><p>These are retained capture declarations. Review actual validity conditions before comparing repetitions.</p><pre>{JSON.stringify(current.calibration, null, 2)}</pre></div></div>
      <details><summary>Immutable lineage and model handoff</summary><dl className="probe-metadata"><dt>Capture / measurement</dt><dd>{current.captureId} / {current.id}</dd><dt>Extractor</dt><dd>{current.extractor?.version}</dd><dt>Source hashes</dt><dd><pre>{JSON.stringify(current.sourceHashes, null, 2)}</pre></dd><dt>Private derived artifacts</dt><dd><pre>{JSON.stringify(current.artifacts, null, 2)}</pre></dd><dt>Imported file SHA-256</dt><dd>{saved.hash}</dd></dl><p>Keep original drive, microphone PCM and manifest beside derived artifacts. An imported summary alone cannot certify raw bytes or add evidence to a fit. Repetitions and changed calibrations remain separate records.</p></details>
      <div className="probe-review-actions"><button onClick={() => download(saved)}>Export review JSON</button><button onClick={() => void remove()}>Delete this review copy</button></div>
    </>}
    <details><summary>What this experiment establishes</summary><p>The external-drive fit uses supported original probe evidence and declared placement/calibration. The response of a loudspeaker near the mouth differs from the vocal-fold source used in ordinary singing. Missing calibration can permit response review while preventing an anatomical fit.</p><p>The capture checklist is a fixed acquisition protocol. A live Astra instruction is displayed separately in the Astra experiment coach. Imported review JSON alone never changes a model.</p></details>
  </section>
}
