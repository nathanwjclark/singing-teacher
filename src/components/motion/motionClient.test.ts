import test from 'node:test';
import assert from 'node:assert/strict';
import {importMotionCapture,readMotionStatus,motionAssetUrl,readMotionAnalysis,analyzeMotionAudio,rankMotionCandidates} from './motionClient.ts';
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
test('optional analysis binds explicit vowel and capture; retry reuses request identity',async()=>{
 const original=globalThis.fetch,calls:Array<{input:string;body:unknown}>=[];
 globalThis.fetch=async(input,init)=>{calls.push({input:String(input),body:init?.body?JSON.parse(String(init.body)):null});return Response.json({status:'running',availability:{available:true,reason:null}})};
 try{
  await analyzeMotionAudio('saved-example','i','request-example');
  await analyzeMotionAudio('saved-example','i','request-example');
  assert.deepEqual(calls[0],{input:'/api/motion/analyze',body:{captureId:'saved-example',pose:'i',requestId:'request-example',containsExternalExcitation:false}});
  assert.deepEqual(calls[1],calls[0]);
  await readMotionAnalysis('saved/example');
  assert.equal(calls[2].input,'/api/motion/analysis?captureId=saved%2Fexample');
 }finally{globalThis.fetch=original}
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

test('candidate ranking retains unscored hypotheses without inventing zero discrepancy',()=>{
 const candidates=[{candidate_id:'missing',status:'missing_predicted_features',weighted_mean_square_discrepancy:null},{candidate_id:'higher',status:'scored',weighted_mean_square_discrepancy:4},{candidate_id:'lower',status:'scored',weighted_mean_square_discrepancy:1}];
 assert.deepEqual(rankMotionCandidates(candidates).map(row=>row.candidate_id),['lower','higher','missing']);
 assert.equal(candidates[0].candidate_id,'missing');
 assert.equal(rankMotionCandidates(candidates)[2].weighted_mean_square_discrepancy,null);
});
