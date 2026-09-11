import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {controlContextFromState,createControlLearningRoutes,readControlStatus} from './controlLearning.mjs';

// Input data only: a ledger state shaped like the session's control fields.
const anatomy=i=>String(i).repeat(64).slice(0,64);
function forecast(key,{hypotheses=2,matched=0,status='committed',baseline='model-one',binding='cue-one',at='2026-09-11T00:00:01+00:00'}={}){
 const ids=['selected','jaw-more-open'],learned=matched>=3,weights=learned?{selected:.2123456,'jaw-more-open':.7876544}:{selected:.5,'jaw-more-open':.5};
 const by=Object.fromEntries(Array.from({length:hypotheses},(_,i)=>[anatomy(i+1),{status:learned?'empirical':'uniform_insufficient_matches',matched_attempts:matched,weights,leading_control_ids:learned?['jaw-more-open']:ids,training_score_sha256:[]}]));
 const residual=Object.fromEntries(Object.keys(by).map(sha=>[sha,{status:learned?'empirical':'insufficient',count:matched,features:{pitchHz:{unit:'Hz',mean:learned?1.23456:null,sd:null}}}]));
 return {artifact:{sha256:'f'.repeat(64),artifact:{compatibility_sha256:key,status:'available',alternatives:Object.keys(by).flatMap((sha,i)=>ids.map(id=>({anatomy_sha256:sha,hypothesis_id:'h'+i,control_id:id}))),
  conditional_predictions:Object.keys(by).map((sha,i)=>({anatomy_sha256:sha,indistinguishable_control_ids:i?[]:[['selected','jaw-more-open']]})),execution_support:{status:learned?'empirical':'uniform_insufficient_matches',anatomy_control_tradeoff:false,excluded:[],by_anatomy:by},empirical_residual_calibration:{by_anatomy:residual}}},
  status,committed_at:at,baseline_model_id:baseline,binding_id:binding};
}
const scored=(key,sha,status='scored')=>({operation:'score_control_pcm',binding_id:'cue-one',forecast_id:'t',status,result:{artifact:{compatibility_sha256:key,control_support:status==='unscorable'?{}:{[sha]:{selected:.1,'jaw-more-open':.9}}}}});
const binding=(wording,at='2026-09-11T00:00:00+00:00')=>({cue:{wording,wording_sha256:'a'.repeat(64),mode:'elicited'},context:{vowel:'a',pitch_hz:180},controls:[{control_id:'selected',JA:-3,f0_hz:180},{control_id:'jaw-more-open',JA:-4,f0_hz:180}],gain:4,declared_at:at});

test('context counts matched attempts per anatomy, keeps unsuccessful attempts visible and residuals separate',()=>{
 const state={snapshot:{model_id:'model-one'},control_bindings:{'cue-one':binding('Sing an easy ah.')},
  control_forecasts:{t:forecast('key',{matched:3})},
  control_receipts:[scored('key',anatomy(1)),scored('key',anatomy(1)),scored('key',anatomy(1)),scored('key',anatomy(2)),scored('other-key',anatomy(1)),scored('key',anatomy(1),'unscorable'),
   {operation:'record_control_attempt',binding_id:'cue-one',status:'stopped',result:null},{operation:'score_control_pcm',binding_id:'cue-one',status:'failed',result:null}]};
 const context=controlContextFromState(state);
 assert.equal(context.status,'available');assert.equal(context.modelUpdated,false);assert.equal(context.minimumMatchedAttempts,3);
 const [row]=context.bindings;assert.equal(row.deliveredCue,'Sing an easy ah.');assert.equal(row.gainRole,'declared acquisition nuisance for the whole bank');
 assert.deepEqual(row.attempts,{scored:5,noAlternativeFits:0,unscorable:1,stopped:1,failed:1});
 const [first,second]=row.latestForecast.anatomies;
 assert.equal(first.matchedAttempts,3);assert.equal(second.matchedAttempts,1);assert.equal(first.forecastMatchedAttempts,3);
 assert.deepEqual(first.weights,{selected:.2123,'jaw-more-open':.7877});assert.equal(first.supportStatus,'empirical');
 assert.deepEqual(first.residualCalibration,{status:'empirical',count:3,features:{pitchHz:{unit:'Hz',mean:1.2346,sd:null}}});
 assert.equal(row.latestForecast.current,true);assert.deepEqual(first.indistinguishableControlIds,[['selected','jaw-more-open']]);assert.deepEqual(second.indistinguishableControlIds,[]);
 assert.equal(controlContextFromState({...state,snapshot:{model_id:'successor'}}).bindings[0].latestForecast.current,false);
});
test('context is bounded to 24 KB by dropping the oldest bindings and is unsupported without a model',()=>{
 const bindings=Object.fromEntries(Array.from({length:80},(_,i)=>['cue-'+i,binding('Sing an easy ah, version '+i+'. '+'x'.repeat(300),new Date(Date.UTC(2026,8,11,0,0,i)).toISOString())]));
 const context=controlContextFromState({snapshot:{model_id:'m'},control_bindings:bindings,control_forecasts:{},control_receipts:[]});
 assert.ok(Buffer.byteLength(JSON.stringify(context))<=24*1024);assert.equal(context.truncated,true);assert.ok(context.bindings.length<80);
 assert.ok(context.bindings.some(b=>b.bindingId==='cue-79'));
 assert.deepEqual(controlContextFromState(null).bindings,[]);assert.equal(controlContextFromState(null).status,'unsupported');
});
test('routes are localhost-only, take no body and report missing prerequisites without a worker',async t=>{
 const root=await mkdtemp(join(tmpdir(),'control-routes-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let response;const route=createControlLearningRoutes({repo:process.cwd(),dataRoot:root,json:(_res,status,data)=>{response={status,data};}});
 const call=async(path,{method='POST',address='127.0.0.1',headers={},body}={})=>{const req=Readable.from(body?[body]:[]);req.method=method;req.socket={remoteAddress:address};req.headers={host:'localhost:5173',...headers};await route(req,{},new URL(path,'http://localhost:5173'));return response;};
 assert.equal(await route({method:'GET',headers:{},socket:{}},{},new URL('http://localhost/api/other')),false);
 assert.equal((await call('/api/control/status',{method:'GET',address:'192.168.1.9'})).status,403);
 assert.equal((await call('/api/control/forecast',{headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await call('/api/control/forecast',{method:'GET'})).status,405);
 assert.equal((await call('/api/control/forecast',{headers:{'content-length':'2'},body:'{}'})).status,400);
 const status=await call('/api/control/status',{method:'GET'});assert.equal(status.status,200);assert.equal(status.data.status,'unsupported');assert.equal(status.data.delivery.current,false);
 assert.equal((await call('/api/control/forecast')).status,409);
 await mkdir(join(root,'science-runs/run-one'),{recursive:true});await writeFile(join(root,'science-current.json'),JSON.stringify({status:'succeeded',runId:'run-one'}));
 await writeFile(join(root,'science-runs/run-one/summary.json'),JSON.stringify({sessionId:'session-one'}));
 await writeFile(join(root,'science-runs/run-one/astra-rest.json'),JSON.stringify({sessionId:'session-one'}));
 const resting=await readControlStatus({dataRoot:root});assert.equal(resting.delivery.current,false);assert.match(resting.delivery.reason,/rest/);
 const refused=await call('/api/control/forecast');assert.equal(refused.status,409);assert.match(refused.data.error,/rest/);
 assert.equal((await call('/api/control/score')).status,409);
});
