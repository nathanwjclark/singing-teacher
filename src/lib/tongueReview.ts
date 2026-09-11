import type {TrackingFrame} from '../types';
import {boxInCrop} from './tongueTracking.ts';

export type ReviewPrediction={
 prediction?:{x:number;y:number};
 regionPrediction?:[number,number,number,number]|null;
 predictionObservedAt?:number;
};

/** Region bounds are independent observations, never a surrogate tip or mask.
 * null records that the region model's current result found nothing; a frame without a current result records no region at all.
 * A held result may come from an earlier crop: a box is clipped to this crop, and a box or tip outside it is not a prediction for this image. */
export function reviewPrediction(frame:TrackingFrame,crop:NonNullable<TrackingFrame['tongueSearch']>):ReviewPrediction{
 const tongue=frame.tongue;
 const result:ReviewPrediction={};
 if(tongue?.observedAt!==undefined)result.predictionObservedAt=tongue.observedAt;
 if(tongue?.trackingMode==='region'){
  const box=boxInCrop(tongue.box,crop);if(box)result.regionPrediction=box;
 }else if(tongue?.trackingMode==='tip'){
  // Tolerate float round-off at the crop edge; a tip further outside is not in this image.
  const x=(tongue.x-crop.x)/crop.width,y=(tongue.y-crop.y)/crop.height,near=(v:number)=>v>=-1e-9&&v<=1+1e-9;
  if(near(x)&&near(y))result.prediction={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
 }
 else if(frame.tongueDiagnostic?.capability==='region'&&frame.tongueDiagnostic.abstained)result.regionPrediction=null;
 return result;
}
