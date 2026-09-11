import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLearningRoutes} from './learningMemory.mjs';

test('learning memory names the missing step and never sends a private path to the page',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'learning-memory-'));
 try{
  let reply;const routes=createLearningRoutes({dataRoot,json:(_res,status,body)=>{reply={status,body};}});
  const get=async()=>{await routes({method:'GET',socket:{remoteAddress:'127.0.0.1'}},{},new URL('http://localhost/api/learning/memory'));return reply;};
  let status=await get();
  assert.equal(status.status,409);assert.equal(status.body.error,'Completed model run required');
  await writeFile(join(dataRoot,'science-current.json'),JSON.stringify({status:'succeeded',runId:'run-1'}));
  status=await get();
  assert.equal(status.body.error,'Completed outcome required');
  // Any other file-system failure (here: a directory where a file belongs) stays generic.
  await mkdir(join(dataRoot,'science-runs','run-1','outcome-current.json'),{recursive:true});
  status=await get();
  assert.equal(status.status,409);assert.equal(status.body.error,'Learning memory files could not be read');
  assert.doesNotMatch(JSON.stringify(status.body),new RegExp(dataRoot.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});
