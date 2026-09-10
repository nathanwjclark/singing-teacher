import test from 'node:test';
import assert from 'node:assert/strict';
import {readLearningMemory,saveLearningSensation} from './learningMemoryClient.ts';

test('memory reads and reports use local endpoints and retain subjective provenance',async()=>{
 const original=globalThis.fetch;
 const memory={kind:'subjective-cue-memory',sessionId:'session-example',entries:[],scope:'subjective_not_physiological_evidence'};
 const calls:Array<{path:string;init:RequestInit|undefined}>=[];
 globalThis.fetch=async(input,init)=>{calls.push({path:String(input),init});return Response.json(memory)};
 try{
  assert.deepEqual(await readLearningMemory(),memory);
  assert.deepEqual(await saveLearningSensation('A comfortable vibration'),memory);
  assert.equal(calls[0].path,'/api/learning/memory');
  assert.equal(calls[0].init?.cache,'no-store');
  assert.equal(calls[1].path,'/api/learning/sensation');
  assert.equal(calls[1].init?.method,'POST');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)),{text:'A comfortable vibration'});
 }finally{globalThis.fetch=original}
});
test('missing completed attempts and invalid provenance surface errors',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({error:'Completed outcome required'},{status:409});
  await assert.rejects(saveLearningSensation('A report'),/Completed outcome required/);
  globalThis.fetch=async()=>Response.json({entries:[],kind:'physiological-measurement'});
  await assert.rejects(readLearningMemory(),/response is invalid/);
 }finally{globalThis.fetch=original}
});
