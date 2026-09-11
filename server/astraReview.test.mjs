import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAstraReviewRoutes} from './astraReview.mjs';
test('Review remains capture-bound; later outcomes preserve original fit provenance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'astra-test-'));const runId='run-test';const run=join(dir,'science-runs',runId);
 const write=(path,value)=>writeFile(path,JSON.stringify(value));
 let release;let payload;let calls=0;let result;
 const handler=createAstraReviewRoutes({dataRoot:dir,apiKey:()=> 'test-key',json:(_,status,body)=>{result={status,body}},fetchApi:async(_,options)=>{
   calls++;payload=JSON.parse(options.body);await new Promise(resolve=>{release=resolve});return {ok:true,json:async()=>({status:'completed',id:'response-test',output:[{content:[{type:'output_text',text:'A conditional practice suggestion.'}]}]})};
 }});
 const request=async(method='GET',remote='127.0.0.1')=>{await handler({method,socket:{remoteAddress:remote}},{},new URL('http://localhost/api/astra-review'));return result};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
 // The route exposes no completion hook, so wait on observable state instead of a fixed
 // sleep: a loaded runner can take longer than one settle() to finish a review.
 const until=async check=>{for(let attempt=0;attempt<200;attempt++){if(await check())return;await settle()}throw Error('Timed out waiting for the review')};
 try{
  await mkdir(run,{recursive:true});await write(join(dir,'science-current.json'),{status:'succeeded',runId});
  await write(join(run,'summary.json'),{status:'succeeded',sourceCaptureId:'first',forecast:{rankings:[{predictions:[{canonical:{measurement:{measurements:[{name:'pitchHz',value:220,unit:'Hz'}]}}}]}]}});
  await write(join(dir,'native-pull-latest.json'),{captureId:'first',sha256:'one'});
  assert.equal((await request('GET','10.0.0.1')).status,403);assert.equal((await request()).body.status,'ready');await request('POST');
  while(!release)await settle();await request('POST');assert.equal(calls,1);
  assert.equal(payload.model,'gpt-6-astra');assert.equal(payload.store,false);assert.equal(JSON.parse(payload.input).rankings[0].predictions[0].measurements[0].value,220);
  await write(join(dir,'native-pull-latest.json'),{captureId:'second',sha256:'two'});release();await settle();assert.equal((await request()).body.status,'waiting');
  await mkdir(join(run,'outcomes','outcome-test'),{recursive:true});await write(join(run,'outcome-current.json'),{status:'succeeded',outcomeId:'outcome-test'});
  await write(join(run,'outcomes','outcome-test','summary.json'),{status:'ineligible',sourceCaptureId:'second',modelUpdated:false,reasons:['Insufficient audio']});
  assert.equal((await request()).body.status,'ready');release=null;
  // A POST that arrives while the superseded review is still finishing is answered without starting a new one.
  await until(async()=>{if(!release)await request('POST');return release});
  assert.equal(JSON.parse(payload.input).sourceCaptureId,'first');assert.equal(JSON.parse(payload.input).scoredOutcome.sourceCaptureId,'second');release();await until(async()=>(await request()).body.status!=='running');
  assert.equal((await request()).body.status,'complete');await write(join(dir,'native-pull-latest.json'),{captureId:'second',sha256:'two',receivedAt:'later'});assert.equal((await request()).body.status,'complete');await request('POST');assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Reset erases the review durably and wins against an in-flight completion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'astra-reset-test-'));const runId='run-reset';const run=join(dir,'science-runs',runId);
 const write=(path,value)=>writeFile(path,JSON.stringify(value));let result;let release;let signal;let calls=0;
 const json=(_,status,body)=>{result={status,body}};
 const make=()=>createAstraReviewRoutes({dataRoot:dir,json,apiKey:()=> 'mock',fetchApi:async(_,options)=>{calls++;signal=options.signal;await new Promise(resolve=>{release=resolve});return{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'Must never resurrect'}]}]})}}});
 let handler=make();
 const request=async(method='GET',path='/api/astra-review')=>{await handler({method,socket:{remoteAddress:'127.0.0.1'}},{},new URL('http://localhost'+path));return result};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
 try{
  await mkdir(run,{recursive:true});await write(join(dir,'science-current.json'),{status:'succeeded',runId});await write(join(run,'summary.json'),{status:'succeeded',sourceCaptureId:'first'});await write(join(dir,'native-pull-latest.json'),{captureId:'first',sha256:'one'});
  await request('POST');while(!release)await settle();assert.equal((await request('GET','/api/astra-review/reset')).status,405);
  const resetting=handler({method:'POST',socket:{remoteAddress:'127.0.0.1'}},{},new URL('http://localhost/api/astra-review/reset'));
  assert.equal((await request('POST')).status,409);await resetting;assert.equal((await request()).body.status,'dismissed');assert.equal(signal.aborted,true);release();await settle();
  assert.equal((await request()).body.status,'dismissed');assert.equal((await request()).body.text,undefined);assert.equal((await request('POST')).status,409);assert.equal(calls,1);
  handler=make();assert.equal((await request()).body.status,'dismissed');assert.equal((await request()).body.canReview,false);
  await write(join(dir,'native-pull-latest.json'),{captureId:'first',sha256:'one',receivedAt:'later'});assert.equal((await request()).body.status,'dismissed');
  await write(join(dir,'native-pull-latest.json'),{captureId:'second',sha256:'two'});assert.equal((await request()).body.status,'waiting');await write(join(run,'summary.json'),{status:'succeeded',sourceCaptureId:'second'});assert.equal((await request()).body.status,'ready');
 }finally{await rm(dir,{recursive:true,force:true})}
});
