import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createPhonePeer, phoneRequest } from '../../lib/phonePeer';
import type { PhoneSession } from '../../lib/phonePeer';
import './PhoneCapture.css';

type Props = { open: boolean; onClose: () => void; onMicrophoneStream: (stream: MediaStream | null) => void };
export default function PhonePairing({ open, onClose, onMicrophoneStream }: Props) {
  const [session, setSession] = useState<PhoneSession | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [setup,setSetup]=useState<{url:string;qr:string;fingerprint:string}|null>(null);
  useEffect(()=>{if(!open)return;let cancelled=false;void fetch('/api/status').then(r=>r.json()).then(async data=>{if(data.phoneBaseUrl&&!cancelled)setBaseUrl(data.phoneBaseUrl);if(data.phoneSetupUrl){const qr=await QRCode.toDataURL(data.phoneSetupUrl,{width:220,margin:3});if(!cancelled)setSetup({url:data.phoneSetupUrl,qr,fingerprint:data.certificateFingerprint})}}).catch(()=>{});return()=>{cancelled=true}},[open]);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState('');
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const callback = useRef(onMicrophoneStream);
  useEffect(() => { callback.current = onMicrophoneStream; }, [onMicrophoneStream]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const peer = createPhonePeer(session, 'desktop', stream => callback.current(stream), setStatus);
    const poll = async () => {
      try {
        const summary = await phoneRequest<{ snapshots?: unknown[]; snapshotCount?: number }>(session);
        if (!cancelled) setCount(summary.snapshotCount ?? summary.snapshots?.length ?? 0);
      } catch (error) { if (!cancelled) setStatus(String(error)); }
    };
    const timer = setInterval(() => void poll(), 2500);
    void poll();
    return () => { cancelled = true; clearInterval(timer); peer.close(); };
  }, [session]);
  const pair = async () => {
    setBusy(true); setStatus('Creating private pairing link…');
    try {
      const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl.trim() || undefined }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? 'Pairing service is unavailable.');
      setSession(next);
      setQr(next.secure ? await QRCode.toDataURL(next.pairUrl, { width: 280, margin: 3, errorCorrectionLevel: 'M' }) : '');
      setStatus(next.secure ? 'Scan with your phone on the same network.' : next.connectionHint ?? 'Configure a trusted HTTPS address reachable from your phone.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create pairing link.'); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  return <div className="phone-modal-backdrop" onClick={onClose}><section className="phone-pair-dialog" role="dialog" aria-modal="true" aria-label="Connect your phone" onClick={event => event.stopPropagation()}>
    <div className="phone-title"><h2>Connect your phone</h2><button onClick={onClose} aria-label="Close phone pairing">×</button></div>
    <p>Capture a guided set of face and mouth views, or use your phone as a live microphone.</p>
    {setup && <details open className="phone-certificate-setup"><summary>1. First-time iPhone setup</summary><p>Scan this QR to install your computer’s local certificate. Follow the Settings steps on that page, then return here for the pairing QR below.</p><img width="180" height="180" src={setup.qr} alt="Scan for private HTTPS certificate setup"/><p><a href={setup.url} target="_blank" rel="noreferrer">Open setup instructions</a></p><small>Certificate SHA-256: {setup.fingerprint}</small></details>}
    {setup && <h3>2. Pair your phone</h3>}
    <label>Phone-accessible HTTPS address<input type="url" placeholder="https://your-local-host:5173" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
    <small>Leave empty to use the server’s configured address. A trusted HTTPS connection on your local network works; a public server is optional. Localhost on your phone points to the phone itself.</small>
    <button disabled={busy} onClick={() => void pair()}>{busy ? 'Preparing…' : session ? 'Create new pairing link' : 'Show pairing QR'}</button>
    {qr && session && <div className="phone-qr"><img src={qr} alt="Scan to connect your phone to this session" /><a href={session.pairUrl} target="_blank" rel="noreferrer">Open capture page</a><small>This private link grants access to this capture session. Share it only with your own phone.</small></div>}
    <p role="status">{status}</p>
    {session && <p>{count} bootstrap snapshots received. <button onClick={() => { setSession(null); setQr(''); setStatus('Phone disconnected.'); }}>Disconnect phone</button></p>}
    <small>Closing this window keeps a connected microphone active. Snapshots are saved only when you tap Capture. Live microphone mode does not record audio.</small>
  </section></div>;
}
