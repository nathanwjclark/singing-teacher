import { useEffect, useRef, useState } from 'react'
import { startPhonationMonitor } from './runtime.ts'
import type { LivePhonationState } from './runtime.ts'
import { addReferenceSample, compareToReference, referenceForProcessing, REFERENCE_WINDOWS } from './trends.ts'
import type { AcousticSample, Reference } from './trends.ts'
import './PhonationPanel.css'

type Entry = { state: LivePhonationState; cue: string | null }
function sampleOf(state: LivePhonationState): AcousticSample | null {
  const values = state.observation?.descriptors
  if (state.status !== 'available' || !values || values.pitchHz.value === null || values.periodicity.value === null) return null
  return { pitch: values.pitchHz.value, periodicity: values.periodicity.value, slope: values.harmonicSpectralSlopeDbOctave.value, flatness: values.spectralFlatness.value }
}

export default function PhonationPanel({ audioStream }: { audioStream: MediaStream | null }) {
  const [enabled, setEnabled] = useState(false), [context, setContext] = useState('ah · comfortable level · unchanged microphone position')
  const [confirmed, setConfirmed] = useState(false), [revision, setRevision] = useState(0)
  const [current, setCurrent] = useState<{ stream: MediaStream; entry: Entry } | null>(null)
  const [history, setHistory] = useState<Entry[]>([])
  const reference = useRef<Reference>({ samples: [] })
  useEffect(() => {
    reference.current = { samples: [] }
    if (!enabled || !audioStream || !confirmed) return
    return startPhonationMonitor(audioStream, state => {
      if (state.observation) {
        reference.current = referenceForProcessing(reference.current, JSON.stringify(state.observation.processing))
      }
      const sample = sampleOf(state)
      let cue: string | null = null
      if (sample) {
        const wasReady = reference.current.samples.length >= REFERENCE_WINDOWS
        reference.current = addReferenceSample(reference.current, sample)
        cue = wasReady ? compareToReference(reference.current, sample) : `Building your reference: ${reference.current.samples.length}/${REFERENCE_WINDOWS} usable, pitch-matched windows. Keep the same vowel and comfortable level.`
      }
      const entry = { state, cue }
      setCurrent({ stream: audioStream, entry })
      // Retain both usable and unsuccessful dated measurements, without retaining microphone PCM.
      setHistory(previous => [...previous.slice(-59), entry])
    })
  }, [enabled, audioStream, confirmed, revision])
  const active = enabled && confirmed && current?.stream === audioStream ? current.entry : null
  const state = active?.state
  const values = state?.status === 'available' ? state.observation?.descriptors : null
  const reset = () => { setCurrent(null); setRevision(value => value + 1) }
  return <section className="phonation-panel" aria-labelledby="phonation-title">
    <h2 id="phonation-title">Optional phonation acoustics</h2>
    <p>Compare periodicity and harmonic structure within this session. Audio does not establish vocal-fold contact or complete closure.</p>
    <label><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setCurrent(null) }} /> Enable local acoustic feedback</label>
    {enabled && <>
      <label>Reference context<input value={context} onChange={event => { setContext(event.target.value); setConfirmed(false); setCurrent(null) }} /></label>
      <label><input type="checkbox" checked={confirmed} disabled={!context.trim()} onChange={event => { setConfirmed(event.target.checked); setCurrent(null) }} /> I will keep this vowel, pitch, comfortable level and microphone position consistent.</label>
      <p>Use a comfortable sustained vowel. Five usable windows establish a reference; change context or reset it before comparing a different task. Never squeeze or force the sound.</p>
      <button type="button" onClick={reset}>Reset reference / retry analysis</button>
    </>}
    <p role="status">{!enabled ? 'Disabled — existing coaching and scientific modeling continue.' : !audioStream ? 'Unavailable — start the app microphone to measure.' : !confirmed ? 'Confirm the reference context to begin.' : state ? `${state.status}: ${state.reason ?? 'Current acoustic measurement available.'}` : 'Starting optional analysis…'}</p>
    <p className="phonation-capabilities">Live measurement: {state?.status ?? 'disabled'} · live source inference: unsupported · acoustic comparison: {active?.cue ? 'available' : 'unavailable'}</p>
    {values && <dl>
      <div><dt>Pitch</dt><dd>{values.pitchHz.value?.toFixed(1) ?? 'Unavailable'} Hz</dd></div>
      <div><dt>Periodicity</dt><dd>{values.periodicity.value?.toFixed(3) ?? 'Unavailable'}</dd></div>
      <div><dt>Spectral flatness</dt><dd>{values.spectralFlatness.value?.toFixed(3) ?? 'Unavailable'}</dd></div>
      <div><dt>Raw harmonic slope</dt><dd>{values.harmonicSpectralSlopeDbOctave.value?.toFixed(1) ?? 'Unavailable'} dB/octave</dd></div>
    </dl>}
    {active?.cue && <p className="phonation-cue">{active.cue}</p>}
    {values && <p>Room, microphone processing and vocal-tract filtering affect these values. Flatness is a noise-like spectrum descriptor, not a calibrated noise ratio; harmonic slope is not corrected glottal tilt.</p>}
    {history.length > 0 && <details><summary>Dated analysis history ({history.length}, latest 60)</summary>
      <p>Historical results are not current instructions. This live reference resets when the stream, context or feature changes.</p>
      <ol>{history.slice().reverse().map((entry, index) => <li key={`${entry.state.evidenceAt}-${index}`}>
        <time dateTime={entry.state.evidenceAt}>{new Date(entry.state.evidenceAt).toLocaleTimeString()}</time> · {entry.state.status} · {entry.state.reason ?? entry.cue ?? 'Measurement recorded'}
      </li>)}</ol>
    </details>}
  </section>
}
