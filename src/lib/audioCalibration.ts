import type { AudioMetrics } from './audio.ts';

export type AudioCalibration = {
  id: string; state: 'collecting' | 'ready'; noiseFloorDbfs: number | null;
  snrDb: number | null; clipping: boolean; quietWindows: number;
};
/** Relative ambient calibration only: no absolute SPL, microphone EQ or room impulse response. */
export class AmbientCalibrator {
  private quiet: { time: number; db: number }[] = [];
  private floor: number | null = null;
  private id = `ambient-${crypto.randomUUID()}`;
  update(metrics: AudioMetrics, waveform: Float32Array, timeMs: number): AudioCalibration {
    const clipping = waveform.some(value => Math.abs(value) >= 0.995);
    this.quiet = this.quiet.filter(point => timeMs - point.time < 30000);
    // Reject voiced windows and louder transients. Continuous singing never becomes a noise calibration.
    const quiet = !clipping && (metrics.periodicity === null || metrics.periodicity < 0.6)
      && metrics.dbfs < Math.min(-35, (this.floor ?? -35) + 6);
    if (quiet) this.quiet.push({ time: timeMs, db: metrics.dbfs });
    if (this.quiet.length >= 20 && timeMs - this.quiet[0].time >= 1900) {
      const levels = this.quiet.map(point => point.db).sort((a, b) => a - b);
      const estimate = levels[Math.floor(levels.length * 0.2)];
      this.floor = this.floor === null ? estimate : this.floor * 0.97 + estimate * 0.03;
    }
    const excessPower = this.floor === null ? null : Math.pow(10, (metrics.dbfs - this.floor) / 10) - 1;
    return { id: this.id, state: this.floor === null ? 'collecting' : 'ready', noiseFloorDbfs: this.floor,
      snrDb: excessPower !== null && excessPower > 1 ? 10 * Math.log10(excessPower) : null,
      clipping, quietWindows: this.quiet.length };
  }
}
