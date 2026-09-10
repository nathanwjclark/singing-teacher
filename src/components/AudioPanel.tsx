import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, AudioLines } from 'lucide-react';
import { analyzeAudioFrame, serializeAudioMeasurement, pitchToNote, audioFrameSize, pitchStatus } from '../lib/audio';
import type { AudioMetrics } from '../lib/audio';
import { AmbientCalibrator } from '../lib/audioCalibration';
import type { AudioCalibration } from '../lib/audioCalibration';
import type { AudioMeasurement } from '../contracts';
import './AudioPanel.css';

export type AudioPanelProps = { demo?: boolean; autoStart?: boolean; externalStream?: MediaStream | null; onStream?: (stream: MediaStream | null) => void; onMeasurement?: (measurement: AudioMeasurement) => void };
type AudioStatus = 'idle' | 'requesting' | 'live' | 'suspended' | 'error';
type Point = AudioMetrics & { time: number };
type Resources = { owned: boolean; clockId: string; startedMs: number; deviceKey: string; stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode };
const WINDOW_SECONDS = 25;
const EMPTY: AudioMetrics = { dbfs: -100, centroidHz: null, flatness: null, pitchHz: null, periodicity: null };

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
  const levels = field === 'pitchHz' ? [36, 48, 60, 72, 84].map(note => 1 - (note - min) / (max - min)) : [0, 0.5, 1];
  for (const level of levels) {
    const y = 1 + (height - 2) * level;
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
    const raw = point[field];
    const value = raw !== null && field === 'pitchHz' ? 69 + 12 * Math.log2(raw / 440) : raw;
    if (x < 0 || value === null) { connected = false; continue; }
    const y = 2 + (1 - Math.max(0, Math.min(1, (value - min) / (max - min)))) * (height - 4);
    if (connected && point.time - previousTime < 0.4) ctx.lineTo(x, y);
    else { ctx.moveTo(x - 0.7, y); ctx.lineTo(x, y); }
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

export function AudioPanel({ demo = false, autoStart = false, externalStream = null, onStream, onMeasurement }: AudioPanelProps) {
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [error, setError] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [metrics, setMetrics] = useState<AudioMetrics>(EMPTY);
  const [calibration, setCalibration] = useState<AudioCalibration | null>(null);
  const calibrator = useRef(new AmbientCalibrator());
  const callbacks = useRef({ onStream, onMeasurement });
  useEffect(() => { callbacks.current = { onStream, onMeasurement }; }, [onStream, onMeasurement]);
  const [windowMs, setWindowMs] = useState(85);
  const resources = useRef<Resources | null>(null);
  const pendingContext = useRef<AudioContext | null>(null);
  const requestId = useRef(0);
  const history = useRef<Point[]>([]);
  const waveform = useRef(new Float32Array(4096));
  const waveCanvas = useRef<HTMLCanvasElement>(null);
  const volumeCanvas = useRef<HTMLCanvasElement>(null);
  const brightnessCanvas = useRef<HTMLCanvasElement>(null);
  const textureCanvas = useRef<HTMLCanvasElement>(null);
  const pitchCanvas = useRef<HTMLCanvasElement>(null);
  const toneCanvas = useRef<HTMLCanvasElement>(null);

  const release = useCallback(() => {
    requestId.current++;
    const pending = pendingContext.current;
    pendingContext.current = null;
    if (pending && pending.state !== 'closed') void pending.close().catch(() => {});
    const current = resources.current;
    resources.current = null;
    if (current) {
      callbacks.current.onStream?.(null);
      if (current.owned) current.stream.getTracks().forEach(track => track.stop());
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
    setCalibration(null);
  }, [release]);

  const start = useCallback(async () => {
    if (demo || resources.current || pendingContext.current) return;
    const id = ++requestId.current;
    setError('');
    setStatus('requesting');
    let acquiredStream: MediaStream | null = null;
    let acquiredContext: AudioContext | null = null;
    try {
      if (!externalStream && !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost in a supported browser.');
      // Never await resume: autoplay policy can leave its promise pending until a gesture.
      acquiredContext = new AudioContext();
      pendingContext.current = acquiredContext;
      void acquiredContext.resume().catch(() => {});
      acquiredStream = externalStream ?? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (id !== requestId.current) {
        if (!externalStream) acquiredStream.getTracks().forEach(track => track.stop());
        void acquiredContext.close().catch(() => {});
        return;
      }
      const analyser = acquiredContext.createAnalyser();
      analyser.fftSize = audioFrameSize(acquiredContext.sampleRate);
      waveform.current = new Float32Array(analyser.fftSize);
      analyser.smoothingTimeConstant = 0;
      const source = acquiredContext.createMediaStreamSource(acquiredStream);
      source.connect(analyser); // Deliberately never connect to the audio destination.
      resources.current = { owned: !externalStream, clockId: `audio-${crypto.randomUUID()}`, startedMs: performance.now(), deviceKey: JSON.stringify(acquiredStream.getAudioTracks().map(track => [track.id, track.getSettings()])), stream: acquiredStream, context: acquiredContext, source, analyser };
      setInputDescription(`${acquiredStream.getAudioTracks()[0]?.label || (externalStream ? 'Phone microphone' : 'Microphone')} · ${acquiredContext.sampleRate / 1000} kHz`);
      calibrator.current = new AmbientCalibrator();
      setCalibration(null);
      callbacks.current.onStream?.(acquiredStream);
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
      const context = acquiredContext;
      const reflectContextState = () => {
        if (id === requestId.current) setStatus(context.state === 'running' ? 'live' : 'suspended');
      };
      context.addEventListener('statechange', reflectContextState);
      reflectContextState();
      // Granting microphone permission may unlock the context without a separate gesture.
      void context.resume().catch(() => {});
    } catch (cause) {
      if (!externalStream) acquiredStream?.getTracks().forEach(track => track.stop());
      if (acquiredContext && acquiredContext.state !== 'closed') void acquiredContext.close().catch(() => {});
      if (pendingContext.current === acquiredContext) pendingContext.current = null;
      if (id !== requestId.current) return;
      const name = cause instanceof Error ? cause.name : '';
      setError(name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser and try again.' : name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : name === 'NotReadableError' ? 'Your microphone is unavailable or in use. Check your device and try again.' : cause instanceof Error ? cause.message : 'Could not start your microphone. Please try again.');
      setStatus('error');
    }
  }, [demo, externalStream, stop]);

  const enableAudio = () => {
    const current = resources.current;
    if (!current) return;
    setError('');
    // This call remains directly in the click gesture, including on Safari.
    void current.context.resume().catch(() => {
      if (resources.current === current) setError('Your browser paused audio. Try Enable audio again, or stop and restart the microphone.');
    });
  };

  useEffect(() => {
    release();
    history.current = [];
    waveform.current.fill(0);
    let resetDisplay = true;
    const resetRequestId = requestId.current;
    let sequence = 0;
    let animation = 0;
    let lastSample = 0;
    let lastDraw = 0;
    let lastDisplay = 0;
    let latest: AudioMetrics = EMPTY;
    const started = performance.now() / 1000;

    const render = (ms: number) => {
      if (resetDisplay) {
        // An automatic request can settle before the first animation frame.
        if (requestId.current === resetRequestId) {
          setStatus('idle');
          setError('');
          setMetrics(EMPTY);
          setWindowMs(85);
        }
        resetDisplay = false;
      }
      const now = ms / 1000;
      const live = resources.current;
      if (now - lastDraw > 1 / 30) {
        lastDraw = now;
        if (demo) {
          const t = now - started;
          const envelope = Math.pow(Math.max(0, Math.sin(t * 0.85)), 0.5);
          const melody = [48, 50, 52, 55, 57, 55, 52, 50];
          const midi = melody[Math.floor(t / 1.4) % melody.length];
          const fundamental = 440 * Math.pow(2, (midi - 69 + 0.06 * Math.sin(t * 5)) / 12);
          for (let i = 0; i < waveform.current.length; i++) {
            const phase = (t + i / 48000) * fundamental * Math.PI * 2;
            waveform.current[i] = envelope * (0.16 * Math.sin(phase) + 0.04 * Math.sin(phase * 2) + 0.015 * Math.sin(phase * 3));
          }
          latest = { dbfs: envelope > 0.005 ? -22 + 20 * Math.log10(envelope) : -100, centroidHz: envelope > 0.05 ? 1800 + 900 * Math.sin(t * 0.45) : null, flatness: envelope > 0.05 ? 0.09 + 0.05 * Math.sin(t * 0.62) : null, pitchHz: envelope > 0.05 ? fundamental : null, periodicity: envelope > 0.05 ? 0.94 + 0.03 * Math.sin(t * 0.9) : null };
        } else if (live && live.context.state === 'running') {
          live.analyser.getFloatTimeDomainData(waveform.current);
          if (now - lastSample >= 0.1) {
            try {
              latest = analyzeAudioFrame(waveform.current, live.context.sampleRate);
              const deviceKey = JSON.stringify(live.stream.getAudioTracks().map(track => [track.id, track.getSettings()]));
              if (deviceKey !== live.deviceKey) { calibrator.current = new AmbientCalibrator(); live.deviceKey = deviceKey; }
              const ambient = calibrator.current.update(latest, waveform.current, ms);
              setCalibration(ambient);
              const settings = live.stream.getAudioTracks()[0]?.getSettings();
              callbacks.current.onMeasurement?.(serializeAudioMeasurement(latest, waveform.current.length, live.context.sampleRate, {
                id: `${live.clockId}-${sequence++}`, observationId: live.clockId, artifactId: `${live.clockId}-unrecorded-pcm`,
                startMs: Math.max(0, ms - live.startedMs - waveform.current.length / live.context.sampleRate * 1000),
                timebase: { clockId: live.clockId, origin: 'session-start', unit: 'ms', syncUncertaintyMs: null, referenceClockId: null, offsetToReferenceMs: null },
                calibration: ambient, qualityFlags: ['live-preview-not-recorded', 'analysis-poll-timestamp', ...(externalStream ? ['remote-input-latency-unknown'] : []), ...(settings?.autoGainControl || settings?.noiseSuppression || settings?.echoCancellation ? ['device-audio-processing-enabled'] : [])],
              }));
            } catch (cause) {
              latest = EMPTY;
              setError(`Audio analysis failed: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
          }
        } else {
          waveform.current.fill(0);
          latest = EMPTY;
        }
        if ((demo || live?.context.state === 'running') && now - lastSample >= 0.1) {
          lastSample = now;
          history.current.push({ ...latest, time: now });
        }
        history.current = history.current.filter(point => now - point.time <= WINDOW_SECONDS);
        drawWave(waveCanvas.current, waveform.current, demo || live?.context.state === 'running');
        drawHistory(volumeCanvas.current, history.current, now, 'dbfs', -70, 0, '#a3d8c3');
        drawHistory(brightnessCanvas.current, history.current, now, 'centroidHz', 0, 10000, '#eeb08f');
        drawHistory(textureCanvas.current, history.current, now, 'flatness', 0, 1, '#c7bbec');
        drawHistory(pitchCanvas.current, history.current, now, 'pitchHz', 36, 85, '#ead98c');
        drawHistory(toneCanvas.current, history.current, now, 'periodicity', 0, 1, '#91c7e7');
        if (now - lastDisplay > 0.2) { setMetrics(latest); lastDisplay = now; }
      }
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(animation); release(); };
  }, [demo, externalStream, release]);

  useEffect(() => {
    if ((!autoStart && !externalStream) || demo) return;
    // A cancelable task prevents StrictMode's rehearsal mount from opening a second stream.
    const task = window.setTimeout(() => { void start(); }, 0);
    return () => window.clearTimeout(task);
  }, [autoStart, demo, externalStream, start]);

  const active = demo || status === 'live';
  const note = active && metrics.pitchHz !== null ? pitchToNote(metrics.pitchHz) : null;
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
          <span className={`audio-status ${active ? 'audio-status--active' : ''}`}><i />{demo ? 'SYNTHETIC DEMO' : status === 'requesting' ? 'AWAITING PERMISSION' : status === 'suspended' ? 'AUDIO NEEDS A CLICK' : status === 'live' ? signal ? 'MICROPHONE LIVE' : 'LISTENING · QUIET' : 'MICROPHONE OFF'}</span>
          {!demo && status === 'live' && <div className={`audio-calibration ${calibration?.clipping ? 'audio-calibration--clip' : ''}`} title="Automatically estimates ambient noise from quiet, unvoiced windows. Relative levels only; microphone EQ and room reverberation are not identifiable from ambient sound.">
        <span>{externalStream ? 'PHONE MIC' : 'MIC'} · {calibration?.state === 'ready' ? `Ambient ${calibration.noiseFloorDbfs!.toFixed(0)} dBFS` : 'Auto-calibrating · pause singing briefly'}</span>
        <span>{calibration?.clipping ? 'CLIPPING · reduce input gain' : calibration?.snrDb != null ? `Estimated SNR ${calibration.snrDb.toFixed(0)} dB` : calibration?.state === 'ready' ? 'Near ambient level' : 'Finding quiet windows'}</span>
      </div>}
      {!demo && status === 'suspended' && <button className="audio-control" type="button" onClick={enableAudio}><AudioLines size={14} />Enable audio</button>}
          {!demo && (status === 'live' || status === 'requesting' || status === 'suspended' ? <button className="audio-control" type="button" onClick={stop}><Square size={13} />{status === 'requesting' ? 'Cancel' : 'Stop microphone'}</button> : <button className="audio-control" type="button" onClick={() => void start()}><Mic size={14} />Start microphone</button>)}
        </div>
      </header>
      {!demo && status === 'suspended' && <p className="audio-chart-caption" role="status">Microphone connected. Select Enable audio so your browser can start the live analysis.</p>}
      {error && <p className="audio-error" role="alert">{error}</p>}
      <div className="audio-plots">
        <article className="audio-wave-card">
          <div className="audio-chart-title"><h3>Waveform</h3><span>{active ? 'LIVE SNAPSHOT' : 'READY WHEN YOU ARE'}</span></div>
          <div className="audio-wave-surface"><canvas ref={waveCanvas} role="img" aria-label="Current microphone waveform. Display amplitude is automatically scaled." />{!active && <span className="audio-wave-placeholder">A little space to hear yourself.</span>}</div>
          <div className="audio-axis"><span>0 ms</span><span>{windowMs} ms · auto-scale</span></div>
          <p className="audio-chart-caption">{demo ? 'Illustrative wave and histories. No microphone access.' : active && inputDescription ? inputDescription : 'The actual sound wave from your microphone.'}</p>
        </article>
        <div className="audio-histories">
          <article className="audio-history-card audio-history-card--pitch">
            <div className="audio-chart-title"><h3><i />Pitch <span>A4 = 440</span></h3><strong>{note ? `${note.name}${note.octave}` : '—'} <small>{note ? `${note.cents > 0 ? '+' : ''}${note.cents}¢ · ${Math.round(metrics.pitchHz!)} Hz` : active ? pitchStatus(metrics) : 'note · Hz'}</small></strong></div>
            <div className="audio-history-surface"><div className="audio-y-axis audio-note-axis"><span>C6</span><span>C4</span><span>C2</span></div><canvas ref={pitchCanvas} role="img" aria-label="Trailing 25 seconds of detected pitch on a musical note scale from C2 to C sharp 6. Notes and cents use A4 equals 440 Hz. Gaps mean no reliable pitch." /></div>
            <div className="audio-axis audio-time-axis"><span>−25 s</span><span>now</span></div>
          </article>
          <article className="audio-history-card audio-history-card--tone">
            <div className="audio-chart-title"><h3 title="Waveform periodicity: higher means a more regularly repeating signal, not better singing."><i />Tone <span>PERIODICITY</span></h3><strong>{readout(metrics.periodicity, 2)} <small>0–1</small></strong></div>
            <div className="audio-history-surface"><div className="audio-y-axis"><span>1</span><span>0</span></div><canvas ref={toneCanvas} role="img" aria-label="Trailing 25 seconds of waveform periodicity. Higher values mean a more regularly repeating waveform, not better singing." /></div>
            <div className="audio-axis audio-time-axis"><span>−25 s</span><span>now</span></div>
          </article>
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
      <footer className="audio-footer"><p><strong>{demo ? 'DEMO SIGNAL' : 'LOCAL AUDIO ONLY'}</strong>{demo ? 'Synthetic examples, not measurements of your voice.' : 'Processed in your browser. Recording starts only with the recording control; no speaker playback.'}</p><p>Pitch estimates one voice (65–1100 Hz); cents compare the nearest note at A4 = 440. Tone is waveform periodicity, not vocal quality. dBFS is digital level; centroid is spectral balance; flatness runs tonal to noise-like. Silence/noise gaps pitch; accompaniment can confuse it.</p></footer>
    </section>
  );
}

export default AudioPanel;
