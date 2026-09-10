import test from 'node:test';
import assert from 'node:assert/strict';
import {indexVisualFrames,parseVisualCamera,visualFrameUrl,visualPixelAt,visualRequest} from './visualClient.ts';
test('decoded-frame annotations use source pixels without rotation or landmark mapping',()=>{
 assert.deepEqual(visualPixelAt(60,40,120,80,1920,1280),[960,640]);
 assert.deepEqual(visualPixelAt(120,80,120,80,1920,1280),[1919,1279]);
 assert.equal(visualFrameUrl('capture/a',12),'/api/visual/frame?captureId=capture%2Fa&frameIndex=12');
});
test('camera candidates require explicit finite scale and rotation',()=>{
 assert.deepEqual(parseVisualCamera('camera','1 0 0\n0 1 0\n0 0 1','1200'),{camera_id:'camera',rotation_3x3:[[1,0,0],[0,1,0],[0,0,1]],scale_px_per_m:1200});
 assert.throws(()=>parseVisualCamera('camera','1 0','1200'),/nine/);
 assert.throws(()=>parseVisualCamera('camera','1 0 0 0 1 0 0 0 1',''),/positive/);
 assert.throws(()=>parseVisualCamera('camera','1 0 0 0 1 0 0 0 1','Infinity'),/positive/);
});
test('frame indexing and scoring retain declared capture and missing annotations',async()=>{
 const original=globalThis.fetch,calls:Array<{url:string;body:unknown}>=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json({busy:true})};
 try{
  await indexVisualFrames('capture-example');
  const body={requestId:'request-example',forecastId:'forecast-example',captureId:'capture-example',annotations:[{frameIndex:5,pose:'a',assumedJA:-3,visibility:'occluded',upperPixel:null,lowerPixel:null}],experimentalDeclaration:true};
  await visualRequest('score',body);
  assert.deepEqual(calls,[{url:'/api/visual/frames',body:{captureId:'capture-example'}},{url:'/api/visual/score',body}]);
 }finally{globalThis.fetch=original}
});
test('disabled or stale server rejection is not presented as a successful forecast',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'Visual forecast baseline changed'},{status:409});
 try{await assert.rejects(visualRequest('score',{}),/baseline changed/)}finally{globalThis.fetch=original}
});
