import { useEffect, useRef, useState } from 'react';
import { Cable, LoaderCircle, X } from 'lucide-react';
import './NativePullButton.css';
import {useScienceStatus,useScienceOutcome} from '../science/scienceClient';
import {useCaptureProgress} from '../science/captureFlow';
import type {NativeCaptureReceipt as Receipt} from '../science/captureFlow';

export function NativePullButton() {
  const [busy, setBusy] = useState(false);
  const [confirmed,setConfirmed]=useState(false),[purpose,setPurpose]=useState<'calibration'|'outcome'>('calibration');
  const science=useScienceStatus(),outcome=useScienceOutcome(science.status==='succeeded'?science.runId:undefined),progress=useCaptureProgress();
  const processing=!!progress||science.status==='running'||outcome.status==='running';
  const selected=science.result?.forecast.rankings.find(r=>r.experiment.experiment_id===science.result?.forecast.selected_experiment_id)?.experiment;
  const [notice, setNotice] = useState<{ message: string; receipt?: Receipt; error?: boolean } | null>(null);
  const canScore=!!selected&&science.status==='succeeded'&&notice?.receipt?.captureId!==science.result?.sourceCaptureId;
  const later=purpose==='outcome'&&canScore;
  const vowel=later?selected!.pose:'a';
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function pull() {
    if (busy||processing) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 210_000);
    setConfirmed(false);setPurpose('calibration');setBusy(true); setNotice({ message: 'Reading the latest saved capture. Keep the iPhone connected and unlocked…' });
    try {
      const response = await fetch('/api/native-captures/pull', { method: 'POST', signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.receipt) throw new Error(result.error || 'The iPhone pull could not finish.');
      setNotice({ message: result.receipt.message, receipt: result.receipt });
      window.dispatchEvent(new CustomEvent('singing:native-capture',{detail:result.receipt}));
    } catch (error) {
      setNotice({ error: true, message: controller.signal.aborted ? 'The pull took too long. Keep the iPhone unlocked; click again to check or retry.' : error instanceof Error ? error.message : 'The iPhone pull failed.' });
    } finally { window.clearTimeout(timeout); request.current = null; setBusy(false); }
  }
  return <div className="native-pull">
    <button className="native-pull-button" type="button" onClick={() => void pull()} disabled={busy||processing} title="Copy the latest saved native capture over USB. Keep the iPhone unlocked.">
      {busy||processing?<LoaderCircle size={14} className="capture-spinner" aria-hidden="true"/>:<Cable size={14} aria-hidden="true"/>}<span>{busy ? 'Pulling…' : processing ? progress?.label??(outcome.status==='running'?'Scoring capture…':'Fitting model…') : 'Pull iPhone'}</span>
    </button>
    {processing&&<span className="capture-progress-label" role="status">{progress?.label??'Processing privately on this Mac…'}</span>}
    {notice && <div className={`native-pull-notice${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
      <button className="native-pull-dismiss" type="button" aria-label="Dismiss import status" onClick={() => setNotice(null)}><X size={14}/></button>
      <strong>{busy ? 'USB import' : notice.error ? 'iPhone needs attention' : notice.receipt?.verification === 'native-rgbd-verified' ? 'Capture verified' : 'Capture downloaded'}</strong>
      <p>{notice.message}</p>
      {notice.receipt && !busy && <div className="native-capture-next">{notice.receipt.verification==='native-rgbd-verified'&&!!notice.receipt.audioChunks?<>{canScore&&<label>Use capture for <select value={purpose} disabled={processing} onChange={e=>{setPurpose(e.target.value as 'calibration'|'outcome');setConfirmed(false)}}><option value="calibration">New model fit (ah vowel)</option><option value="outcome">Score frozen {selected!.pose} prediction</option></select></label>}<p>{later?'Test the frozen prediction':'Fit a vocal-tract hypothesis'} using this capture. No sound is played.</p><label><input type="checkbox" checked={confirmed} disabled={processing} onChange={e=>setConfirmed(e.target.checked)}/> I recorded a comfortable sustained {vowel==='a'?'a (ah)':vowel} vowel, with no played probe or external sound.</label><button disabled={!confirmed||processing||science.status==='loading'||science.status==='unavailable'} onClick={()=>{window.dispatchEvent(new CustomEvent('singing:process-capture',{detail:{purpose:later?'outcome':'calibration',pose:vowel}}));setNotice(null);setConfirmed(false)}}>{later?'Score and update model':'Fit and show model changes'}</button></>:<p>This capture is not verified ordinary voice input. Use Experiments to inspect it.</p>}<button onClick={()=>{window.dispatchEvent(new Event('singing:show-science'));setNotice(null)}}>Review in Experiments</button></div>}
      {notice.receipt && <small>{notice.receipt.name}<br/>{(notice.receipt.bytes / (1024 * 1024)).toFixed(1)} MB · private on this Mac{notice.receipt.reused ? ' · reused local copy' : ''}</small>}
    </div>}
  </div>;
}
