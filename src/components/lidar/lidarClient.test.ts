import test from 'node:test';
import assert from 'node:assert/strict';
import {depthPixelAt,parseDepthMapping,parseNumbers,fitLidarCapture,readLidarStatus,verifiedLidarGeometry} from './lidarClient.ts';
import type {LidarAnnotation,LidarFitReceipt} from './lidarClient.ts';
test('depth clicks select exact source pixels, not RGB display coordinates',()=>{
 assert.deepEqual(depthPixelAt(100,50,400,200,8,4),[2,1]);
 assert.deepEqual(depthPixelAt(400,200,400,200,8,4),[7,3]);
 assert.deepEqual(depthPixelAt(-1,-1,400,200,8,4),[0,0]);
});
test('geometry preview rejects modified artifact bytes',async()=>{
 const original=globalThis.fetch,bytes=new TextEncoder().encode('{"model":"example"}');
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 const receipt:LidarFitReceipt={captureId:'capture-example',importId:'import-example',archiveSha256:'example',sessionId:'session-example',parentModelId:'parent-example',modelId:'model-example',jobId:'job-example',fitId:'fit-example',status:'succeeded',includedInFit:true,result:{status:'ranked'},geometry:{modelId:'model-example',hypothesisId:'hypothesis-example',pose:'a',JA:-3,files:{'space-diff.json':{sha256:digest,byteLength:bytes.length}}}};
 try{
  globalThis.fetch=async()=>new Response(bytes);
  assert.equal((await verifiedLidarGeometry(receipt)).byteLength,bytes.length);
  globalThis.fetch=async()=>new Response(new Uint8Array(bytes.length));
  await assert.rejects(verifiedLidarGeometry(receipt),/hash mismatch/);
 }finally{globalThis.fetch=original}
});
test('matrix parsing requires explicit finite nine-value declaration',()=>{
 assert.deepEqual(parseDepthMapping('2 0 0\n0 2 0\n0 0 1'),[[2,0,0],[0,2,0],[0,0,1]]);
 assert.throws(()=>parseDepthMapping('1 0'),/nine/);
 assert.throws(()=>parseDepthMapping(''),/finite/);
 assert.throws(()=>parseNumbers('1 Infinity','weights'),/finite/);
});
test('fit request retains explicit annotation and pins capture plus model',async()=>{
 const original=globalThis.fetch;
 const annotation:LidarAnnotation={sourceKind:'development-fixture',frameSequence:4,upperPixel:[1,2],lowerPixel:[1,3],depthToReference:[[1,0,0],[0,1,0],[0,0,1]],referenceMappingExplanation:'Experimental identity assumption',pose:'a',jawValues:[-3],jawWeights:[1],measurementSigmaM:.003,modelSigmaM:.004,uncertaintyExplanation:'Declared experimental error',correspondenceExplanation:'Declared outer lip points',registrationExplanation:'Same-frame distance',experimentalDeclaration:true};
 globalThis.fetch=async(input,init)=>{assert.equal(input,'/api/lidar/fit');assert.deepEqual(JSON.parse(String(init?.body)),{captureId:'capture-example',expectedModelId:'model-example',annotation,requestId:'request-example'});return Response.json({busy:true})};
 try{await fitLidarCapture('capture-example','model-example',annotation,'request-example')}
 finally{globalThis.fetch=original}
});
test('disabled status is preserved and server rejection remains visible',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({enabled:false,busy:false,capture:null,currentModelId:null,result:null});
  assert.equal((await readLidarStatus()).enabled,false);
  globalThis.fetch=async()=>Response.json({error:'Mapping evidence missing'},{status:409});
  await assert.rejects(readLidarStatus(),/Mapping evidence missing/);
 }finally{globalThis.fetch=original}
});
