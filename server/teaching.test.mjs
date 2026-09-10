import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTeachingRoutes} from './teaching.mjs';

test('teaching disabled and educational-only modes never invent personalized assets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'teaching-test-'));let reply;
 const json=(_,code,body)=>{reply={code,body}};
 const req={method:'GET',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'}};
 try{
  const disabled=createTeachingRoutes({repo:process.cwd(),dataRoot:root,json,enabled:false});
  await disabled(req,{},new URL('http://localhost/api/teaching/status'));assert.equal(reply.body.status,'disabled');assert.equal(reply.body.result,undefined);
  const enabled=createTeachingRoutes({repo:process.cwd(),dataRoot:root,json,enabled:true});
  const bytes=Buffer.from(JSON.stringify({demonstrationId:'cricothyroid-pitch',modelId:'unavailable',designId:'unavailable'}));
  await enabled({...req,method:'POST',async *[Symbol.asyncIterator](){yield bytes}},{},new URL('http://localhost/api/teaching/prepare'));
  assert.equal(reply.body.status,'educational-only');assert.equal(reply.body.result,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('retained teaching results become historical and only matching observed target is attached',async()=>{
 const root=await mkdtemp(join(tmpdir(),'teaching-state-'));const previous={url:process.env.SCIENCE_URL,token:process.env.SCIENCE_TOKEN};let reply;
 process.env.SCIENCE_URL='http://127.0.0.1:9999';process.env.SCIENCE_TOKEN='test-token';
 const put=(name,data)=>writeFile(join(root,name),JSON.stringify(data));
 const frozen={target_observation_id:'target',model_id:'m'};
 let state={snapshot:{model_id:'m'},designs:{d:{status:'committed',data:frozen}},jobs:[]};
 try{
  await mkdir(join(root,'science-runs/run-test'),{recursive:true});
  await put('science-current.json',{status:'succeeded',runId:'run-test'});await put('science-runs/run-test/summary.json',{sessionId:'s',modelId:'m',designId:'d'});
  await put('teaching-current.json',{status:'succeeded',result:{runId:'run-test',sessionId:'s',modelId:'m',designId:'d',frozenForecast:frozen,forecastSha256:'boundhash',targetObservationId:'target',attemptId:'teaching-abcd',before:{audio:{name:'before-audio.wav'}},capabilities:{synthesis:{available:true}}}});
  const route=createTeachingRoutes({repo:process.cwd(),dataRoot:root,json:(_,code,body)=>{reply={code,body}},enabled:true,fetchImpl:async()=>({ok:true,json:async()=>({state})})});
  const req={method:'GET',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'}};
  await route(req,{},new URL('http://localhost/api/teaching/status'));assert.equal(reply.body.current,true);assert.equal(reply.body.result.before.audio,undefined);assert.equal(reply.body.result.capabilities.synthesis.available,false);
  state.snapshot.model_id='new';state.designs.d.status='completed';
  state.jobs=[{job_id:'attempt',status:'succeeded',request:{operation:'update_pcm',parameters:{source_kind:'engine-generated'}},result:{updated_snapshot:{model_id:'new'},scores:[],observation_receipt:{observation_id:'other',design_sha256:'boundhash'}}}];
  await route(req,{},new URL('http://localhost/api/teaching/status'));assert.equal(reply.body.current,false);assert.equal(reply.body.result.outcome,undefined);
  state.jobs[0].result.observation_receipt.observation_id='target';
  await route(req,{},new URL('http://localhost/api/teaching/status'));assert.equal(reply.body.result.outcome.sourceKind,'engine-generated');assert.equal(reply.body.result.outcome.modelUpdated,true);
  state.jobs[0].result.updated_snapshot.model_id='m';
  await route(req,{},new URL('http://localhost/api/teaching/status'));assert.equal(reply.body.result.outcome.modelUpdated,false);assert.equal(reply.body.result.outcome.resultModelId,'m');
  state.jobs[0].result.updated_snapshot.model_id='new';state.jobs[0].status='failed';
  await route(req,{},new URL('http://localhost/api/teaching/status'));assert.equal(reply.body.result.outcome.modelUpdated,false);
 }finally{if(previous.url===undefined)delete process.env.SCIENCE_URL;else process.env.SCIENCE_URL=previous.url;if(previous.token===undefined)delete process.env.SCIENCE_TOKEN;else process.env.SCIENCE_TOKEN=previous.token;await rm(root,{recursive:true,force:true});}
});
