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
  assert.equal((await request()).body.status,'ready');release=null;await request('POST');while(!release)await settle();
  assert.equal(JSON.parse(payload.input).sourceCaptureId,'first');assert.equal(JSON.parse(payload.input).scoredOutcome.sourceCaptureId,'second');release();await settle();
  assert.equal((await request()).body.status,'complete');await write(join(dir,'native-pull-latest.json'),{captureId:'second',sha256:'two',receivedAt:'later'});assert.equal((await request()).body.status,'complete');await request('POST');assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});
