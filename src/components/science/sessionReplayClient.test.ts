import test from 'node:test';
import assert from 'node:assert/strict';
import {readSessionReplay,sessionReplayJson} from './sessionReplayClient.ts';
test('partial server export and opaque evidence survive download serialization',async()=>{
 const original=globalThis.fetch;
 const exported={schemaVersion:'singing-session-export/1',status:'partial',summary:{modelId:null},missing:[{source:'worker',reason:'unavailable'}],artifacts:[{source:'decision',data:{modelId:'model-example',cue:'ah'}}],omissions:[{path:'pcm',reason:'raw media excluded'}],replay:null};
 globalThis.fetch=async(input,init)=>{assert.equal(input,'/api/session-export');assert.equal(init?.cache,'no-store');return Response.json(exported)};
 try{assert.deepEqual(JSON.parse(sessionReplayJson(await readSessionReplay())),exported)}finally{globalThis.fetch=original}
});
test('missing session and malformed export are errors rather than empty success',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({error:'Completed run required'},{status:409});
  await assert.rejects(readSessionReplay(),/Completed run required/);
  globalThis.fetch=async()=>Response.json({schemaVersion:'unknown'});
  await assert.rejects(readSessionReplay(),/Invalid session export/);
 }finally{globalThis.fetch=original}
});

import {readSessionRecomputation,startSessionRecomputation} from './sessionReplayClient.ts';
test('verification client preserves unverified/skipped coverage and sends only bounded request identity',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(input,init)=>{assert.equal(input,'/api/session-recompute/run');assert.deepEqual(JSON.parse(String(init?.body)),{requestId:'replay-request',maxOperations:3});return Response.json({status:'running',attemptId:'replay-request'})};
  assert.equal((await startSessionRecomputation('replay-request',3)).status,'running');
  const report={schemaVersion:'session-recomputation/1',attemptId:'a',sessionId:'s',modelUpdated:false,rawMediaIncluded:false,counts:{compared:1},operations:[{status:'version_unverified',numericalAgreement:true},{status:'skipped',numericalAgreement:null}]};
  globalThis.fetch=async()=>Response.json({status:'completed',attemptId:'a',sessionId:'s',report});
  assert.deepEqual((await readSessionRecomputation()).report,report);
  globalThis.fetch=async()=>Response.json({status:'completed',attemptId:'different',sessionId:'s',report});
  await assert.rejects(readSessionRecomputation(),/Invalid numerical verification report/);
 }finally{globalThis.fetch=original}
});
