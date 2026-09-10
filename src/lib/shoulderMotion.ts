import { Euler, Quaternion, Vector3 } from 'three';
import type { Landmark, TrackingFrame } from '../types';

type Shoulder = { lift: number; depth: number; spread: number };
const visible = (p?: Landmark) => !!p && (p.visibility ?? 1) >= .65 && Number.isFinite(p.x) && Number.isFinite(p.y);
const clamp = (n: number, max: number) => Math.max(-max, Math.min(max, n));
const zero = (): Shoulder => ({lift:0,depth:0,spread:0});
/** Estimated relative motion. Keep source changes from recentering the model
 * every time hip confidence flickers near the edge of a webcam crop. */
export function createShoulderMotion() {
  let baseline: Vector3[] | undefined;
  let source = '', pendingSource = '';
  let pendingSince = 0, lastReliable = 0;
  let scale = 100;
  let lastFrame: TrackingFrame | null = null;
  let output: [Shoulder, Shoulder] = [zero(),zero()];
  const inverse = new Quaternion();
  return {
    update(frame: TrackingFrame | null, torsoRotation: Euler): [Shoulder, Shoulder] {
      if (!frame) { baseline=undefined;source='';pendingSource='';lastFrame=null;output=[zero(),zero()];return output; }
      if (frame === lastFrame) return output;
      lastFrame = frame;
      const now = frame.timestamp || performance.now();
      const world = frame.worldPose;
      const worldValid = [11,12,23,24].every(i => visible(world?.[i]) && visible(frame.pose[i]));
      const points = worldValid ? world! : frame.pose;
      const hold = () => { if (now-lastReliable > 300) output=[zero(),zero()];return output; };
      if (![11,12].every(i => visible(points[i]))) return hold();
      const hipsVisible = [23,24].every(i => visible(points[i]));
      const denseFace = frame.face.length > 263 && visible(frame.face[33]) && visible(frame.face[263]);
      const earsVisible = [7,8].every(i => visible(points[i]));
      const anchor = hipsVisible ? [points[23],points[24]] : denseFace ? [frame.face[33],frame.face[263]] : earsVisible ? [points[7],points[8]] : undefined;
      if (!anchor) return hold();
      const nextSource = worldValid ? 'world' : hipsVisible ? 'image-hips' : denseFace ? 'image-face' : 'image-ears';
      if (baseline && nextSource !== source) {
        if (pendingSource !== nextSource) { pendingSource=nextSource;pendingSince=now; }
        if (now-pendingSince < 350) return output;
      } else pendingSource='';
      lastReliable=now;
      const origin = new Vector3((anchor[0].x+anchor[1].x)/2,-(anchor[0].y+anchor[1].y)/2,worldValid?-((anchor[0].z??0)+(anchor[1].z??0))/2:0);
      inverse.setFromEuler(torsoRotation).invert();
      const current = [11,12].map(i => new Vector3(points[i].x,-points[i].y,worldValid?-(points[i].z??0):0).sub(origin).applyQuaternion(inverse));
      if (!baseline || source !== nextSource) {
        scale=36/Math.max(current[0].distanceTo(current[1]),worldValid?.2:.1);
        // Rebase a confirmed source transition around the existing shoulder
        // position, rather than snapping back to neutral in the new coordinate frame.
        baseline=current.map((p,i)=>p.clone().sub(new Vector3(output[i].spread/scale,output[i].lift/scale,output[i].depth/scale)));
        source=nextSource;pendingSource='';
      }
      output=current.map((p,i)=>({lift:clamp((p.y-baseline![i].y)*scale,7),depth:clamp((p.z-baseline![i].z)*scale,6),spread:clamp((p.x-baseline![i].x)*scale,4)})) as [Shoulder,Shoulder];
      return output;
    },
  };
}
