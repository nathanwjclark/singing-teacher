import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPrediction} from './tongueReview.ts';
import type {TrackingFrame} from '../types';

const crop={x:0,y:0,width:1,height:1};
test('review retains a region box and acquisition time without inventing a tip or surface mask',()=>{
 const frame={tongue:{trackingMode:'region',box:[.3,.3,.7,.7],observedAt:100,confidence:.9}} as TrackingFrame;
 assert.deepEqual(reviewPrediction(frame,crop),{regionPrediction:[.3,.3,.7,.7],predictionObservedAt:100});
 assert.deepEqual(reviewPrediction(frame,{x:.2,y:.2,width:.5,height:.5}).regionPrediction?.map(v=>+v.toFixed(6)),[.2,.2,1,1]);
});
test('only a current region abstention is a miss; stale, pending, loading and unavailable results record nothing',()=>{
 const region={state:'lost',capability:'region'} as const;
 assert.deepEqual(reviewPrediction({tongueDiagnostic:{...region,reason:'No visible tongue region found',abstained:true}} as TrackingFrame,crop),{regionPrediction:null});
 // An expired or not-yet-arrived result keeps the last display text but is not an abstention.
 assert.deepEqual(reviewPrediction({tongueDiagnostic:{...region,state:'tracking',reason:'Visible tongue region found · no tip or depth',abstained:false}} as TrackingFrame,crop),{});
 assert.deepEqual(reviewPrediction({tongueDiagnostic:{state:'selected',capability:'region',reason:'Tongue region detector ready · no tip or depth',abstained:false}} as TrackingFrame,crop),{});
 assert.deepEqual(reviewPrediction({tongueDiagnostic:{state:'lost',reason:'Tongue baseline is unavailable',abstained:false}} as TrackingFrame,crop),{});
 assert.deepEqual(reviewPrediction({} as TrackingFrame,crop),{});
});
test('a tip abstention never becomes a region miss, and a tip never becomes a region',()=>{
 assert.deepEqual(reviewPrediction({tongueDiagnostic:{state:'lost',capability:'tip',reason:'Neural model cannot identify a visible tip',abstained:true}} as TrackingFrame,crop),{});
 const tip=reviewPrediction({tongue:{trackingMode:'tip',x:.4,y:.6,lateral:0,lift:0,visibleFraction:0,observedAt:5}} as TrackingFrame,crop);
 assert.deepEqual(tip,{prediction:{x:.4,y:.6},predictionObservedAt:5});
});
test('a held result from an earlier crop is clipped to the saved crop, or not recorded when outside it',()=>{
 const tongue={trackingMode:'region',box:[.1,.1,.5,.5],observedAt:3,confidence:.9} as const;
 assert.deepEqual(reviewPrediction({tongue} as TrackingFrame,{x:.3,y:.3,width:.5,height:.5}),{regionPrediction:[0,0,.4,.4],predictionObservedAt:3});
 assert.deepEqual(reviewPrediction({tongue} as TrackingFrame,{x:.6,y:.6,width:.4,height:.4}),{predictionObservedAt:3});
 const tip={trackingMode:'tip',x:.9,y:.9,lateral:0,lift:0,visibleFraction:0,observedAt:4} as const;
 assert.deepEqual(reviewPrediction({tongue:tip} as TrackingFrame,{x:0,y:0,width:.5,height:.5}),{predictionObservedAt:4});
});
