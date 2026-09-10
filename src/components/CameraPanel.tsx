import { useEffect, useRef, useState } from 'react';
import { Camera, ScanFace, ShieldCheck } from 'lucide-react';
import { createVisionEngine, drawTracking } from '../lib/vision';
import type { VisionEngine } from '../lib/vision';
import type { TrackingFrame, TrackingStatus } from '../types';
import './CameraPanel.css';

type Props = { active: boolean; onFrame: (frame: TrackingFrame) => void; onStatus: (status: TrackingStatus, message?: string) => void };

export default function CameraPanel({ active, onFrame, onStatus }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onFrame, onStatus });
  useEffect(() => { callbacks.current = { onFrame, onStatus }; }, [onFrame, onStatus]);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let engine: VisionEngine | undefined;
    let animation = 0;
    let lastTime = -1;
    let lastTick = 0;
    let currentStatus: TrackingStatus = 'idle';
    const video = videoRef.current!;
    const update = (next: TrackingStatus, detail = '') => {
      if (cancelled) return;
      currentStatus = next;
      setStatus(next); setMessage(detail);
      callbacks.current.onStatus(next, detail);
    };
    const release = () => {
      cancelAnimationFrame(animation);
      stream?.getTracks().forEach(track => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
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
        video.srcObject = stream;
        await video.play();
        if (cancelled) { release(); return; }
        update('loading', 'Loading face, posture, and OpenCV models. First start may take a moment.');
        engine = await createVisionEngine();
        if (cancelled) { release(); return; }
        stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!cancelled) { release(); update('error', 'The camera was disconnected. Stop the session and start again.'); } }, { once: true });
        const tick = (time: number) => {
          if (cancelled || !engine) return;
          try {
            if (video.readyState >= 2 && video.currentTime !== lastTime && time - lastTick >= 90) {
              lastTime = video.currentTime; lastTick = time;
              const frame = engine.process(video, time);
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

  return <div className="camera-panel">
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
      <div className="camera-stage-label"><span className={status === 'tracking' ? 'camera-light live' : 'camera-light'} /> {status === 'tracking' ? 'LIVE CAMERA' : 'CAMERA VIEW'}<span>MIRRORED</span></div>
    </div>
    <div className="camera-caption"><span>01 / OBSERVE</span><span>Face + shoulders in view</span></div>
  </div>;
}
