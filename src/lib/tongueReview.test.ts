import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPrediction} from './tongueReview.ts';
import type {TrackingFrame} from '../types';

test('review retains a region box and acquisition time without inventing a tip or surface mask',()=>{
 const frame={tongue:{trackingMode:'region',box:[.3,.3,.7,.7],observedAt:100,confidence:.9}} as TrackingFrame;
 const result=reviewPrediction(frame,{x:0,y:0,width:1,height:1});
 assert.deepEqual(result,{regionPrediction:[.3,.3,.7,.7],predictionObservedAt:100});
});
test('region abstention and unavailable capability remain different',()=>{
 const crop={x:0,y:0,width:1,height:1};
 assert.deepEqual(reviewPrediction({tongueDiagnostic:{reason:'TongueSAM cannot identify a visible tongue region'}} as TrackingFrame,crop),{regionPrediction:null});
 assert.deepEqual(reviewPrediction({} as TrackingFrame,crop),{});
});
