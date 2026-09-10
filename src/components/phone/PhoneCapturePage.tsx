import { useEffect, useRef, useState } from 'react';
import CameraPanel from '../CameraPanel';
import type { TrackingFrame, TrackingStatus } from '../../types';
import { createPhonePeer, phoneRequest } from '../../lib/phonePeer';
import type { PhoneSession } from '../../lib/phonePeer';
import './PhoneCapture.css';

const steps = [
  { id: 'front', title: 'Face forward', instruction: 'Hold your phone at eye level. Keep your head and shoulders visible, relax your jaw and look straight ahead.' },
  { id: 'profile-left', title: 'Turn gently to one side', instruction: 'Slowly turn your head about 45 degrees. Keep your face in the frame so your cheek and jawline stay visible.' },
  { id: 'profile-right', title: 'Turn to the other side', instruction: 'Turn about 45 degrees the other way. Keep the phone still and let the tracking overlay settle.' },
  { id: 'mouth', title: 'Show the inside of your mouth', instruction: 'Face forward, move a little closer and comfortably open your mouth. Use bright light from in front of you. Do not strain.' },
  { id: 'tongue', title: 'Show your tongue', instruction: 'With your mouth open, gently extend your tongue. Keep the tip visible. The pink outline shows the visible tongue estimate.' },
];

export default function PhoneCapturePage() {
  const [session] = useState<PhoneSession>(() => {
    const query = new URLSearchParams(location.search);
    return { sessionId: query.get('session') ?? query.get('sessionId') ?? '', token: query.get('token') ?? '', pairUrl: location.href, secure: window.isSecureContext };
  });
  const [mode, setMode] = useState<'capture' | 'mic'>('capture');
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<{ imageDataUrl: string; capturedAt: string; width: number; height: number; frame: TrackingFrame | null } | null>(null);
  const [status, setStatus] = useState('Ready when you are.');
  const [tracking, setTracking] = useState<TrackingStatus>('idle');
  const [saving, setSaving] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const camera = useRef<HTMLDivElement>(null);
  const frame = useRef<TrackingFrame | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const peer = useRef<ReturnType<typeof createPhonePeer> | null>(null);
  const micGeneration = useRef(0);
  const step = steps[index];
  const valid = Boolean(session.sessionId && session.token);
  const secure = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  const stopMic = () => {
    micGeneration.current += 1;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    peer.current?.close(); peer.current = null;
    setMicActive(false);
  };
  useEffect(() => () => {
    micGeneration.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
    peer.current?.close();
  }, []);
  const startMic = async () => {
    const generation = ++micGeneration.current;
    setStatus('Allow microphone access…');
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (generation !== micGeneration.current) { next.getTracks().forEach(track => track.stop()); return; }
      stream.current = next;
      peer.current = createPhonePeer(session, 'phone', () => {}, setStatus);
      await peer.current.sendMicrophone(next);
      if (generation === micGeneration.current) setMicActive(true);
    } catch (error) { stopMic(); setStatus(error instanceof Error ? error.message : 'Microphone could not start.'); }
  };
  const capture = () => {
    const video = camera.current?.querySelector('video');
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPreview({ imageDataUrl: canvas.toDataURL('image/jpeg', .88), capturedAt: new Date().toISOString(), width: canvas.width, height: canvas.height, frame: frame.current });
    setStatus('Check your snapshot, then use it or retake.');
  };
  const save = async () => {
    if (!preview || !step) return;
    setSaving(true);
    try {
      await phoneRequest(session, '/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        stepId: step.id, capturedAt: preview.capturedAt, imageDataUrl: preview.imageDataUrl, width: preview.width, height: preview.height,
        landmarks: { face: preview.frame?.face ?? [], pose: preview.frame?.pose ?? [], tongue: preview.frame?.tongue ?? null, timestamp: preview.frame?.timestamp ?? null },
        evidence: { kind: 'browser-rgb-bootstrap', depth: 'not-captured', internalMusculature: 'not-measured', mirrored: false },
      }) });
      setPreview(null); setIndex(index + 1); setStatus('Snapshot sent to your desktop.');
      if (index === steps.length - 1) setActive(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Upload failed. Keep this page open and retry.'); }
    finally { setSaving(false); }
  };
  return <main className="phone-page"><header><span>SINGING TEACHER</span><h1>Your phone, connected</h1></header>
    {!valid ? <p role="alert">Open the private link from the desktop app’s QR code to pair this phone.</p> : !secure ? <p role="alert">Your phone needs a trusted HTTPS address for camera and microphone access. Open the secure pairing link configured on your desktop.</p> : <>
      <nav aria-label="Phone mode"><button aria-pressed={mode === 'capture'} onClick={() => { stopMic(); setMode('capture'); setStatus('Ready for guided snapshots.'); }}>Bootstrap captures</button><button aria-pressed={mode === 'mic'} onClick={() => { setActive(false); setMode('mic'); setStatus('Use your phone as the live microphone for the desktop.'); }}>Phone microphone</button></nav>
      {mode === 'capture' ? <>
        {step ? <><div className="phone-step-heading"><small>STEP {index + 1} OF {steps.length}</small><h2>{step.title}</h2><p>{step.instruction}</p></div>
          <video className="phone-instruction-video" src={`/phone-guides/${step.id}.mp4`} autoPlay muted playsInline loop aria-label={`Animated demonstration: ${step.title}`} />
          <div className="phone-camera" ref={camera}><CameraPanel active={active} onFrame={next => { frame.current = next; }} onStatus={(next, message) => { setTracking(next); if (message) setStatus(message); }} /></div>
          {preview && <img className="phone-snapshot" src={preview.imageDataUrl} alt="Your snapshot for review" />}
          <div className="phone-actions">{!active ? <button onClick={() => { setActive(true); setStatus('Starting camera and computer vision…'); }}>Start camera</button> : preview ? <><button disabled={saving} onClick={() => setPreview(null)}>Retake</button><button disabled={saving} onClick={() => void save()}>{saving ? 'Sending…' : 'Use snapshot & continue'}</button></> : <><button disabled={tracking !== 'tracking' && tracking !== 'no-face'} onClick={capture}>Capture snapshot</button><button onClick={() => setActive(false)}>Stop camera</button></>}</div>
          {active && tracking === 'no-face' && <small>The tracker cannot see a complete face. You can still capture the visible mouth or side view.</small>}
        </> : <section><h2>Bootstrap captures complete</h2><p>Your five views are on the desktop. You can switch to phone microphone or repeat the capture sequence.</p><button onClick={() => { setIndex(0); setStatus('Ready for a new sequence.'); }}>Capture another sequence</button></section>}
        <small>Live overlay: MediaPipe face/pose landmarks + OpenCV image analysis. These snapshots describe visible surfaces; they do not measure internal muscles or hardware depth.</small>
      </> : <section className="phone-microphone"><div aria-hidden="true">♫</div><h2>{micActive ? 'Your microphone is on' : 'Use your phone microphone'}</h2><p>Put your phone nearby, keep this page open and sing. Your voice goes directly to the desktop over the local connection.</p><button onClick={() => micActive ? (stopMic(), setStatus('Microphone stopped.')) : void startMic()}>{micActive ? 'Stop microphone' : 'Start microphone'}</button><small>This mode streams audio. It does not start a recording.</small></section>}
    </>}
    <p className="phone-status" role="status">{status}</p>
  </main>;
}
