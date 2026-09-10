import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motionSample, phaseAt } from './motion.ts'
import { validateLearningRecord } from '../contracts/learning.ts'
import type { TrackingFrame } from '../types.ts'
const frame=(t:number):TrackingFrame=>{const face=Array.from({length:468},()=>({x:.5,y:.5}));face[33]={x:.3,y:.3};face[263]={x:.7,y:.3};face[13]={x:.5,y:.5};return {face,pose:[],timestamp:t,metrics:{mouthOpen:0,headTilt:0,shoulderTilt:0,brightness:0,motion:0}}}
test('image translation, scale and roll separate from visible articulation; missing points never become depth',()=>{
 const a=frame(100),b=structuredClone(a);b.timestamp=200
 b.face=b.face.map(p=>({x:.1+.7*(p.x*Math.cos(.3)-p.y*Math.sin(.3)),y:.2+.7*(p.x*Math.sin(.3)+p.y*Math.cos(.3))}))
 const p=motionSample(a,0,1,'neutral'),q=motionSample(b,0,1,'gesture',100)
 assert.ok(Math.abs(p.points[0].headRelative![0]-q.points[0].headRelative![0])<1e-12)
 assert.ok(Math.abs(p.points[0].headRelative![1]-q.points[0].headRelative![1])<1e-12)
 b.face[13].y+=.1
 assert.ok(motionSample(b,0,1,'gesture').points[0].headRelative![1]>q.points[0].headRelative![1])
 assert.equal(q.points.at(-1)?.visibility,'missing');assert.equal(q.points.at(-1)?.headRelative,null)
 assert.equal(motionSample({...b,face:[]},0,1,'return',0).head,null)
})
test('three repeated phases and timing gap are explicit',()=>{
 assert.deepEqual(phaseAt(0),{repetition:1,phase:'neutral',done:false})
 assert.equal(phaseAt(2000).phase,'gesture');assert.equal(phaseAt(5000).phase,'return');assert.equal(phaseAt(7000).repetition,2);assert.equal(phaseAt(21000).done,true)
 assert.equal(motionSample(frame(600),0,1,'return',100).gapBefore,true)
})
test('interchange rejects malformed evidence instead of coercing it',()=>{
 assert.equal(validateLearningRecord({kind:'motion-observation',schemaVersion:'1.0.0'}).valid,false)
 assert.equal(validateLearningRecord({kind:'cue-definition',schemaVersion:'0'}).valid,false)
})
