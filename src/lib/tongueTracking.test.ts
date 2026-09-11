import test from 'node:test';
import assert from 'node:assert/strict';
import {boxInCrop,observationInFrame,resultCurrent,tongueCapabilityLabel} from './tongueTracking.ts';
import type {TongueObservation} from '../types.ts';

test('a slow result is current when it arrives and stays current until the next result can arrive',()=>{
 // Inference started at frame 1000 and took 400 ms; the next result is due near 1800.
 const result={observedAt:1000,arrivedAt:1400};
 assert.equal(resultCurrent(result,1400,800),true);
 assert.equal(resultCurrent(result,1799,800),true);
 assert.equal(resultCurrent(result,2599,800),true);
 assert.equal(resultCurrent(result,2600,800),false);
});
test('phone-speed inference no longer expires on arrival',()=>{
 // Timing from observedAt with an 800 ms window dropped every 1.5 s result immediately.
 const result={observedAt:0,arrivedAt:1500};
 assert.equal(resultCurrent(result,1500,800),true);
 assert.equal(resultCurrent(result,2999,800),true);
 assert.equal(resultCurrent(result,3800,800),false);
});
test('a fast tip model keeps its short expiry',()=>{
 const result={observedAt:100,arrivedAt:110};
 assert.equal(resultCurrent(result,409,300),true);
 assert.equal(resultCurrent(result,420,300),false);
});
test('capability labels never call a region a tip or depth',()=>{
 assert.match(tongueCapabilityLabel('region'),/no tip or depth/);
 assert.doesNotMatch(tongueCapabilityLabel('region'),/estimated depth|neural tip/i);
 assert.equal(tongueCapabilityLabel('tip'),'Automatic neural tip · estimated depth');
 assert.equal(tongueCapabilityLabel(undefined),'No tongue model loaded');
});
test('a crop-local box maps into the frame with its own crop and stays inside the image at the edges',()=>{
 const region=(box:[number,number,number,number]):TongueObservation=>({trackingMode:'region',box,observedAt:1,confidence:.9});
 const mapped=observationInFrame(region([.3,.4,.8,1]),{x:.31,y:.47,width:.37,height:.53});
 assert.equal(mapped.trackingMode,'region');
 if(mapped.trackingMode==='region'){assert.ok(mapped.box.every(v=>v>=0&&v<=1));assert.equal(mapped.box[3],1);}
 // Without clamping, .47+1*.53 and .31+.8*.37 land on 1.0000000000000002 and .6060000000000001.
 let exceeded=0;for(let i=0;i<2000;i++){const x=Math.random()*.6,y=Math.random()*.6,crop={x,y,width:1-x,height:1-y};const o=observationInFrame(region([Math.random()*.5,Math.random()*.5,1,1]),crop);if(o.trackingMode==='region'&&o.box.some(v=>v>1||v<0))exceeded++;}
 assert.equal(exceeded,0);
 const tip=observationInFrame({trackingMode:'tip',x:.5,y:.5,lateral:.2,lift:0,visibleFraction:0,tip:{x:.5,y:.5}},{x:.2,y:.4,width:.4,height:.2});
 assert.deepEqual(tip.trackingMode==='tip'&&[tip.x,tip.y,tip.tip?.x,tip.tip?.y,tip.lateral],[.4,.5,.4,.5,.2]);
});
test('a frame box is clipped to a later crop and dropped when it no longer overlaps',()=>{
 const crop={x:.31,y:.47,width:.37,height:.53},frame=[.31+.3*.37,.47+.4*.53,.31+.8*.37,1] as [number,number,number,number];
 const back=boxInCrop(frame,crop)!;assert.ok(back.every(v=>v>=0&&v<=1));assert.equal(back[3],1);assert.ok(Math.abs(back[2]-.8)<1e-12);
 assert.deepEqual(boxInCrop([.1,.1,.5,.5],{x:.3,y:.3,width:.5,height:.5}),[0,0,.4,.4]);
 assert.equal(boxInCrop([.1,.1,.2,.2],{x:.5,y:.5,width:.5,height:.5}),undefined);
});
