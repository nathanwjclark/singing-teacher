import { CONTRACT_VERSION } from '../contracts/index.ts';
import type { AudioMeasurement, Measurement, Timebase } from '../contracts/index.ts';
import type { AudioCalibration } from './audioCalibration.ts';

export type AudioMetrics = { dbfs: number; centroidHz: number | null; flatness: number | null; pitchHz: number | null; periodicity: number | null };
export type MusicalNote = { name: string; octave: number; cents: number; midi: number };

/** Nearest equal-temperament note, A4 = 440 Hz. Cents are relative to that note. */
export function pitchToNote(hz: number): MusicalNote | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const position = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(position);
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return { name: names[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, cents: Math.round((position - midi) * 100), midi };
}

/** YIN cumulative mean normalized difference, decimated for a 65–1100 Hz voice range.
 * Select the first sufficiently periodic trough to avoid preferring subharmonic octaves.
 * A pitch requires a strong repeating waveform; ambient noise can still have periodicity.
 */
export function detectPitch(waveform: Float32Array, sampleRate: number): { pitchHz: number | null; periodicity: number | null } {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || waveform.length < 256) return { pitchHz: null, periodicity: null };
  // Average adjacent samples while downsampling to reduce high-frequency aliasing.
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  const rate = sampleRate / stride;
  const samples = new Float32Array(Math.floor(waveform.length / stride));
  let energy = 0;
  let mean = 0;
  for (const value of waveform) mean += value;
  mean /= waveform.length;
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += waveform[i * stride + j] - mean;
    samples[i] = sum / stride;
    energy += samples[i] * samples[i];
  }
  if (energy / samples.length < 1e-6) return { pitchHz: null, periodicity: null };
  const minLag = Math.max(2, Math.floor(rate / 1100));
  const maxLag = Math.min(Math.ceil(rate / 65) + 1, Math.floor((samples.length - 2) / 2));
  const window = samples.length - maxLag - 1;
  if (maxLag <= minLag || window < maxLag) return { pitchHz: null, periodicity: null };
  const normalized = new Float32Array(maxLag + 1);
  normalized[0] = 1;
  let cumulative = 0;
  let best = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let i = 0; i < window; i++) {
      const delta = samples[i] - samples[i + lag];
      difference += delta * delta;
    }
    cumulative += difference;
    normalized[lag] = cumulative > 0 ? difference * lag / cumulative : 1;
    if (lag >= minLag) best = Math.min(best, normalized[lag]);
  }
  const periodicity = Math.max(0, Math.min(1, 1 - best));
  let trough = -1;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (normalized[lag] < 0.15) {
      while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
      trough = lag;
      break;
    }
  }
  if (trough < 0 || periodicity < 0.85) return { pitchHz: null, periodicity };
  // A dominant second harmonic can create a shallow half-period trough. Prefer
  // its full period only when that match is substantially better, not for tiny errors.
  const troughLeft = normalized[trough - 1];
  const troughRight = normalized[Math.min(maxLag, trough + 1)];
  const curvature = troughLeft - 2 * normalized[trough] + troughRight;
  const troughDepth = curvature > 0 ? normalized[trough] - (troughRight - troughLeft) ** 2 / (8 * curvature) : normalized[trough];
  if (troughDepth > 0.025 && trough * 2 < maxLag) {
    let fullPeriod = trough * 2;
    for (let lag = Math.max(minLag, trough * 2 - 2); lag <= Math.min(maxLag, trough * 2 + 2); lag++) {
      if (normalized[lag] < normalized[fullPeriod]) fullPeriod = lag;
    }
    if (normalized[fullPeriod] < normalized[trough] * 0.2) trough = fullPeriod;
  }
  const left = normalized[trough - 1];
  const center = normalized[trough];
  const right = normalized[Math.min(maxLag, trough + 1)];
  const denominator = left - 2 * center + right;
  const shift = Math.abs(denominator) > 1e-9 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) : 0;
  const pitchHz = rate / (trough + shift);
  // Allow the small interpolation error at the two advertised range boundaries.
  return { pitchHz: pitchHz >= 64.5 && pitchHz <= 1105 ? Math.max(65, Math.min(1100, pitchHz)) : null, periodicity };
}

/** Power-weighted spectral descriptors from 80 Hz to 10 kHz, gated below -60 dBFS. */
export function analyzeAudio(waveform: Float32Array, spectrumDb: Float32Array, sampleRate: number, fftSize: number): AudioMetrics {
  let squareSum = 0;
  for (const sample of waveform) squareSum += sample * sample;
  const rms = Math.sqrt(squareSum / Math.max(1, waveform.length));
  const dbfs = Math.max(-100, 20 * Math.log10(Math.max(rms, 1e-5)));
  const empty = { dbfs, centroidHz: null, flatness: null, pitchHz: null, periodicity: null };
  if (dbfs < -60) return empty;
  const pitch = detectPitch(waveform, sampleRate);
  const binHz = sampleRate / fftSize;
  const from = Math.max(1, Math.ceil(80 / binHz));
  const to = Math.min(spectrumDb.length, Math.floor(10000 / binHz) + 1);
  let powerSum = 0;
  let weightedSum = 0;
  let logSum = 0;
  for (let bin = from; bin < to; bin++) {
    const db = Number.isFinite(spectrumDb[bin]) ? spectrumDb[bin] : -120;
    const power = Math.max(1e-12, Math.pow(10, db / 10));
    powerSum += power;
    weightedSum += power * bin * binHz;
    logSum += Math.log(power);
  }
  const count = to - from;
  if (count <= 0 || powerSum <= count * 1e-12) return { ...empty, ...pitch };
  return {
    dbfs, ...pitch,
    centroidHz: weightedSum / powerSum,
    flatness: Math.min(1, Math.exp(logSum / count) / (powerSum / count)),
  };
}


