import { useEffect, useState } from 'react';
import { getSourceStatus, sourceAction } from './sourceClient';
import type { SourceAction, SourceInferenceStatus } from './sourceClient';
import './SourceInferencePanel.css';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = 'Unavailable'): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}
function number(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : 'Unavailable'; }
function hertz(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : 'Unavailable'; }
function f0(row: Record<string, unknown>): string { return `${hertz(row.requested_f0_hz)} → ${hertz(row.simulated_f0_hz)}`; }
const F0_NOTE = 'Requested F0 is the native frequency control; simulated F0 is the pitch the same extractor measured in the simulated frame. The two-mass model can miss the requested pitch, so the discrepancy without the pitch term is shown beside the full discrepancy. Both need the same four descriptors, and the full discrepancy still sets every rank.';
function parameters(value: unknown): string {
  return Object.entries(object(value)).filter(([key, entry]) => typeof entry === 'number' && Number.isFinite(entry) || key === 'source_model' && typeof entry === 'string').map(([key, entry]) => `${key}: ${typeof entry === 'string' ? entry : number(entry)}`).join(' · ') || 'Unavailable';
}

export function SourceInferencePanel() {
  const [status, setStatus] = useState<SourceInferenceStatus | null>(null);
  const [enabled, setEnabled] = useState(false), [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [error, setError] = useState(''), [starting, setStarting] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await getSourceStatus(controller.signal);
        if (!controller.signal.aborted) setStatus(value);
      } catch (failure) {
        if (!controller.signal.aborted) { setStatus(null); setError(failure instanceof Error ? failure.message : String(failure)); }
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);
  async function run(action: SourceAction) {
    setStarting(true); setError('');
    try {
      await sourceAction(action);
      setConfirmedKey(null);
      setStatus(previous => previous ? { ...previous, running: true } : previous);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setStarting(false); setRefresh(value => value + 1); }
  }
  const busy = starting || Boolean(status?.running);
  const ready = enabled && status?.enabled && !busy;
  const fit = object(status?.fit?.result), joint = object(fit.joint);
  const alternatives = Array.isArray(joint.candidates) ? joint.candidates.map(object) : [];
  const forecast = object(status?.forecast?.result?.forecast);
  const scored = object(status?.score?.result);
  const bank = Array.isArray(forecast.alternatives) ? forecast.alternatives.map(object) : [];
  const ranked = Array.isArray(scored.alternatives) ? scored.alternatives.map(object) : [];
  const hasForecast = typeof forecast.target_id === 'string' && status?.forecast?.status === 'succeeded' && status.forecast.current === true && status.forecast.authoritativeStatus === 'committed' && forecast.status === 'available';
  const pose = text(status?.forecast?.result?.pose, 'a');
  const forecastKey = JSON.stringify([status?.sessionId,status?.runId,forecast.target_id,status?.forecast?.result?.sha256,forecast.sealed_at]);
  const confirmed = hasForecast && confirmedKey === forecastKey;
  return <section className="source-inference-panel" aria-label="Optional source and tract inference" aria-busy={busy}>
    <h2>Optional source and tract inference</h2>
    <p>Test competing sound-source and vocal-tract explanations using original recordings. Source parameters are conditional simulator hypotheses; audio does not establish vocal-fold contact, complete closure or tissue mechanics.</p>
    <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy}/> Enable optional source experiments</label>
    <p role="status">{busy ? 'Optional scientific jobs are running.' : !enabled ? 'Optional experiments are off.' : !status?.enabled ? 'Optional source service is unavailable or disabled.' : 'Optional source service connected.'} The baseline model and ordinary coaching remain available.</p>
    {error && <p role="alert">{error}</p>}
    <div className="source-inference-actions"><button disabled={!ready} onClick={() => void run('analyze')}>Analyze latest capture for source hypotheses</button>
      <button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Refresh optional status</button></div>
    <p>First record a comfortable sustained ah vowel and use Pull iPhone. The optional analysis uses that original capture; it does not reinterpret microphone trends as closure measurements.</p>
    {status?.fit && <p>Source fit: {status.fit.status}. {status.fit.reason}</p>}
    {Object.keys(fit).length > 0 && <><p>Scientific outcome: {text(fit.status)}. {text(fit.reason, '')}</p>
      <dl><div><dt>Source + tract discrepancy</dt><dd>{number(object(joint.best).score)}</dd></div>
        <div><dt>Fixed-source comparison</dt><dd>{number(object(object(fit.fixed_source).best).score)}</dd></div>
        <div><dt>Fixed-anatomy comparison</dt><dd>{number(object(object(fit.fixed_anatomy).best).score)}</dd></div></dl>
      <p>Actual synthesis calls: {text(fit.actual_synthesis_calls)}. Source model: {text(fit.source_model_version)}.</p>
      {typeof fit.source_assumptions === 'string' && <p>{fit.source_assumptions}</p>}
      {alternatives.length > 0 && <details><summary>Competing source and tract hypotheses ({alternatives.length})</summary>
        <div className="source-inference-table"><table><thead><tr><th>Hypothesis</th><th>Source family</th><th>Status / discrepancy</th><th>Without pitch term</th><th>Requested → simulated F0 (Hz)</th><th>Source and articulation controls</th><th>Tract parameters</th></tr></thead>
          <tbody>{alternatives.map((candidate, index) => { const predictions = Array.isArray(candidate.predictions) ? candidate.predictions.map(object) : [];
            return <tr key={text(candidate.candidate_id, String(index))}><td>{text(candidate.candidate_id)}</td><td>{text(candidate.source_model, 'geometric')}</td><td>{text(candidate.status)} · {number(candidate.score)}</td><td>{number(candidate.score_excluding_pitch)}</td>
            <td>{predictions.map((prediction, i) => <p key={i}>{f0(prediction)}</p>)}</td><td>{predictions.map((prediction, i) => <p key={i}>{parameters(prediction.controls)}</p>)}</td><td>{parameters(candidate.anatomy)}</td></tr>; })}</tbody></table></div>
        <p>{F0_NOTE}</p>
        <p>PS (geometric pulse skew), XB/XT (two-mass rest displacement in cm), EAA (extra arytenoid area in cm²), DF (damping factor), F0 (native frequency control), PR, JA and gain are simulator controls, not measurements of vocal-fold contact or instructions to reproduce internal pressures. The app's two-mass alternatives vary XB=XT only; EAA and DF stay fixed.</p></details>}
      {typeof fit.identifiability === 'string' && <p>{fit.identifiability}</p>}
    </>}
    <div className="source-inference-actions"><button disabled={!ready || alternatives.length === 0} onClick={() => void run('forecast')}>Freeze optional prediction</button></div>
    {status?.forecast && <p>Forecast: {status.forecast.status}. {status.forecast.reason}</p>}
    {hasForecast && <div className="source-inference-forecast"><h3>Prospective source experiment</h3>
      <p>A prediction was saved for a comfortable sustained {pose} vowel. Record a new attempt after the prediction, keeping the vowel, comfortable pitch and microphone placement consistent, then Pull iPhone.</p>
      <p>{bank.length ? 'The frozen bank retains competing source and tract controls.' : `Declared simulator controls: ${parameters(forecast.controls)}.`} These conditions are assumptions; do not force your voice to match a source parameter.</p>
      <p>Prediction status: {text(forecast.status)}. Saved: {text(forecast.sealed_at)}.</p>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmedKey(event.target.checked ? forecastKey : null)} disabled={busy}/> The latest pulled capture is a new comfortable {pose} vowel attempt recorded after this prediction.</label>
      <button disabled={!ready || !confirmed} onClick={() => void run('score')}>Score later capture against source prediction</button>
    </div>}
    {bank.length > 0 && <details><summary>Frozen competing predictions ({bank.length})</summary><p>Each row was committed before the later recording. Unavailable predictions remain visible and are not zero discrepancies.</p>
      <div className="source-inference-table"><table><thead><tr><th>Family / candidate</th><th>Prediction status</th><th>Calibration discrepancy</th><th>Requested → simulated F0 (Hz)</th><th>Declared controls</th><th>Tract hypothesis</th></tr></thead><tbody>{bank.map((row,i)=><tr key={text(row.alternative_id,String(i))}><td>{text(row.family)} / {text(row.candidate_id)}</td><td>{text(row.status)} · {text(row.reason,'')}</td><td>{number(row.calibration_score)}</td><td>{f0(row)}</td><td>{parameters(row.controls)}</td><td>{parameters(row.anatomy)}</td></tr>)}</tbody></table></div>
      <p>Fit identity: {text(forecast.fit_sha256)}. Bank coverage: {parameters(forecast.coverage)}.</p></details>}
    {!hasForecast && typeof forecast.target_id === 'string' && <p>This saved forecast is historical or unavailable for a new recording. Freeze a current supported prediction before continuing.</p>}
    {status?.score && <p>Scoring: {status.score.status}. {status.score.reason}</p>}
    {Object.keys(scored).length > 0 && <div><p>Scientific result: {text(scored.status)}. {text(scored.reason, '')} {ranked.length ? 'Conditional ranking of the frozen alternatives follows.' : `Discrepancy: ${number(scored.score)}.`}</p>
      {ranked.length > 0 && <div className="source-inference-table"><table><thead><tr><th>Family / candidate</th><th>Held-out status</th><th>Discrepancy</th><th>Without pitch term</th><th>Requested → simulated F0 (Hz)</th><th>Calibration rank</th><th>Held-out rank</th><th>Rank change</th></tr></thead><tbody>{ranked.map((row,i)=><tr key={text(row.alternative_id,String(i))}><td>{text(row.family)} / {text(row.candidate_id)}</td><td>{text(row.status)} · {text(row.reason,'')}</td><td>{number(row.score)}</td><td>{number(row.score_excluding_pitch)}</td><td>{f0(row)}</td><td>{text(row.calibration_rank)}</td><td>{text(row.heldout_rank)}</td><td>{text(row.rank_change)}</td></tr>)}</tbody></table><p>{F0_NOTE}</p><p>Ranks are conditional on the retained alternatives and declared recording assumptions. They do not identify vocal-fold closure or establish a unique anatomy.</p></div>}
      <p>{scored.model_updated === true ? 'The optional model was updated.' : 'No model update was applied; the baseline is retained.'}</p></div>}
    {Boolean(scored.conditionalRanking) && <p>Conditional ranking: {text(object(scored.conditionalRanking).rankingId)} · version {text(object(scored.conditionalRanking).version)} · parent {text(object(scored.conditionalRanking).parentRankingId,'None')}. Bank: {text(object(scored.conditionalRanking).bankSha256)}.</p>}
    {status?.sessionId && <details><summary>Optional experiment lineage</summary><p>Session: {status.sessionId}<br/>Run: {status.runId}<br/>Prediction: {text(forecast.target_id)}<br/>Forecast hash: {text(status.forecast?.result?.sha256)}</p></details>}
  </section>;
}
