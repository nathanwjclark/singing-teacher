export type AudioMetrics = { dbfs: number; centroidHz: number | null; flatness: number | null };

/** Power-weighted spectral descriptors from 80 Hz to 10 kHz, gated below -60 dBFS. */
export function analyzeAudio(waveform: Float32Array, spectrumDb: Float32Array, sampleRate: number, fftSize: number): AudioMetrics {
  let squareSum = 0;
  for (const sample of waveform) squareSum += sample * sample;
  const rms = Math.sqrt(squareSum / Math.max(1, waveform.length));
  const dbfs = Math.max(-100, 20 * Math.log10(Math.max(rms, 1e-5)));
  if (dbfs < -60) return { dbfs, centroidHz: null, flatness: null };

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
  if (count <= 0 || powerSum <= count * 1e-12) return { dbfs, centroidHz: null, flatness: null };
  return {
    dbfs,
    centroidHz: weightedSum / powerSum,
    flatness: Math.min(1, Math.exp(logSum / count) / (powerSum / count)),
  };
}
