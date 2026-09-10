import { useEffect, useRef, useState } from 'react'
import type { EvaluationRecord, ObservationBundle, PredictionCommit } from '../../contracts'
import { commitExperiment, finishExperimentCapture, importForecast, markUpdateEligible, proposeExperiment, readExperimentLedger, restoreExperimentLedger, retryExperiment, scoreExperiment, startExperimentCapture, stopExperiment, writeExperimentLedger } from '../../experiment/ledger'
import type { ExperimentTrial } from '../../experiment/ledger'

export interface ExperimentRunnerProps {
  onStartCapture?: (context: { predictionId: string; trialId: string; task: string }) => Promise<void>
  onStopCapture?: () => Promise<{ observationBundle: ObservationBundle }>
  onEvaluate?: (context: { commit: PredictionCommit; observation: ObservationBundle; captureStartedAt: string }) => Promise<EvaluationRecord>
}
/** Prospective recording is an explicit user action after an imported forecast is frozen. */
export function ExperimentRunner({ onStartCapture, onStopCapture, onEvaluate }: ExperimentRunnerProps) {
  const [trials, setTrials] = useState<ExperimentTrial[]>([])
  const [selected, setSelected] = useState('')
  const [experimentId, setExperimentId] = useState('')
  const [task, setTask] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const mounted = useRef(true)
  const generation = useRef(0)
  const actionLocked = useRef(false)
  const currentTrials = useRef(trials)
  const trial = trials.find(item => item.id === selected)
  useEffect(() => {
    mounted.current = true
    void restoreExperimentLedger().then(restored => {
      if (!mounted.current) return
      writeExperimentLedger(restored)
      currentTrials.current = restored
      setTrials(restored)
      setSelected(restored.at(-1)?.id ?? '')
      setReady(true)
    }).catch(error => setMessage(String(error)))
    return () => { mounted.current = false }
  }, [])
  function save(next: ExperimentTrial) {
    const existing = currentTrials.current
    const updated = existing.some(item => item.id === next.id) ? existing.map(item => item.id === next.id ? next : item) : [...existing, next]
    writeExperimentLedger(updated)
    currentTrials.current = updated
    setTrials(updated)
    setSelected(next.id)
  }
  async function run(action: () => ExperimentTrial | Promise<ExperimentTrial>) {
    if (actionLocked.current) return
    actionLocked.current = true
    setBusy(true)
    setMessage('')
    const token = ++generation.current
    try { const next = await action(); if (mounted.current && token === generation.current) save(next) }
    catch (error) { if (mounted.current && token === generation.current) setMessage(error instanceof Error ? error.message : String(error)) }
    finally { actionLocked.current = false; if (mounted.current && token === generation.current) setBusy(false) }
  }
  async function startCapture() {
    if (!trial || !onStartCapture) return
    await run(async () => {
      const capturing = await startExperimentCapture(trial)
      // Save before awaiting the recorder, so a crash cannot silently erase the attempt.
      save(capturing)
      try { await onStartCapture({ predictionId: capturing.commit!.id, trialId: capturing.id, task: capturing.proposal.task }); return capturing }
      catch (error) { return stopExperiment(capturing, 'failed', `Recorder failed to start: ${String(error)}`) }
    })
  }
  async function stopCapture() {
    if (!trial || !onStopCapture) return
    await run(async () => {
      try { const recording = await onStopCapture(); return finishExperimentCapture(trial, recording.observationBundle) }
      catch (error) { return stopExperiment(trial, 'failed', `Capture failed: ${String(error)}`) }
    })
  }
  function exportLedger() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: '1.0.0', kind: 'experiment-ledger', trials: readExperimentLedger() }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'experiment-ledger.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const canCreate = !trial || !['committed', 'capturing'].includes(trial.state)
  return <section className="experiment-runner" aria-label="Prospective experiment runner">
    <h3>Run a prospective experiment</h3>
    <p>Propose → import forecast → freeze prediction → record → score → release for update.</p>
    <p>The forecasting and fitting engine is not connected. Import its KIT forecast to continue; the app does not invent predictions or fitted anatomy.</p>
    <form onSubmit={event => { event.preventDefault(); void run(() => proposeExperiment(experimentId, task)) }}>
      <label>Experiment ID <input value={experimentId} onChange={event => setExperimentId(event.target.value)} required placeholder="Match the forecast experimentId" /></label>{' '}
      <label>Capture instruction <input value={task} onChange={event => setTask(event.target.value)} required placeholder="Match the forecast intervention" /></label>{' '}
      <button disabled={!ready || busy || !canCreate}>Create proposal</button>
    </form>
    <p><button onClick={exportLedger} disabled={!trials.length}>Export trial metadata</button> Audio/video bytes are exported separately with recordings.</p>
    {!!trials.length && <label>Trial <select value={selected} disabled={busy || trial?.state === 'capturing'} onChange={event => setSelected(event.target.value)}>{trials.map(item => <option key={item.id} value={item.id}>{item.proposal.experimentId} · {item.state} · {item.id.slice(0, 8)}</option>)}</select></label>}
    {trial && <div>
      <p><strong>{trial.state}</strong> — {trial.proposal.task}</p>
      {['proposed', 'validated'].includes(trial.state) && <label>Import forecast JSON <input type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => importForecast(trial, JSON.parse(await file.text()))) }} /></label>}
      {trial.state === 'validated' && <button disabled={busy} onClick={() => void run(() => commitExperiment(trial))}>Freeze prediction</button>}
      {trial.commit && <p>Prediction {trial.commit.id.slice(0, 8)} · committed {new Date(trial.commit.committedAt).toLocaleTimeString()}<br /><small>SHA-256: {trial.commit.sha256}</small></p>}
      {trial.state === 'committed' && <><button disabled={busy || !onStartCapture || !onStopCapture} onClick={() => void startCapture()}>Start capture</button>{(!onStartCapture || !onStopCapture) && <p>Capture is unavailable. Connect the recorder to continue.</p>}</>}
      {trial.state === 'capturing' && <button disabled={busy} onClick={() => void stopCapture()}>Stop capture</button>}
      {trial.state === 'captured' && <>
        <p>Recording retained. Awaiting independent scoring; fitting remains locked.</p>
        {onEvaluate && <button disabled={busy} onClick={() => void run(async () => scoreExperiment(trial, await onEvaluate({ commit: trial.commit!, observation: trial.observation!, captureStartedAt: trial.captureStartedAt! })))}>Score recording</button>}
        <label> Import evaluation JSON <input type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => scoreExperiment(trial, JSON.parse(await file.text()))) }} /></label>
      </>}
      {trial.state === 'scored' && <button disabled={busy} onClick={() => void run(() => markUpdateEligible(trial))}>Release scored evidence for update</button>}
      {trial.state === 'update-eligible' && <p>Evidence is eligible for an engine update. No model has been changed; the fitting engine remains unavailable.</p>}
      {['failed', 'cancelled', 'excluded'].includes(trial.state) && <button disabled={busy} onClick={() => void run(() => retryExperiment(trial))}>Retry as a new trial</button>}
      {['proposed', 'validated', 'committed', 'captured'].includes(trial.state) && <button disabled={busy} onClick={() => void run(() => stopExperiment(trial, 'cancelled', 'Cancelled by user; record kept in the experiment denominator.'))}>Cancel trial</button>}
      <details><summary>Attempt history ({trial.history.length})</summary><ol>{trial.history.map((entry, index) => <li key={index}>{entry.at} · {entry.state}: {entry.reason}</li>)}</ol></details>
    </div>}
    {message && <p role="alert">{message}</p>}
  </section>
}
