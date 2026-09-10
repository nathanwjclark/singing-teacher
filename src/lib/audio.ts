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
  const maxLag = Math.min(Math.ceil(rate / 65), Math.floor(samples.length / 2));
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
  return { pitchHz: pitchHz >= 65 && pitchHz <= 1100 ? pitchHz : null, periodicity };
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
