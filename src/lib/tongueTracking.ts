import type {TongueDiagnostic, TongueObservation} from '../types';

export type Crop={x:number;y:number;width:number;height:number};
const unit=(v:number)=>Math.max(0,Math.min(1,v));

/** A result becomes current on the first frame after it arrives, not at the frame it was computed from.
 * It stays current for its own inference latency plus a grace period, so the next result can replace it
 * on slow devices, while a stalled model still expires. observedAt remains the acquisition time for lag reporting. */
export function resultCurrent(result:{observedAt:number;arrivedAt:number},now:number,grace:number){
 return now-result.arrivedAt<grace+Math.max(0,result.arrivedAt-result.observedAt);
}

/** Map a crop-normalized observation into frame coordinates with the crop its pixels came from.
 * Float round-off at the image edge is clamped; a point further outside the image (a crop that left the frame)
 * or a box that collapses is not an observation, so the result is undefined. */
export function observationInFrame(o:TongueObservation,crop:Crop):TongueObservation|undefined{
 const inside=(v:number)=>Number.isFinite(v)&&v>=-1e-9&&v<=1+1e-9;
 const values=o.trackingMode==='region'?[crop.x+o.box[0]*crop.width,crop.y+o.box[1]*crop.height,crop.x+o.box[2]*crop.width,crop.y+o.box[3]*crop.height]:[crop.x+o.x*crop.width,crop.y+o.y*crop.height,...(o.tip?[crop.x+o.tip.x*crop.width,crop.y+o.tip.y*crop.height]:[])];
 if(!values.every(inside))return;
 const [a,b,c,d]=values.map(unit);
 if(o.trackingMode==='region')return c>a&&d>b?{...o,box:[a,b,c,d]}:undefined;
 return {...o,x:a,y:b,tip:o.tip?{...o.tip,x:c,y:d}:undefined};
}

/** Express a frame box in a crop's normalized coordinates, clipped to that crop; undefined when they do not overlap. */
export function boxInCrop(box:[number,number,number,number],crop:Crop):[number,number,number,number]|undefined{
 const x=(v:number)=>unit((v-crop.x)/crop.width),y=(v:number)=>unit((v-crop.y)/crop.height);
 const result:[number,number,number,number]=[x(box[0]),y(box[1]),x(box[2]),y(box[3])];
 return result[2]>result[0]&&result[3]>result[1]?result:undefined;
}

export function tongueCapabilityLabel(capability:TongueDiagnostic['capability']){
 return capability==='region'?'Visible tongue region only · no tip or depth':capability==='tip'?'Automatic neural tip · estimated depth':'No tongue model loaded';
}
