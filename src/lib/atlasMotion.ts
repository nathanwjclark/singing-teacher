import type { AnatomyMotionState } from './anatomyState';

export const ATLAS_WIDTH = 1205;
export const ATLAS_HEIGHT = 1424;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Rig coordinates refer to the unmodified Lynch plate, facing left, in pixels.
// These weights animate a teaching illustration; they are not tissue measurements.
export function deformAtlasPoint(x: number, y: number, state: AnatomyMotionState): [number, number] {
  const jawWeight = smooth(842, 925, y) * (1 - smooth(440, 660, x)) * (1 - smooth(1090, 1240, y));
  const jawAngle = -state.jawOpen * jawWeight;
  let px = 610 + (x - 610) * Math.cos(jawAngle) - (y - 735) * Math.sin(jawAngle);
  let py = 735 + (x - 610) * Math.sin(jawAngle) + (y - 735) * Math.cos(jawAngle);
  const tongueWeight = (1 - smooth(320, 565, x)) * smooth(180, 220, x)
    * smooth(792, 835, y) * (1 - smooth(910, 980, y));
  px -= state.tongue.extension * 18 * tongueWeight;
  py -= (state.tongue.lift * 13 + Math.sin(state.tongue.curl) * 25) * tongueWeight;
  // Full skull rotation, blended continuously into a stationary lower neck.
  const pitch = -state.head.x * (1 - smooth(960, 1355, y));
  const hx = px - 720, hy = py - 1080;
  px = 720 + hx * Math.cos(pitch) - hy * Math.sin(pitch);
  py = 1080 + hx * Math.sin(pitch) + hy * Math.cos(pitch);
  return [px, py];
}
