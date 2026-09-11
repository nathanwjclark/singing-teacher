import type {TrackingFrame} from '../types';

export type ReviewPrediction={
 prediction?:{x:number;y:number};
 regionPrediction?:[number,number,number,number]|null;
 predictionObservedAt?:number;
};

/** Region bounds are independent observations, never a surrogate tip or mask.
 * null records that the region model's current result found nothing; a frame without a current result records no region at all. */
export function reviewPrediction(frame:TrackingFrame,crop:NonNullable<TrackingFrame['tongueSearch']>):ReviewPrediction{
 const tongue=frame.tongue;
 const result:ReviewPrediction={};
 if(tongue?.observedAt!==undefined)result.predictionObservedAt=tongue.observedAt;
 if(tongue?.trackingMode==='region'){
  const [x1,y1,x2,y2]=tongue.box,x=(v:number)=>(v-crop.x)/crop.width,y=(v:number)=>(v-crop.y)/crop.height;
  result.regionPrediction=[x(x1),y(y1),x(x2),y(y2)];
 }else if(tongue?.trackingMode==='tip')result.prediction={x:(tongue.x-crop.x)/crop.width,y:(tongue.y-crop.y)/crop.height};
 else if(frame.tongueDiagnostic?.capability==='region'&&frame.tongueDiagnostic.abstained)result.regionPrediction=null;
 return result;
}
