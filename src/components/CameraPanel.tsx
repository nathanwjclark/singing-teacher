import { useEffect, useRef, useState } from 'react';
import { Camera, ScanFace, ShieldCheck } from 'lucide-react';
import { createVisionEngine, drawTracking } from '../lib/vision';
import type { VisionEngine } from '../lib/vision';
import type { TrackingFrame, TrackingStatus } from '../types';
import './CameraPanel.css';
import TongueLab from './TongueLab';
import { tongueCapabilityLabel } from '../lib/tongueTracking';

type Props = { active: boolean; onFrame: (frame: TrackingFrame) => void; onStatus: (status: TrackingStatus, message?: string) => void; onStream?: (stream: MediaStream | null) => void };

export default function CameraPanel({ active, onFrame, onStatus, onStream }: Props) {
  const [labOpen,setLabOpen]=useState(false);
  const latestFrame=useRef<TrackingFrame|undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VisionEngine | undefined>(undefined);
  const callbacks = useRef({ onFrame, onStatus, onStream });
  useEffect(() => { callbacks.current = { onFrame, onStatus, onStream }; }, [onFrame, onStatus, onStream]);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [message, setMessage] = useState('');
  const [depth, setDepth] = useState<{ distance?: number; relative?: number; points: number }>({ points: 0 });
  const [tongueStatus, setTongueStatus] = useState('Searching for visible tongue');
  const [tongueCapability, setTongueCapability] = useState<'region' | 'tip'>();
  const [calibration, setCalibration] = useState('');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let engine: VisionEngine | undefined;
    let animation = 0;
    let lastTime = -1;
    let lastTick = 0;
    let currentStatus: TrackingStatus = 'idle';
    let modelTimeout = 0;
    let expired = false;
    const video = videoRef.current!;
    const update = (next: TrackingStatus, detail = '') => {
      if (cancelled) return;
      currentStatus = next;
      setStatus(next); setMessage(detail);
      callbacks.current.onStatus(next, detail);
    };
    const release = () => {
      latestFrame.current=undefined;
      cancelAnimationFrame(animation);
      clearTimeout(modelTimeout);
      stream?.getTracks().forEach(track => track.stop());
      callbacks.current.onStream?.(null);
      if (video.srcObject === stream) video.srcObject = null;
      if (engineRef.current === engine) engineRef.current = undefined;
      engine?.close(); engine = undefined;
    };
    if (!active) {
      update('idle');
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return () => { cancelled = true; };
    }
    update('loading', 'Allow camera access to begin.');
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }, audio: false });
        if (cancelled) { release(); return; }
        setDepth({ points: 0 }); setCalibration('');
        video.srcObject = stream;
        callbacks.current.onStream?.(stream);
        await video.play();
        if (cancelled) { release(); return; }
        update('loading', 'Loading face and posture models. The tongue model loads separately.');
        modelTimeout = window.setTimeout(() => {
          expired = true; release();
          update('error', 'Tracking models took too long to load. Check your connection, then stop and restart the session.');
        }, 60000);
        engine = await createVisionEngine();
        clearTimeout(modelTimeout);
        if (cancelled || expired) { release(); return; }
        engineRef.current = engine;
        stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!cancelled) { release(); update('error', 'The camera was disconnected. Stop the session and start again.'); } }, { once: true });
        const tick = (time: number) => {
          if (cancelled || !engine) return;
          try {
            if (video.readyState >= 2 && video.currentTime !== lastTime && time - lastTick >= 90) {
              lastTime = video.currentTime; lastTick = time;
              const frame = engine.process(video, time);
              latestFrame.current=frame;
              setTongueStatus(frame.tongueStatus ?? 'Searching for visible tongue'); setTongueCapability(frame.tongueDiagnostic?.capability);
              setDepth({ distance: frame.metrics.distanceCm, relative: frame.metrics.relativeDepth, points: frame.face.length + frame.pose.filter(point => (point.visibility ?? 0) >= .5).length });
              const canvas = canvasRef.current;
              if (canvas) {
                if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
                if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
                const context = canvas.getContext('2d');
                if (context) drawTracking(context, frame, canvas.width, canvas.height);
              }
              const next = frame.face.length ? 'tracking' : 'no-face';
              if (currentStatus !== next) update(next);
              callbacks.current.onFrame(frame);
            }
            animation = requestAnimationFrame(tick);
          } catch (error) { release(); update('error', error instanceof Error ? error.message : 'Camera tracking stopped. Please try again.'); }
        };
        animation = requestAnimationFrame(tick);
      } catch (error) {
        release();
        const name = error instanceof Error ? error.name : '';
        const detail = name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser, then stop and restart the session.'
          : name === 'NotFoundError' ? 'No webcam was found. Connect a camera, then stop and restart the session.'
          : name === 'NotReadableError' ? 'Your camera is busy. Close other apps using it, then stop and restart the session.'
          : error instanceof Error ? error.message : 'Unable to start your camera. Please try again.';
        update('error', detail);
      }
    };
    void start();
    return () => { cancelled = true; release(); };
  }, [active]);

  const calibrate = () => {
    setCalibration(engineRef.current?.calibrate() ? 'Baseline set. Relative depth follows movement from this position.' : 'Face forward with both eyes visible and hold still briefly, then try again.');
  };

  return <div className="camera-panel">
    {labOpen&&<TongueLab video={videoRef} frame={latestFrame} close={()=>setLabOpen(false)}/>}
    <div className="camera-stage">
      <video ref={videoRef} autoPlay muted playsInline aria-label="Your mirrored live webcam" className={active && status !== 'error' ? 'camera-video visible' : 'camera-video'} />
      <canvas ref={canvasRef} className="camera-landmarks" aria-hidden="true" />
      <div className="camera-corner top-left" /><div className="camera-corner top-right" /><div className="camera-corner bottom-left" /><div className="camera-corner bottom-right" />
      {(status === 'idle' || status === 'error' || status === 'loading') && <div className={`camera-overlay ${status}`}>
        <div className="camera-icon">{status === 'loading' ? <ScanFace size={32} /> : <Camera size={32} />}</div>
        <h3>{status === 'idle' ? 'Your practice space' : status === 'loading' ? 'Getting ready' : 'Camera unavailable'}</h3>
        <p>{status === 'idle' ? 'Start your session and position your face and shoulders inside the frame.' : message}</p>
        {status === 'idle' && <span className="camera-private"><ShieldCheck size={14} /> Video stays on your device</span>}
      </div>}
      {status === 'no-face' && <div className="camera-no-face"><ScanFace size={18} /> Bring your face into the frame</div>}
      {status === 'tracking' && <div className="camera-tongue-status">{tongueStatus}<small>{tongueCapabilityLabel(tongueCapability)}</small>{tongueCapability === 'tip' && <button type="button" onClick={event=>{event.stopPropagation();engineRef.current?.calibrateTongue()}} title="Hold your tongue centered, then set this as its neutral position">Recenter tongue</button>}</div>}
      <div className="camera-stage-label"><span className={status === 'tracking' ? 'camera-light live' : 'camera-light'} /> {status === 'tracking' ? 'LIVE CAMERA' : 'CAMERA VIEW'}<span>MIRRORED</span></div>
    </div>
    <div className="camera-depth">
      <button type="button" onClick={()=>setLabOpen(true)}>Tongue lab · inspect & capture</button>
      <div className="camera-depth-values"><span><small>CAMERA DISTANCE</small><strong>{status === 'tracking' && depth.distance !== undefined ? `~${Math.round(depth.distance / 5) * 5} cm` : '—'}</strong></span><span><small>FROM BASELINE</small><strong>{status === 'tracking' && depth.relative !== undefined ? `${Math.abs(Math.round((depth.relative - 1) * 100))}% ${depth.relative >= 1 ? 'farther' : 'closer'}` : 'Not calibrated'}</strong></span></div>
      <div className="camera-depth-action"><span>{status === 'tracking' ? `${depth.points} visible landmarks` : '478 face + 33 body landmarks'}</span><button type="button" onClick={calibrate} disabled={status !== 'tracking' || depth.distance === undefined}>{status !== 'tracking' || depth.relative === undefined ? 'Set depth baseline' : 'Reset baseline'}</button></div>
      {active && calibration && <p className="camera-calibration-message" role="status">{calibration}</p>}
      <details><summary>Approximate depth · how it works</summary><p>Camera distance assumes an 11.7 mm iris and a 60° camera field of view. Lenses, glasses, and head angle can change the result substantially. Face forward with eyes open. Set a baseline while still; relative movement is more useful than the centimeter estimate. Keep camera zoom unchanged.</p><p>Face mesh depth is relative to the face, in normalized image units. Pose world depth is an estimate in meters relative to your hips. Neither measures internal anatomy or camera distance.</p><a href="https://chuoling.github.io/mediapipe/solutions/iris.html" target="_blank" rel="noreferrer">MediaPipe iris method</a></details>
    </div>
    <div className="camera-caption"><span>01 / OBSERVE</span><span>Face + shoulders in view</span></div>
  </div>;
}
