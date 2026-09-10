import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readSourceInferenceContext,sourceForecastKey,sourceFitKey,sourceRuntimePolicy} from './sourceInference.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'source-state-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=join(root,'science-runs/run-one');await mkdir(dir,{recursive:true});await writeFile(join(root,'science-current.json'),JSON.stringify({status:'succeeded',runId:'run-one'}));await writeFile(join(dir,'summary.json'),JSON.stringify({sessionId:'session-one'}));await writeFile(join(dir,'source-forecast.json'),JSON.stringify({status:'succeeded',result:{baselineModelId:'model-one',forecast:{target_id:'target',status:'available'},sha256:'hash'}}));return {root,dir};}
test('disabled source capability hides prior active results without deleting history',async t=>{const {root}=await fixture(t);const state=await readSourceInferenceContext({dataRoot:root,enabled:false});assert.equal(state.forecast.status,'disabled');assert.equal(state.forecast.result,undefined);});
test('source policy changes invalidate fit and forecast cache while preserving historical receipts',async t=>{
 const {root,dir}=await fixture(t),repo=join(root,'repo');
 const names=['science/src/singing_physics/phonation.py','science/scripts/phonation_bridge.ts','src/phonation/measure.ts','src/phonation/types.ts','src/lib/audio.ts','src/contracts/example.ts'];
 for(const name of names){const path=join(repo,name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,name);}
 const policy=await sourceRuntimePolicy(repo),saved={status:'succeeded',result:{baselineModelId:'model-one',capability:{source_adapter_sha256:policy.adapter},extractor_signature:policy.extractor}};
 await writeFile(join(dir,'source-fit.json'),JSON.stringify(saved));
 const previous=globalThis.fetch,url=process.env.SCIENCE_URL,token=process.env.SCIENCE_TOKEN;
 process.env.SCIENCE_URL='http://127.0.0.1:8766';process.env.SCIENCE_TOKEN='test';
 globalThis.fetch=async()=>Response.json({state:{snapshot:{model_id:'model-one'},source_model:{model_id:'source-one'}}});
 t.after(()=>{globalThis.fetch=previous;if(url===undefined)delete process.env.SCIENCE_URL;else process.env.SCIENCE_URL=url;if(token===undefined)delete process.env.SCIENCE_TOKEN;else process.env.SCIENCE_TOKEN=token;});
 const before=await readSourceInferenceContext({repo,dataRoot:root,enabled:true});assert.equal(before.fit.status,'succeeded');
 await writeFile(join(repo,'science/src/singing_physics/phonation.py'),'new-source-policy');
 const after=await readSourceInferenceContext({repo,dataRoot:root,enabled:true});
 assert.equal(after.fit.status,'unsupported');assert.match(after.fit.reason,/analyze the latest capture again/);assert.equal(after.fit.result,undefined);
 assert.notEqual(sourceFitKey(before),sourceFitKey(after));assert.notEqual(sourceForecastKey(before),sourceForecastKey(after));
 const {readFile}=await import('node:fs/promises');assert.deepEqual(JSON.parse(await readFile(join(dir,'source-fit.json'),'utf8')),saved);
});
test('forecast identity changes with bank/ranking content rather than receipt count alone',()=>{
 const state={baselineModelId:'base',sourceModelId:'source',sourceScoreCount:1,fit:{result:{joint:{candidates:[{candidate_id:'one'}]}}},sourceRankingIdentity:'rank-one',sourceRankingBankSha256:'bank-one'};
 const key=sourceForecastKey(state);
 assert.equal(sourceForecastKey(structuredClone(state)),key);
 for(const change of [{sourceRankingIdentity:'rank-two'},{sourceRankingBankSha256:'bank-two'},{fit:{result:{joint:{candidates:[{candidate_id:'two'}]}}}}])assert.notEqual(sourceForecastKey({...state,...change}),key);
 assert.equal(sourceForecastKey({...state,sourceScoreCount:99}),key);
 assert.notEqual(sourceForecastKey({...state,sourceRankingIdentity:null,sourceScoreCount:1}),sourceForecastKey({...state,sourceRankingIdentity:null,sourceScoreCount:2}));
});
test('compact bank retains bounded unavailable alternatives and conditional heldout lineage',async t=>{
 const {root,dir}=await fixture(t),previous=globalThis.fetch,url=process.env.SCIENCE_URL,token=process.env.SCIENCE_TOKEN;
 process.env.SCIENCE_URL='http://127.0.0.1:8766';process.env.SCIENCE_TOKEN='test';
 t.after(()=>{globalThis.fetch=previous;if(url===undefined)delete process.env.SCIENCE_URL;else process.env.SCIENCE_URL=url;if(token===undefined)delete process.env.SCIENCE_TOKEN;else process.env.SCIENCE_TOKEN=token;});
 const rows=Array.from({length:51},(_,i)=>({alternative_id:'joint:'+i,family:'joint',candidate_id:String(i),status:i?'available':'unavailable',reason:i?null:'unsupported-window',record:i?{descriptors:{pitch:180}}:null}));
 await writeFile(join(dir,'source-forecast.json'),JSON.stringify({status:'succeeded',result:{baselineModelId:'model-one',forecast:{kind:'frozen-phonation-bank-1',target_id:'target',status:'available',alternatives:rows,fit_sha256:'fit-hash'},sha256:'bank-hash'}}));
 await writeFile(join(dir,'source-score.json'),JSON.stringify({status:'succeeded',result:{baselineModelId:'model-one',status:'scored',forecast_sha256:'bank-hash',alternatives:rows.map((row,i)=>({...row,score:i?2:null,heldout_rank:i||null})),ranking:['joint:1'],conditionalRanking:{rankingId:'rank-one',version:1,bankSha256:'bank-hash'},model_updated:false}}));
 globalThis.fetch=async()=>Response.json({state:{snapshot:{model_id:'model-one'},source_model:{model_id:'source-one'},source_forecasts:{target:{status:'scored',source_model_id:'source-one',baseline_model_id:'model-one'}},source_rankings:[{ranking_id:'rank-one',bank_sha256:'bank-hash',source_model_id:'source-one',baseline_model_id:'model-one'}]}});
 const compact=await readSourceInferenceContext({dataRoot:root,enabled:true,compact:true});
 assert.equal(compact.forecast.current,false);assert.equal(compact.forecast.bank.alternatives.length,48);assert.equal(compact.forecast.bank.totalAlternatives,51);
 assert.equal(compact.forecast.bank.alternatives[0].status,'unavailable');assert.equal(compact.forecast.bank.alternatives[0].descriptors,null);
 assert.equal(compact.score.conditionalRanking.alternatives[0].discrepancy,null);assert.equal(compact.score.conditionalRanking.conditionalRanking.rankingId,'rank-one');
 assert.equal(compact.sourceRankingIdentity,'rank-one');assert.equal(compact.sourceRankingBankSha256,'bank-hash');
});
test('a consumed or replaced forecast is not current even when its process succeeded',async t=>{const {root}=await fixture(t),previous=globalThis.fetch,url=process.env.SCIENCE_URL,token=process.env.SCIENCE_TOKEN;process.env.SCIENCE_URL='http://127.0.0.1:8766';process.env.SCIENCE_TOKEN='test';let status='committed';globalThis.fetch=async()=>Response.json({state:{snapshot:{model_id:'model-one'},source_model:{model_id:'source-one'},source_forecasts:{target:{status,source_model_id:'source-one',baseline_model_id:'model-one'}},source_receipts:[]}});t.after(()=>{globalThis.fetch=previous;if(url===undefined)delete process.env.SCIENCE_URL;else process.env.SCIENCE_URL=url;if(token===undefined)delete process.env.SCIENCE_TOKEN;else process.env.SCIENCE_TOKEN=token;});assert.equal((await readSourceInferenceContext({dataRoot:root,enabled:true})).forecast.current,true);status='scored';assert.equal((await readSourceInferenceContext({dataRoot:root,enabled:true})).forecast.current,false);status='stale';assert.equal((await readSourceInferenceContext({dataRoot:root,enabled:true})).forecast.authoritativeStatus,'stale');});
test('rest markers suppress recording instructions even when malformed',async t=>{const {root,dir}=await fixture(t);for(const marker of [JSON.stringify({sessionId:'session-one'}),'malformed-json']){await writeFile(join(dir,'astra-rest.json'),marker);const status=await readSourceInferenceContext({dataRoot:root,enabled:true});assert.equal(status.forecast.current,false);assert.equal(status.forecast.authoritativeStatus,'rest');assert.match(status.forecast.reason,/selected rest/);const compact=await readSourceInferenceContext({dataRoot:root,enabled:true,compact:true});assert.equal(compact.forecast.current,false);assert.equal(compact.forecast.descriptors,null);assert.match(compact.forecast.reason,/selected rest/);}});
