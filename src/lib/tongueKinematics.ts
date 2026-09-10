import type { TonguePose } from './anatomyState';

const bounded = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
/** Reference-model units, not measured millimeters. +x sensor-right, +y up,
 * +z anterior. Front reflection happens once at the parent rig. A sagittal
 * projection discards x; lateral motion must not become false protrusion.
 */
export function tongueDisplacement(progress: number, pose: TonguePose) {
  const t = bounded(progress, 0, 1), weight = t * t;
  const angle = bounded(pose.curl, -.85, .85) * weight;
  const arc = 2.79 * t;
  return {
    x: bounded(pose.lateral, -3, 3) * weight,
    y: bounded(pose.lift, -3.8, 3.8) * weight + Math.sin(angle) * arc,
    z: bounded(pose.extension, -4.5, 4.5) * weight + (Math.cos(angle) - 1) * arc,
  };
}
