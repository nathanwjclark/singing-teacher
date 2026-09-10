import test from 'node:test';
import assert from 'node:assert/strict';
import {importMotionCapture,readMotionStatus,motionAssetUrl} from './motionClient.ts';
test('motion uploads preserve original JSON and companion bytes',async()=>{
 const original=globalThis.fetch,raw='{ "original": true }\n';
 globalThis.fetch=async(input,init)=>{
  assert.equal(input,'/api/motion/import');assert.equal(init?.method,'POST');
  const body=init?.body as FormData;
  assert.deepEqual([...body.keys()],['record','media']);
  assert.equal(await (body.get('record') as Blob).text(),raw);
  assert.deepEqual([...new Uint8Array(await (body.get('media') as Blob).arrayBuffer())],[1,2,3]);
  return Response.json({capture:{id:'capture-example'},reused:false});
 };
 try{assert.equal((await importMotionCapture(new Blob([raw]),new Blob([new Uint8Array([1,2,3])]),'video.webm')).capture.id,'capture-example')}
 finally{globalThis.fetch=original}
});
test('unavailable storage and oversize uploads report errors; empty status stays empty',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({busy:false,capture:null,record:null});
  assert.equal((await readMotionStatus()).capture,null);
  globalThis.fetch=async()=>Response.json({error:'Media hash mismatch'},{status:400});
  await assert.rejects(importMotionCapture(new Blob(['{}']),new Blob(['video']),'video.webm'),/hash mismatch/);
  await assert.rejects(importMotionCapture(new Blob([new Uint8Array(4*1024*1024+1)]),new Blob(['v']),'v.webm'),/4 MiB/);
  assert.equal(motionAssetUrl('a/b','media'),'/api/motion/media?id=a%2Fb');
 }finally{globalThis.fetch=original}
});
