import { useEffect, useState } from 'react';
import { controlAction, getControlStatus } from './controlClient';
import type { ControlAction, ControlBinding, ControlPhase, ControlStatus } from './controlClient';
import './ControlLearningPanel.css';

const LABELS: Record<string, string> = { pitchHz: 'Pitch', centroidHz: 'Spectral centroid', flatness: 'Spectral flatness' };
const fixed = (value: number | null | undefined, digits = 3) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
const phaseText = (name: string, phase: ControlPhase | null) => phase ? `${name}: ${phase.status}${phase.reason ? `. ${phase.reason}` : ''}` : null;

function Binding({ binding, minimum }: { binding: ControlBinding; minimum: number }) {
  const forecast = binding.latestForecast, anatomies = forecast?.anatomies ?? [];
  const context = binding.context;
  return <div className="control-binding">
    <p className="control-cue">“{binding.deliveredCue}”</p>
    <p>Context: vowel {context.vowel}, {fixed(context.pitch_hz, 1)} Hz reference pitch, {context.level} level, posture {context.posture.replaceAll('-', ' ')}, {context.capture_context_id} ({context.source_kind}).
      Alternatives: {binding.controls.map(c => `${c.controlId} (JA ${fixed(c.JA, 1)}, ${fixed(c.f0Hz, 1)} Hz)`).join(', ')}. Declared gain {fixed(binding.gain, 2)} is a recording nuisance, not an alternative.</p>
    <p>Attempts: {binding.attempts.scored} scored, {binding.attempts.unscorable} unscorable, {binding.attempts.stopped} stopped, {binding.attempts.failed} failed. Scored attempts count toward the weights only while the wording, context, alternatives and scoring code stay the same.</p>
    {forecast ? <>
      <p>Latest prediction {forecast.forecastId}: {forecast.status}{forecast.current ? ', ready for a recording' : ''}. Prediction status: {forecast.predictionStatus}.</p>
      <div className="control-table"><table><thead><tr><th>Anatomy hypothesis</th><th>Matched attempts</th><th>Weights in latest prediction</th></tr></thead>
        <tbody>{anatomies.map(row => <tr key={row.anatomySha256}>
          <td>{row.hypothesisId}</td>
          <td>{row.matchedAttempts} of {minimum} matched attempts{row.forecastMatchedAttempts !== row.matchedAttempts ? ` (${row.forecastMatchedAttempts} when this prediction was frozen)` : ''}</td>
          <td>{row.supportStatus === 'empirical' ? Object.entries(row.weights).map(([id, weight]) => `${id} ${fixed(weight)}`).join(' · ') : `Uniform until ${minimum} matched attempts`}</td>
        </tr>)}</tbody></table></div>
      {forecast.anatomyControlTradeoff && <p>Different anatomy hypotheses favour different alternatives, so jaw, pitch and anatomy trade off here. The result is unresolved.</p>}
      <div className="control-residuals" aria-label="Microphone residual calibration">
        <h3>Microphone residual calibration (reported separately)</h3>
        <p>Recorded minus earlier frozen predictions. Those predictions used different weights, so this is not stable measurement noise, and it never changes the weights or predictions above.</p>
        <ul>{anatomies.map(row => <li key={row.anatomySha256}>{row.hypothesisId}: {row.residualCalibration.status}, {row.residualCalibration.count} attempts.{' '}
          {Object.entries(row.residualCalibration.features).map(([name, feature]) => `${LABELS[name] ?? name} mean ${fixed(feature.mean, 2)} ${feature.unit}, SD ${fixed(feature.sd, 2)}`).join('; ')}</li>)}</ul>
      </div>
    </> : <p>No prediction has been frozen for this wording yet.</p>}
  </div>;
}

export function ControlLearningPanel() {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState(''), [starting, setStarting] = useState(false), [refresh, setRefresh] = useState(0);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await getControlStatus(controller.signal);
        if (!controller.signal.aborted) setStatus(value);
      } catch (failure) {
        if (!controller.signal.aborted) { setStatus(null); setError(failure instanceof Error ? failure.message : String(failure)); }
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);
  async function run(action: ControlAction) {
    setStarting(true); setError('');
    try {
      await controlAction(action);
      setConfirmed(null);
      setStatus(previous => previous ? { ...previous, running: true } : previous);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setStarting(false); setRefresh(value => value + 1); }
  }
  const busy = starting || Boolean(status?.running);
  const minimum = status?.minimumMatchedAttempts ?? 3;
  const committed = status?.bindings.flatMap(binding => binding.latestForecast?.current ? [{ binding, forecast: binding.latestForecast }] : []).at(-1);
  return <section className="control-learning-panel" aria-label="Cue-execution learning" aria-busy={busy}>
    <h2>Cue-execution learning</h2>
    <p>Freezes a prediction for the exact cue Astra delivered before you record, then scores the recording against every jaw-angle and pitch alternative for each anatomy hypothesis. After {minimum} matched attempts with the same wording and context, the next prediction is weighted toward the alternatives that matched earlier recordings.</p>
    <p>Weights compare simulated alternatives on standardized sound descriptors. They are not the probability that you moved your jaw or changed pitch. Nothing here measures movement or changes the anatomy model.</p>
    <p role="status">{busy ? 'A cue-execution job is running.' : status?.workerAvailable === false ? 'The scientific worker is unavailable.' : status?.reason ?? 'Cue-execution learning is connected.'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="control-actions">
      <p>Current Astra cue: {status?.delivery.cue ? <q>{status.delivery.cue}</q> : status?.delivery.reason ?? 'unavailable'}</p>
      <button disabled={busy || !status?.delivery.current} onClick={() => void run('forecast')}>Freeze prediction for this cue</button>
      <button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Refresh</button>
    </div>
    {committed && <div className="control-actions">
      <p>Record one attempt using exactly this wording: <q>{committed.binding.deliveredCue}</q> Then use Pull iPhone. Stop if anything is uncomfortable.</p>
      <label><input type="checkbox" checked={confirmed === committed.forecast.forecastId} disabled={busy} onChange={event => setConfirmed(event.target.checked ? committed.forecast.forecastId : null)}/> The latest pulled capture is a new attempt recorded after this prediction.</label>
      <button disabled={busy || confirmed !== committed.forecast.forecastId} onClick={() => void run('score')}>Score latest capture</button>
      <button disabled={busy} onClick={() => void run('stop')}>Record attempt as stopped</button>
    </div>}
    {[phaseText('Forecast', status?.forecast ?? null), phaseText('Score', status?.score ?? null), phaseText('Stop', status?.stop ?? null)].filter(Boolean).map(line => <p key={line}>{line}</p>)}
    <h3>Delivered cues</h3>
    {status?.bindings.length ? status.bindings.map(binding => <Binding key={binding.bindingId} binding={binding} minimum={minimum}/>) : <p>No cue has been frozen yet.</p>}
    {status?.truncated && <p>Older cue bindings are omitted from this view; they remain in the session ledger.</p>}
  </section>;
}
