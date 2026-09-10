import type { Landmark, Metrics } from '../types';

type Options = { cutoff: number; beta: number; spike: number };
/** Adaptive low-pass filter: strong at rest, faster during intentional movement.
 * A single implausible measurement is held for one sample; sustained movement
 * is accepted on the next sample. Time-based coefficients work at variable fps. */
class AdaptiveSignal {
  private value?: number;
  private raw?: number;
  private time = 0;
  private speed = 0;
  private pending?: number;
  private options: Options;
  constructor(options: Options) { this.options = options; }
  next(raw: number, time: number): number {
    if (!Number.isFinite(raw)) return this.value ?? 0;
    if (this.value === undefined || time - this.time > 500 || time <= this.time) {
      this.value = this.raw = raw; this.time = time; this.speed = 0; this.pending = undefined;
      return raw;
    }
    const dt = Math.max(.001, (time - this.time) / 1000);
    this.time = time;
    if (Math.abs(raw - this.raw!) > this.options.spike && (this.pending === undefined || Math.abs(raw - this.pending) > this.options.spike * .4)) {
      this.pending = raw;
      return this.value;
    }
    this.pending = undefined;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const derivative = (raw - this.raw!) / dt;
    this.speed += alpha(1) * (derivative - this.speed);
    this.raw = raw;
    this.value += alpha(this.options.cutoff + this.options.beta * Math.abs(this.speed)) * (raw - this.value);
    return this.value;
  }
}

function landmarkFilter(world: boolean) {
  let filters: { x: AdaptiveSignal; y: AdaptiveSignal; z: AdaptiveSignal }[] = [];
  const options = { cutoff: .9, beta: world ? 3 : 5, spike: world ? .16 : .10 };
  return (points: Landmark[], time: number) => {
    if (!points.length) { filters = []; return []; }
    return points.map((point, i) => {
      // Never feed occlusion guesses into the filter or promote their confidence.
      if ((point.visibility ?? 1) < .5 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return {...point, visibility: 0};
      const filter = filters[i] ??= {x:new AdaptiveSignal(options),y:new AdaptiveSignal(options),z:new AdaptiveSignal({...options,cutoff:.65})};
      return {...point, x:filter.x.next(point.x,time),y:filter.y.next(point.y,time),z:point.z === undefined ? undefined : filter.z.next(point.z,time)};
    });
  };
}

export function createTrackingStabilizer() {
  const pose = landmarkFilter(false);
  const worldPose = landmarkFilter(true);
  const angles = new Map<string, AdaptiveSignal>();
  return {
    pose,
    worldPose,
    metrics(metrics: Metrics, time: number, hasFace: boolean): Metrics {
      if (!hasFace) { angles.clear(); return metrics; }
      const result = {...metrics};
      for (const key of ['headYaw','headPitch','headTilt','shoulderTilt','torsoLean'] as const) {
        const value = metrics[key];
        if (value === undefined || !Number.isFinite(value)) { angles.delete(key); continue; }
        let filter = angles.get(key);
        if (!filter) { filter = new AdaptiveSignal({cutoff:1.1,beta:.055,spike:28});angles.set(key,filter); }
        result[key] = filter.next(value,time);
      }
      return result;
    },
  };
}