export const AUDIO_EXTRACTOR_VERSION = '1.1.0';
/** Keep at least 85 ms of PCM at every device rate, including 96/192 kHz interfaces. */
export function audioFrameSize(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate.');
  return Math.min(32768, Math.max(2048, 2 ** Math.ceil(Math.log2(sampleRate * 0.085))));
}
export function pitchStatus(metrics: AudioMetrics): string {
  if (metrics.dbfs < -60) return 'Too quiet for pitch';
  if (metrics.pitchHz !== null) return 'Pitch detected';
  return metrics.periodicity !== null && metrics.periodicity >= 0.85
    ? 'Periodic sound · outside pitch range or ambiguous harmonics'
    : 'No stable pitch · sustain one vowel';
}

/** Same PCM/Blackman spectrum path for live, recorded and engine-generated audio.
 * No temporal spectral smoothing; captures the current window only.
 * Window convention: https://www.w3.org/TR/webaudio/#blackman-window
 */
export function analyzeAudioFrame(waveform: Float32Array, sampleRate: number): AudioMetrics {
  const n = waveform.length;
  if (n < 256 || n > 32768 || (n & (n - 1)) || !Number.isFinite(sampleRate) || sampleRate <= 0 || waveform.some(v => !Number.isFinite(v))) {
    throw new Error('Audio extraction requires finite PCM, positive sample rate and a power-of-two window (256–32768 samples).');
  }
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) real[i] = waveform[i] * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let width = 2; width <= n; width *= 2) {
    const half = width / 2;
    for (let offset = 0; offset < n; offset += width) for (let j = 0; j < half; j++) {
      const angle = -2 * Math.PI * j / width;
      const a = offset + j, b = a + half;
      const re = Math.cos(angle) * real[b] - Math.sin(angle) * imag[b];
      const im = Math.sin(angle) * real[b] + Math.cos(angle) * imag[b];
      real[b] = real[a] - re; imag[b] = imag[a] - im;
      real[a] += re; imag[a] += im;
    }
  }
  const spectrum = new Float32Array(n / 2);
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = 20 * Math.log10(Math.max(1e-12, Math.hypot(real[i], imag[i]) / n));
  return analyzeAudio(waveform, spectrum, sampleRate, n);
}
export type AudioMeasurementMetadata = {
  id: string; observationId: string; artifactId: string; startMs: number; timebase: Timebase;
  sourceKind?: 'human-observation' | 'engine-generated' | 'development-fixture'; sourceHashes?: string[];
  calibration?: AudioCalibration | null; qualityFlags?: string[];
};
export function extractAudioMeasurement(waveform: Float32Array, sampleRate: number, metadata: AudioMeasurementMetadata): AudioMeasurement {
  return serializeAudioMeasurement(analyzeAudioFrame(waveform, sampleRate), waveform.length, sampleRate, metadata);
}
/** Serialize already-extracted live metrics without re-running the FFT. */
export function serializeAudioMeasurement(metrics: AudioMetrics, sampleCount: number, sampleRate: number, metadata: AudioMeasurementMetadata): AudioMeasurement {
  const fields: [keyof AudioMetrics, Measurement['unit']][] = [['dbfs', 'dBFS'], ['centroidHz', 'Hz'], ['flatness', 'ratio'], ['pitchHz', 'Hz'], ['periodicity', 'ratio']];
  const calibration = metadata.calibration;
  const flags = [...(metadata.qualityFlags ?? [])];
  if (calibration?.clipping) flags.push('clipping');
  if (!calibration || calibration.state !== 'ready') flags.push('ambient-not-calibrated');
  if (calibration?.noiseFloorDbfs !== null && calibration?.noiseFloorDbfs !== undefined && metrics.dbfs < calibration.noiseFloorDbfs + 6) flags.push('low-signal-to-noise');
  const measurements: Measurement[] = fields.map(([name, unit]) => ({ name, unit, value: metrics[name], uncertainty: null, missingReason: metrics[name] === null ? 'low-confidence' : null }));
  measurements.push({ name: 'noiseFloorDbfs', unit: 'dBFS', value: calibration?.noiseFloorDbfs ?? null, uncertainty: null, missingReason: calibration?.noiseFloorDbfs != null ? null : 'not-calibrated' });
  measurements.push({ name: 'signalToNoisePowerRatio', unit: 'ratio', value: calibration?.snrDb != null ? Math.pow(10, calibration.snrDb / 10) : null, uncertainty: null, missingReason: calibration?.snrDb != null ? null : calibration?.state === 'ready' ? 'low-confidence' : 'not-calibrated' });
  return { schemaVersion: CONTRACT_VERSION, kind: 'audio-measurement', id: metadata.id, createdAt: new Date().toISOString(),
    provenance: { kind: 'derived-measurement', producer: `singing-teacher/audio/${metadata.sourceKind ?? 'human-observation'}`, producerVersion: AUDIO_EXTRACTOR_VERSION, sourceIds: [metadata.observationId, metadata.artifactId], sourceHashes: metadata.sourceHashes ?? [] },
    observationId: metadata.observationId, artifactId: metadata.artifactId, timebase: metadata.timebase,
    window: { startMs: metadata.startMs, endMs: metadata.startMs + sampleCount / sampleRate * 1000 },
    method: `pcm-blackman-power-yin/${AUDIO_EXTRACTOR_VERSION}`, measurements, quality: { flags, missingReason: null }, calibrationId: calibration?.state === 'ready' ? calibration.id : null };
}
