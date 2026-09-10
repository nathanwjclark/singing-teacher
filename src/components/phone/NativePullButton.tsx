import { useEffect, useRef, useState } from 'react';
import { Cable, X } from 'lucide-react';
import './NativePullButton.css';

type Receipt = { name: string; bytes: number; receivedAt: string; reused: boolean; verification: string; message: string; frames?: number; audioChunks?: number };
export function NativePullButton() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; receipt?: Receipt; error?: boolean } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function pull() {
    if (busy) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 210_000);
    setBusy(true); setNotice({ message: 'Reading the latest saved capture. Keep the iPhone connected and unlocked…' });
    try {
      const response = await fetch('/api/native-captures/pull', { method: 'POST', signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.receipt) throw new Error(result.error || 'The iPhone pull could not finish.');
      setNotice({ message: result.receipt.message, receipt: result.receipt });
    } catch (error) {
      setNotice({ error: true, message: controller.signal.aborted ? 'The pull took too long. Keep the iPhone unlocked; click again to check or retry.' : error instanceof Error ? error.message : 'The iPhone pull failed.' });
    } finally { window.clearTimeout(timeout); request.current = null; setBusy(false); }
  }
  return <div className="native-pull">
    <button className="native-pull-button" type="button" onClick={() => void pull()} disabled={busy} title="Copy the latest saved native capture over USB. Keep the iPhone unlocked.">
      <Cable size={14} aria-hidden="true"/><span>{busy ? 'Pulling…' : 'Pull iPhone'}</span>
    </button>
    {notice && <div className={`native-pull-notice${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
      <button className="native-pull-dismiss" type="button" aria-label="Dismiss import status" onClick={() => setNotice(null)}><X size={14}/></button>
      <strong>{busy ? 'USB import' : notice.error ? 'iPhone needs attention' : notice.receipt?.verification === 'native-rgbd-verified' ? 'Capture verified' : 'Capture downloaded'}</strong>
      <p>{notice.message}</p>
      {notice.receipt && <small>{notice.receipt.name}<br/>{(notice.receipt.bytes / (1024 * 1024)).toFixed(1)} MB · private on this Mac{notice.receipt.reused ? ' · reused local copy' : ''}</small>}
    </div>}
  </div>;
}
