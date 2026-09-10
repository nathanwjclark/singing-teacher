import type { AnatomyMotionState } from './anatomyState';
import { tongueDisplacement } from './tongueKinematics';

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
  // The foreground tongue tip is (175.8, 877.8) on the native plate.
  // Its old support started at x=180, so the actual tip had zero motion.
  // Keep the root anchored and use the same anterior displacement as the front mesh.
  const progress = Math.max(0, Math.min(1, (565 - x) / (565 - 175.8)));
  const tongueMask = smooth(80, 130, x) * smooth(792, 835, y) * (1 - smooth(910, 1000, y));
  const displacement = tongueDisplacement(progress, state.tongue);
  px -= displacement.z * 18 * tongueMask;
  py -= displacement.y * 13 * tongueMask;
  // Lateral displacement is perpendicular to this sagittal view, not extension.
  // Full skull rotation, blended continuously into a stationary lower neck.
  const pitch = -state.head.x * (1 - smooth(960, 1355, y));
  const hx = px - 720, hy = py - 1080;
  px = 720 + hx * Math.cos(pitch) - hy * Math.sin(pitch);
  py = 1080 + hx * Math.sin(pitch) + hy * Math.cos(pitch);
  return [px, py];
}
