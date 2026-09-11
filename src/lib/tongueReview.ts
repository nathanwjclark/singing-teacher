import type {TrackingFrame} from '../types';

export type ReviewPrediction={
 prediction?:{x:number;y:number};
 regionPrediction?:[number,number,number,number]|null;
 predictionObservedAt?:number;
};

/** Region bounds are independent observations, never a surrogate tip or mask. */
export function reviewPrediction(frame:TrackingFrame,crop:NonNullable<TrackingFrame['tongueSearch']>):ReviewPrediction{
 const tongue=frame.tongue;
 const result:ReviewPrediction={};
 if(tongue?.observedAt!==undefined)result.predictionObservedAt=tongue.observedAt;
 if(tongue?.trackingMode==='tip')result.prediction={x:(tongue.x-crop.x)/crop.width,y:(tongue.y-crop.y)/crop.height};
 if(tongue?.trackingMode==='region'&&tongue.outline?.length){
  const xs=tongue.outline.map(p=>(p.x-crop.x)/crop.width),ys=tongue.outline.map(p=>(p.y-crop.y)/crop.height);
  result.regionPrediction=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
 }else if(frame.tongueDiagnostic?.reason.startsWith('TongueSAM'))result.regionPrediction=null;
 return result;
}
