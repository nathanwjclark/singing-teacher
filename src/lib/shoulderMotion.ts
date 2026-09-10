import { Euler, Quaternion, Vector3 } from 'three';
import type { Landmark, TrackingFrame } from '../types';

type Shoulder = { lift: number; depth: number; spread: number };
const visible = (p?: Landmark) => !!p && (p.visibility ?? 1) >= .65;
const clamp = (n: number, max: number) => Math.max(-max, Math.min(max, n));
/** Relative shoulder motion after removing torso orientation. World coordinates
 * are pose estimates; the neutral first frame sets a display scale, not anatomy. */
export function createShoulderMotion() {
  let baseline: Vector3[] | undefined;
  let source = '';
  let scale = 100;
  const inverse = new Quaternion();
  const zero = (): Shoulder => ({ lift: 0, depth: 0, spread: 0 });
  return {
    update(frame: TrackingFrame | null, torsoRotation: Euler): [Shoulder, Shoulder] {
      if (!frame) { baseline = undefined; source = ''; return [zero(), zero()]; }
      const world = frame.worldPose;
      const worldValid = [11, 12, 23, 24].every(i => visible(world?.[i]));
      const points = worldValid ? world! : frame.pose;
      if (![11, 12].every(i => visible(points[i]))) return [zero(), zero()];
      const hipsVisible = [23, 24].every(i => visible(points[i]));
      const earsVisible = [7, 8].every(i => visible(points[i]));
      // Close webcam crops often omit hips. Use the visible head midpoint as a
      // relative image reference then; this remains an approximate visual cue.
      const anchor = hipsVisible ? [points[23], points[24]] : earsVisible ? [points[7], points[8]] : frame.face[1] ? [frame.face[1], frame.face[1]] : undefined;
      if (!anchor) return [zero(), zero()];
      const nextSource = worldValid ? 'world' : hipsVisible ? 'image-hips' : 'image-head';
      const hip = new Vector3((anchor[0].x + anchor[1].x) / 2, -(anchor[0].y + anchor[1].y) / 2, worldValid ? -((anchor[0].z ?? 0) + (anchor[1].z ?? 0)) / 2 : 0);
      inverse.setFromEuler(torsoRotation).invert();
      const current = [11, 12].map(i => new Vector3(points[i].x, -points[i].y, worldValid ? -(points[i].z ?? 0) : 0).sub(hip).applyQuaternion(inverse));
      if (!baseline || source !== nextSource) {
        baseline = current.map(p => p.clone());source = nextSource;
        scale = 36 / Math.max(current[0].distanceTo(current[1]), worldValid ? .2 : .1);
      }
      return current.map((p, side) => ({
        lift: clamp((p.y - baseline![side].y) * scale, 7),
        depth: clamp((p.z - baseline![side].z) * scale, 6),
        spread: clamp((p.x - baseline![side].x) * scale, 4),
      })) as [Shoulder, Shoulder];
    },
  };
}
