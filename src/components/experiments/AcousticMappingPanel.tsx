import { useEffect, useState } from 'react'
import { validateProbeMeasurement } from '../../contracts/probes.ts'
import type { AcousticProbeMeasurement } from '../../contracts/probes.ts'
import { deleteProbeReview, readProbeReviews, saveProbeReview } from '../../experiment/probes/reviewStore.ts'
import type { SavedProbeReview } from '../../experiment/probes/reviewStore.ts'
import { ProbeCaptureGuide } from './ProbeCaptureGuide'
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
    <div className="probe-steps"><div><strong>1 · Capture</strong><span>Native route, output-level check, placement and repeats.</span></div><div><strong>2 · Review response</strong><span>Verified drive/recording lineage, valid bands and repeat quality.</span></div><div><strong>3 · Model handoff</strong><span>External-drive operator and joint-fit service still required.</span></div></div>
    <ProbeCaptureGuide/>
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
    <details><summary>Fit and adaptive teaching availability</summary><p>The current producer does not include probe evidence in fitting. A versioned external-loudspeaker observation operator, bounded placement/calibration model, joint-fit job and independently scored forecast are required. The existing glottis-to-mouth transfer function is a different quantity.</p><p>No runtime Astra tool service is configured in this app. Next-pose steps above are a fixed acquisition protocol; they are not an adaptive model decision. G8 (evidence reaches the fit) and G9 (runtime selection and adaptation) remain unfulfilled. No anatomy update is made from this panel.</p></details>
  </section>
}
