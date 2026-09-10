import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scienceRoutes} from './science.mjs';

test('active decisions retain geometry provenance and reject stale prepared captures',async()=>{
  const dataRoot=await mkdtemp(join(tmpdir(),'science-lineage-'));
  const oldUrl=process.env.SCIENCE_URL,oldToken=process.env.SCIENCE_TOKEN;
  process.env.SCIENCE_URL='http://127.0.0.1:1';process.env.SCIENCE_TOKEN='test-only';
  const put=(path,value)=>writeFile(join(dataRoot,path),JSON.stringify(value));
  let result;
  const route=scienceRoutes({repo:process.cwd(),dataRoot,json:(_,status,body)=>{result={status,body}}});
  const call=async(path,method='GET')=>{await route({method,headers:{},socket:{remoteAddress:'127.0.0.1'}},{},new URL('http://localhost/api/science/'+path));return result};
  try{
    await mkdir(join(dataRoot,'science-runs/run-test'),{recursive:true});
    await put('science-current.json',{status:'succeeded',runId:'run-test'});
    const forecast=(n)=>({design_id:'d'+n,target_observation_id:'o'+n,selected_experiment_id:'e'+n});
    await put('science-runs/run-test/summary.json',{sessionId:'s',modelId:'m1',designId:'d1',forecast:forecast(1),geometry:{native:true}});
    const original=await readFile(join(dataRoot,'science-runs/run-test/summary.json'),'utf8');
    for(const n of [2,3]){
      await put('science-runs/run-test/astra-current.json',{sessionId:'s',modelId:'m'+n,designId:'d'+n,forecast:forecast(n),decisionId:'decision'+n,sessionVersion:n});
      const status=await call('status');
      assert.equal(status.body.result.geometryModelId,'m1');
      assert.equal(status.body.result.modelId,'m'+n);
      assert.equal(status.body.result.forecast.design_id,'d'+n);
      await put('science-outcome-input.json',{sourceDirectory:'prepared-voice/example',design_id:'d'+(n-1),experiment_id:'e'+(n-1),observation_id:'o'+(n-1)});
      assert.equal((await call('outcome','POST')).status,409);
      assert.match(result.body.error,/different experiment/);
      await put('science-runs/run-test/outcome-current.json',{status:'succeeded',outcomeId:'outcome-old',designId:'d'+(n-1)});
      assert.equal((await call('outcome')).body.status,'not-run');
    }
    assert.equal(await readFile(join(dataRoot,'science-runs/run-test/summary.json'),'utf8'),original);
    await put('science-runs/run-test/astra-rest.json',{sessionId:'s',decisionId:'rest-1',createdAt:new Date().toISOString()});
    const resting=await call('status');
    assert.equal(resting.body.result.recordingAllowed,false);
    assert.equal(resting.body.result.restDecision.decisionId,'rest-1');
    assert.equal((await call('outcome','POST')).status,409);
    assert.match(result.body.error,/selected rest/);
    await rm(join(dataRoot,'science-runs/run-test/astra-rest.json'));
    assert.equal((await call('status')).body.result.restDecision,undefined);
    await put('science-runs/run-test/astra-current.json',{sessionId:'wrong',modelId:'m',designId:'d',forecast:forecast(3)});
    assert.equal((await call('status')).body.status,'failed');
  }finally{
    if(oldUrl===undefined)delete process.env.SCIENCE_URL;else process.env.SCIENCE_URL=oldUrl;
    if(oldToken===undefined)delete process.env.SCIENCE_TOKEN;else process.env.SCIENCE_TOKEN=oldToken;
    await rm(dataRoot,{recursive:true,force:true});
  }
});
