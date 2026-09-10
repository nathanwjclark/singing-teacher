import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, AudioLines } from 'lucide-react';
import { analyzeAudio } from '../lib/audio';
import type { AudioMetrics } from '../lib/audio';
import './AudioPanel.css';

type AudioPanelProps = { demo?: boolean };
type AudioStatus = 'idle' | 'requesting' | 'live' | 'error';
type Point = AudioMetrics & { time: number };
type Resources = { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode };
const WINDOW_SECONDS = 25;
const EMPTY: AudioMetrics = { dbfs: -100, centroidHz: null, flatness: null };

function surface(canvas: HTMLCanvasElement | null) {
  if (!canvas) return null;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(bounds.width * dpr);
  const height = Math.round(bounds.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, bounds.width, bounds.height);
  return { ctx, width: bounds.width, height: bounds.height };
}

function drawHistory(canvas: HTMLCanvasElement | null, history: Point[], now: number, field: keyof AudioMetrics, min: number, max: number, color: string) {
  const view = surface(canvas);
  if (!view) return;
  const { ctx, width, height } = view;
  ctx.strokeStyle = '#ffffff0b';
  ctx.lineWidth = 1;
  for (let line = 0; line <= 4; line++) {
    const x = 1 + (width - 2) * line / 4;
    ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x, height - 1); ctx.stroke();
  }
  for (let line = 0; line <= 2; line++) {
    const y = 1 + (height - 2) * line / 2;
    ctx.beginPath(); ctx.moveTo(1, y); ctx.lineTo(width - 1, y); ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let connected = false;
  let previousTime = 0;
  for (const point of history) {
    const x = (1 - (now - point.time) / WINDOW_SECONDS) * width;
    const value = point[field];
    if (x < 0 || value === null) { connected = false; continue; }
    const y = 2 + (1 - Math.max(0, Math.min(1, (value - min) / (max - min)))) * (height - 4);
    if (connected && point.time - previousTime < 0.4) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    connected = true;
    previousTime = point.time;
  }
  ctx.stroke();
}

