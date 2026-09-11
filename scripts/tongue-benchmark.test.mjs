import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmark,overlap} from './tongue-benchmark.mjs';
const square=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const review={schema:'tongue-tip-review/v1',cropPixels:{width:480,height:384},samples:[
 {image:'data:image/png;base64,YQ==',label:{x:.5,y:.5},surface:square},
 {image:'data:image/png;base64,Yg==',label:null,surface:square},
 {image:'data:image/png;base64,Yw==',label:null,surface:null}]};
test('tip occlusion does not erase visible surface; misses remain in coverage and IoU',()=>{
 const p={schema:'tongue-predictions/v1',reviewSha256:'abc',modelId:'test',samples:[{index:1,tip:{x:.5,y:.5},surface:square}]};
 const r=benchmark(review,p,'abc');assert.equal(r.tip.coverage,0);assert.equal(r.tip.falseDetectionsOnHidden,1);assert.equal(r.tip.meanErrorOnDetectionsPixels,null);assert.equal(r.surface.meanIoUIncludingMisses,.5);assert.equal(r.surface.detected,1);
});
test('absent segmentation stays unavailable, never a successful zero or perfect overlap',()=>{
 const r=benchmark(review,undefined,'abc');assert.equal(r.surface.available,false);assert.equal(r.surface.meanIoUIncludingMisses,null);assert.equal(overlap(square,square),1);assert.equal(overlap(square,null),0);
});
test('rejects cross-recording, duplicate, out-of-range and wrong-image predictions',()=>{
 const p={schema:'tongue-predictions/v1',reviewSha256:'abc',modelId:'test',samples:[]};
 assert.throws(()=>benchmark(review,p,'wrong'));
 for(const samples of [[{index:0},{index:0}],[{index:5}],[{index:0,tip:{x:2,y:0}}],[{index:0,imageSha256:'wrong'}]])assert.throws(()=>benchmark(review,{...p,samples},'abc'));
});

test('recorded boxes can be evaluated independently without becoming tips or surface masks',()=>{
 const r=benchmark({...review,samples:review.samples.map((s,i)=>({...s,regionPrediction:i===1?[.1,.1,.9,.9]:null}))},undefined,'abc');
 assert.equal(r.region.available,true);assert.equal(r.region.meanBoxIoUIncludingMisses,.5);assert.equal(r.region.detected,1);assert.equal(r.surface.available,false);assert.equal(r.tip.detected,0);
});
test('invalid region boxes are rejected and missing box capability is unavailable',()=>{
 assert.equal(benchmark(review,undefined,'abc').region.meanBoxIoUIncludingMisses,null);
 assert.throws(()=>benchmark({...review,samples:[{...review.samples[0],regionPrediction:[.9,.1,.2,.8]}]},undefined,'abc'));
});
