import type { AnatomyMotionState } from './anatomyState';
import { tongueDisplacement } from './tongueKinematics';

export const ATLAS_WIDTH = 1205;
export const ATLAS_HEIGHT = 1424;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export type AtlasTongueRig = {tipX:number;tipY:number;rootX:number;taper:boolean};
export const referenceTongueRig:AtlasTongueRig={tipX:175.8,tipY:877.8,rootX:565,taper:false};
/** Native model contours have a different tip/root than the teaching cast.
 * One reference registration deforms both sides of the red/green comparison. */
export function nativeTongueRig(points:[number,number][]):AtlasTongueRig {
  const native=points.map(([x,y])=>[535-1.85*x,750+2.12*y]);
  const tipX=Math.min(...native.map(p=>p[0]));
  const edge=native.filter(p=>p[0]<tipX+1);
  return {tipX,tipY:edge.reduce((s,p)=>s+p[1],0)/edge.length,rootX:Math.max(...native.map(p=>p[0])),taper:true};
}

// Rig coordinates refer to the unmodified Lynch plate, facing left, in pixels.
// These weights animate a teaching illustration; they are not tissue measurements.
export function deformAtlasPoint(x: number, y: number, state: AnatomyMotionState, rig:AtlasTongueRig=referenceTongueRig): [number, number] {
  const jawWeight = smooth(842, 925, y) * (1 - smooth(440, 660, x)) * (1 - smooth(1090, 1240, y));
  const jawAngle = -state.jawOpen * jawWeight;
  let px = 610 + (x - 610) * Math.cos(jawAngle) - (y - 735) * Math.sin(jawAngle);
  let py = 735 + (x - 610) * Math.sin(jawAngle) + (y - 735) * Math.cos(jawAngle);
  const progress = Math.max(0, Math.min(1, (rig.rootX-x)/Math.max(1,rig.rootX-rig.tipX)));
  const tongueMask = smooth(rig.tipX-96,rig.tipX-46,x)*smooth(rig.tipY-86,rig.tipY-43,y)*(1-smooth(rig.tipY+32,rig.tipY+122,y));
  const displacement = tongueDisplacement(progress, state.tongue);
  // Display gain: two times the previous anterior travel and ~2.3x elevation.
  // Tracking measurements remain unchanged; the shared pose stays independent.
  px -= displacement.z * 36 * tongueMask;
  py -= displacement.y * 30 * tongueMask;
  if(rig.taper){
    const tipWeight=(1-smooth(rig.tipX,rig.tipX+105,x))*(1-smooth(65,115,Math.abs(y-rig.tipY)));
    px-=12*tipWeight;
    py-=(y-rig.tipY)*.65*tipWeight;
  }
  // Lateral displacement is perpendicular to this sagittal view, not extension.
  // Full skull rotation, blended continuously into a stationary lower neck.
  const pitch = -state.head.x * (1 - smooth(960, 1355, y));
  const hx = px - 720, hy = py - 1080;
  px = 720 + hx * Math.cos(pitch) - hy * Math.sin(pitch);
  py = 1080 + hx * Math.sin(pitch) + hy * Math.cos(pitch);
  return [px, py];
}