function drawWave(canvas: HTMLCanvasElement | null, wave: Float32Array, active: boolean) {
  const view = surface(canvas);
  if (!view) return;
  const { ctx, width, height } = view;
  ctx.strokeStyle = '#ffffff0d'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = height * i / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  let peak = 0.025;
  for (const sample of wave) peak = Math.max(peak, Math.abs(sample));
  ctx.strokeStyle = active ? '#9bd5c2' : '#4f625a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = i / (wave.length - 1) * width;
    const y = height / 2 - (active ? wave[i] / peak : 0) * height * 0.43;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function AudioPanel({ demo = false }: AudioPanelProps) {
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<AudioMetrics>(EMPTY);
  const [windowMs, setWindowMs] = useState(43);
  const resources = useRef<Resources | null>(null);
  const pendingContext = useRef<AudioContext | null>(null);
  const requestId = useRef(0);
  const history = useRef<Point[]>([]);
  const waveform = useRef(new Float32Array(2048));
  const waveCanvas = useRef<HTMLCanvasElement>(null);
  const volumeCanvas = useRef<HTMLCanvasElement>(null);
  const brightnessCanvas = useRef<HTMLCanvasElement>(null);
  const textureCanvas = useRef<HTMLCanvasElement>(null);

  const release = useCallback(() => {
    requestId.current++;
    const pending = pendingContext.current;
    pendingContext.current = null;
    if (pending && pending.state !== 'closed') void pending.close().catch(() => {});
    const current = resources.current;
    resources.current = null;
    if (current) {
      current.stream.getTracks().forEach(track => track.stop());
      current.source.disconnect();
      current.analyser.disconnect();
      void current.context.close().catch(() => {});
    }
  }, []);

  const stop = useCallback(() => {
    release();
    waveform.current.fill(0);
    setStatus('idle');
    setMetrics(EMPTY);
  }, [release]);

  const start = async () => {
    if (demo || resources.current || pendingContext.current) return;
    const id = ++requestId.current;
    setError('');
    setStatus('requesting');
    let acquiredStream: MediaStream | null = null;
    let acquiredContext: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost in a supported browser.');
      // Resume inside the click gesture so Safari can activate the audio context.
      acquiredContext = new AudioContext();
      pendingContext.current = acquiredContext;
      await acquiredContext.resume();
      if (id !== requestId.current) { void acquiredContext.close().catch(() => {}); return; }
      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (id !== requestId.current) {
        acquiredStream.getTracks().forEach(track => track.stop());
        void acquiredContext.close().catch(() => {});
        return;
      }
      const analyser = acquiredContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.15;
      const source = acquiredContext.createMediaStreamSource(acquiredStream);
      source.connect(analyser); // Deliberately never connect to the audio destination.
      resources.current = { stream: acquiredStream, context: acquiredContext, source, analyser };
      pendingContext.current = null;
      acquiredStream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (id === requestId.current) {
          stop();
          setError('The microphone disconnected. Choose Start microphone to reconnect.');
          setStatus('error');
        }
      }));
      history.current = [];
      setWindowMs(Math.round(analyser.fftSize / acquiredContext.sampleRate * 1000));
      setStatus('live');
    } catch (cause) {
      acquiredStream?.getTracks().forEach(track => track.stop());
      if (acquiredContext && acquiredContext.state !== 'closed') void acquiredContext.close().catch(() => {});
      if (pendingContext.current === acquiredContext) pendingContext.current = null;
      if (id !== requestId.current) return;
      const name = cause instanceof Error ? cause.name : '';
      setError(name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser and try again.' : name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : name === 'NotReadableError' ? 'Your microphone is unavailable or in use. Check your device and try again.' : cause instanceof Error ? cause.message : 'Could not start your microphone. Please try again.');
      setStatus('error');
    }
  };

  useEffect(() => {
    release();
    history.current = [];
    waveform.current.fill(0);
    let resetDisplay = true;
    const spectrum = new Float32Array(1024);
    let animation = 0;
    let lastSample = 0;
    let lastDraw = 0;
    let lastDisplay = 0;
    let latest: AudioMetrics = EMPTY;
    const started = performance.now() / 1000;

    const render = (ms: number) => {
      if (resetDisplay) {
        setStatus('idle');
        setError('');
        setMetrics(EMPTY);
        setWindowMs(43);
        resetDisplay = false;
      }
      const now = ms / 1000;
      const live = resources.current;
      if (now - lastDraw > 1 / 30) {
        lastDraw = now;
        if (demo) {
          const t = now - started;
          const envelope = Math.pow(Math.max(0, Math.sin(t * 0.85)), 0.5);
          const fundamental = 185 + 20 * Math.sin(t * 0.7);
          for (let i = 0; i < waveform.current.length; i++) {
            const phase = (t + i / 48000) * fundamental * Math.PI * 2;
            waveform.current[i] = envelope * (0.16 * Math.sin(phase) + 0.04 * Math.sin(phase * 2) + 0.015 * Math.sin(phase * 3));
          }
          latest = { dbfs: envelope > 0.005 ? -22 + 20 * Math.log10(envelope) : -100, centroidHz: envelope > 0.05 ? 1800 + 900 * Math.sin(t * 0.45) : null, flatness: envelope > 0.05 ? 0.09 + 0.05 * Math.sin(t * 0.62) : null };
        } else if (live && live.context.state === 'running') {
          live.analyser.getFloatTimeDomainData(waveform.current);
          live.analyser.getFloatFrequencyData(spectrum);
          latest = analyzeAudio(waveform.current, spectrum, live.context.sampleRate, live.analyser.fftSize);
        } else {
          waveform.current.fill(0);
          latest = EMPTY;
        }
        if ((demo || live) && now - lastSample >= 0.1) {
          lastSample = now;
          history.current.push({ ...latest, time: now });
        }
        history.current = history.current.filter(point => now - point.time <= WINDOW_SECONDS);
        drawWave(waveCanvas.current, waveform.current, demo || !!live);
        drawHistory(volumeCanvas.current, history.current, now, 'dbfs', -70, 0, '#a3d8c3');
        drawHistory(brightnessCanvas.current, history.current, now, 'centroidHz', 0, 10000, '#eeb08f');
        drawHistory(textureCanvas.current, history.current, now, 'flatness', 0, 1, '#c7bbec');
        if (now - lastDisplay > 0.2) { setMetrics(latest); lastDisplay = now; }
      }
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(animation); release(); };
  }, [demo, release]);

  const active = demo || status === 'live';
  const signal = active && metrics.dbfs >= -60;
  const readout = (value: number | null, digits = 0) => active && value !== null ? value.toFixed(digits) : '—';
  return (
    <section className="audio-panel" aria-labelledby="audio-title">
      <header className="audio-header">
        <div className="audio-title-wrap">
          <div className="audio-icon"><AudioLines size={21} aria-hidden="true" /></div>
          <div><p className="audio-eyebrow">04 / LISTEN TO THE SHAPE</p><h2 id="audio-title">Your voice, over time.</h2></div>
        </div>
        <div className="audio-actions">
          <span className={`audio-status ${active ? 'audio-status--active' : ''}`}><i />{demo ? 'SYNTHETIC DEMO' : status === 'requesting' ? 'AWAITING PERMISSION' : status === 'live' ? signal ? 'MICROPHONE LIVE' : 'LISTENING · QUIET' : 'MICROPHONE OFF'}</span>
          {!demo && (status === 'live' || status === 'requesting' ? <button className="audio-control" type="button" onClick={stop}><Square size={13} />{status === 'requesting' ? 'Cancel' : 'Stop microphone'}</button> : <button className="audio-control" type="button" onClick={() => void start()}><Mic size={14} />Start microphone</button>)}
        </div>
      </header>
      {error && <p className="audio-error" role="alert">{error}</p>}
      <div className="audio-plots">
        <article className="audio-wave-card">
          <div className="audio-chart-title"><h3>Waveform</h3><span>{active ? 'LIVE SNAPSHOT' : 'READY WHEN YOU ARE'}</span></div>
          <div className="audio-wave-surface"><canvas ref={waveCanvas} role="img" aria-label="Current microphone waveform. Display amplitude is automatically scaled." />{!active && <span className="audio-wave-placeholder">A little space to hear yourself.</span>}</div>
          <div className="audio-axis"><span>0 ms</span><span>{windowMs} ms · auto-scale</span></div>
          <p className="audio-chart-caption">{demo ? 'Illustrative wave and histories. No microphone access.' : 'The actual sound wave from your microphone.'}</p>
        </article>
        <div className="audio-histories">
          <article className="audio-history-card audio-history-card--volume">
            <div className="audio-chart-title"><h3><i />Loudness <span>RMS</span></h3><strong>{active ? metrics.dbfs < -70 ? '< −70' : metrics.dbfs.toFixed(1) : '—'} <small>dBFS</small></strong></div>
            <div className="audio-history-surface"><div className="audio-y-axis"><span>0</span><span>−70</span></div><canvas ref={volumeCanvas} role="img" aria-label="Trailing 25 seconds of RMS loudness, from minus 70 to zero dBFS." /></div>
            <div className="audio-axis audio-time-axis"><span>−25 s</span><span>now</span></div>
          </article>
          <article className="audio-history-card audio-history-card--brightness">
            <div className="audio-chart-title"><h3><i />Brightness <span>CENTROID</span></h3><strong>{readout(metrics.centroidHz)} <small>Hz</small></strong></div>
            <div className="audio-history-surface"><div className="audio-y-axis"><span>10k</span><span>0</span></div><canvas ref={brightnessCanvas} role="img" aria-label="Trailing 25 seconds of spectral centroid, from zero to 10000 Hz. Gaps indicate quiet input." /></div>
            <div className="audio-axis audio-time-axis"><span>−25 s</span><span>now</span></div>
          </article>
          <article className="audio-history-card audio-history-card--texture">
            <div className="audio-chart-title"><h3><i />Texture <span>FLATNESS</span></h3><strong>{readout(metrics.flatness, 2)} <small>0–1</small></strong></div>
            <div className="audio-history-surface"><div className="audio-y-axis"><span>1</span><span>0</span></div><canvas ref={textureCanvas} role="img" aria-label="Trailing 25 seconds of spectral flatness, from zero, more tonal, to one, more noise-like." /></div>
            <div className="audio-axis audio-time-axis"><span>−25 s</span><span>now</span></div>
          </article>
        </div>
      </div>
      <footer className="audio-footer"><p><strong>{demo ? 'DEMO SIGNAL' : 'LOCAL AUDIO ONLY'}</strong>{demo ? 'Synthetic examples, not measurements of your voice.' : 'Processed in your browser. No recording, upload, or speaker playback.'}</p><p>dBFS is a digital level, not calibrated sound pressure. Centroid tracks spectral balance; flatness runs from tonal to noise-like. These describe the captured sound, not a voice type or vocal quality. Spectral traces pause below −60 dBFS.</p></footer>
    </section>
  );
}

export default AudioPanel;
