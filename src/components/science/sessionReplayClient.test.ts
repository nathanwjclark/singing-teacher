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
