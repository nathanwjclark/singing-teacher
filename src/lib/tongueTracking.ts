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
 * Clamping removes float round-off at the image edge, so a box stays a valid [0,1] box. */
export function observationInFrame(o:TongueObservation,crop:Crop):TongueObservation{
 const x=(v:number)=>unit(crop.x+v*crop.width),y=(v:number)=>unit(crop.y+v*crop.height);
 if(o.trackingMode==='region'){const [x1,y1,x2,y2]=o.box,box:[number,number,number,number]=[x(x1),y(y1),x(x2),y(y2)];return {...o,box};}
 return {...o,x:x(o.x),y:y(o.y),tip:o.tip?{...o.tip,x:x(o.tip.x),y:y(o.tip.y)}:undefined};
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
