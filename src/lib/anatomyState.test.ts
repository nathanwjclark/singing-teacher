import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnatomyMotion} from './anatomyState.ts';
import type {TrackingFrame, TongueObservation} from '../types.ts';

const frame=(t:number,tongue?:TongueObservation):TrackingFrame=>({face:[],pose:[],timestamp:t,metrics:{mouthOpen:0,headTilt:0,shoulderTilt:0,brightness:0,motion:0},tongue});
test('a region box never drives the shared anatomical tongue',()=>{
 const motion=createAnatomyMotion();
 for(let t=0;t<600;t+=30)motion.update(frame(t,{trackingMode:'region',box:[.1,.1,.9,.9],observedAt:t,confidence:.99}),false,t);
 assert.deepEqual(motion.state.tongue,{lateral:0,lift:0,extension:0,curl:0,visible:false});
});
test('a tip observation drives it, and a later region box does not keep or extend it',()=>{
 const motion=createAnatomyMotion();
 motion.update(frame(0,{trackingMode:'tip',x:.5,y:.5,lateral:.5,lift:0,visibleFraction:0,elevation:.4,extension:.3,observedAt:0}),false,0);
 assert.equal(motion.state.tongue.visible,true);assert.ok(motion.state.tongue.extension>0);
 motion.update(frame(300,{trackingMode:'region',box:[.1,.1,.9,.9],observedAt:300,confidence:.99}),false,300);
 assert.equal(motion.state.tongue.visible,false);
});
