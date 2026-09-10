import { useEffect, useRef, useState } from 'react';
import { askAstra, AstraRequestError, getAstraStatus } from './astraClient';
import type { AstraDecisionReceipt, AstraStatus } from './astraClient';
import './AstraCoachPanel.css';

export function AstraCoachPanel({ onDecision, refreshKey = 0 }: {
  onDecision?: (receipt: AstraDecisionReceipt) => void;
  refreshKey?: number;
}) {
  const [status, setStatus] = useState<AstraStatus | null>(null);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<{ requestId: string; goal: string } | null>(null);
  const callback = useRef(onDecision);
  const delivered = useRef<string | null>(null);
  const decisionGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { callback.current = onDecision; }, [onDecision]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const generation = decisionGeneration.current;
      try {
        const next = await getAstraStatus(controller.signal);
        if (controller.signal.aborted || generation !== decisionGeneration.current) return;
        setStatus(next);
        if (next.latest && delivered.current !== next.latest.requestId) {
          delivered.current = next.latest.requestId;
          callback.current?.(next.latest);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setStatus(null);
          setError(failure instanceof Error ? failure.message : 'Cannot reach Astra.');
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refreshKey, refresh]);

  async function decide() {
    if (asking) return;
    setAsking(true);
    setError('');
    // A lost response may follow a committed decision. Retry its original request.
    const attempt = pending ?? { requestId: crypto.randomUUID(), goal };
    setPending(attempt);
    try {
      const receipt = await askAstra(attempt.requestId, attempt.goal);
      decisionGeneration.current += 1;
      if (!mounted.current) return;
      setPending(null);
      setStatus(previous => previous ? { ...previous, latest: receipt } : previous);
      if (delivered.current !== receipt.requestId) {
        delivered.current = receipt.requestId;
        callback.current?.(receipt);
      }
    } catch (failure) {
      if (mounted.current && failure instanceof AstraRequestError && failure.status >= 400 && failure.status < 500) setPending(null);
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Astra could not choose an experiment.');
    } finally {
      if (mounted.current) { setAsking(false); setRefresh(value => value + 1); }
    }
  }

  const busy = asking || Boolean(status?.running);
  const ready = Boolean(status?.provider.available && status.sessionId && status.runId);
  const latest = status?.latest;
  return <section className="astra-coach" aria-label="Astra experiment coach" aria-busy={busy}>
    <div className="astra-coach-heading"><h3>Astra experiment coach</h3>
      <span>{status?.provider.available ? 'Live provider ready' : 'Live provider unavailable'}</span></div>
    <p>Astra uses your current physiological hypotheses and acoustic predictions to choose the next supported experiment. Ask again after scoring a recording so it can use the new evidence.</p>
    {!status && !error && <p role="status">Checking Astra connection…</p>}
    {status && <p>{status.provider.available ? `${status.provider.provider} · ${status.provider.model}` : status.provider.reason || 'Configure the model connection on the local server.'}
      {' '}Calls remaining: {status.remainingCalls} / {status.callBudget}.</p>}
    {status && !status.sessionId && <p>Fit your first iPhone capture to create a model before asking Astra.</p>}
    <label className="astra-coach-goal">Your singing goal
      <textarea value={goal} onChange={event => setGoal(event.target.value)} maxLength={1000} rows={2}
        disabled={busy || Boolean(pending)} placeholder="For example: explore a brighter, comfortable vowel." /></label>
    <div className="astra-coach-actions"><button onClick={() => void decide()}
      disabled={busy || !ready || (status?.remainingCalls === 0 && !pending)}>
      {busy ? 'Astra is choosing an experiment…' : pending ? 'Retry Astra request' : 'Ask Astra for the next experiment'}</button>
      <button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Refresh connection</button></div>
    {busy && <p role="status">Waiting for the server to finish and commit the prediction. Keep this page open.</p>}
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    {latest && <div className="astra-coach-decision" aria-label="Latest Astra decision">
      <h4>{latest.decision.action === 'rest' ? 'Rest' : 'Next recording'}</h4>
      <p className="astra-coach-cue">{latest.decision.cue}</p><p>{latest.decision.explanation}</p>
      {latest.decision.action === 'record' && <p>The prediction is committed. Record this instruction, pull the new iPhone capture, then score it in the scientific model panel.</p>}
      <details><summary>Decision receipt</summary><p>Provider: {latest.provider} · {latest.model}</p>
        <p>Session: {latest.sessionId}<br />Design: {latest.designId || 'No recording requested'}
          {latest.modelId && <><br />Model: {latest.modelId}</>}
          {latest.sessionVersion != null && <><br />Session version: {latest.sessionVersion}</>}
          <br />Request: {latest.requestId}</p></details>
    </div>}
  </section>;
}
