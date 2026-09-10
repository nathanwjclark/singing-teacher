import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scienceRoutes} from './science.mjs';
import {createVoiceCaptureRoutes} from './voiceCapture.mjs';
import {createHash} from 'node:crypto';

test('active decisions retain geometry provenance and reject stale prepared captures',async()=>{
  const dataRoot=await mkdtemp(join(tmpdir(),'science-lineage-'));
  const oldUrl=process.env.SCIENCE_URL,oldToken=process.env.SCIENCE_TOKEN;
  process.env.SCIENCE_URL='http://127.0.0.1:1';process.env.SCIENCE_TOKEN='test-only';
  const put=(path,value)=>writeFile(join(dataRoot,path),JSON.stringify(value));
  let result,workerState,workerUnavailable=false;
  const route=scienceRoutes({repo:process.cwd(),dataRoot,fetchImpl:async()=>{if(workerUnavailable)throw new Error('offline');return {ok:true,json:async()=>({state:workerState})}},json:(_,status,body)=>{result={status,body}}});
  const call=async(path,method='GET')=>{await route({method,headers:{},socket:{remoteAddress:'127.0.0.1'}},{},new URL('http://localhost/api/science/'+path));return result};
  try{
    await mkdir(join(dataRoot,'science-runs/run-test'),{recursive:true});
    await put('science-current.json',{status:'succeeded',runId:'run-test'});
    const forecast=(n)=>({design_id:'d'+n,target_observation_id:'o'+n,selected_experiment_id:'e'+n});
    await put('science-runs/run-test/summary.json',{sessionId:'s',modelId:'m1',designId:'d1',forecast:forecast(1),geometry:{native:true}});
    const original=await readFile(join(dataRoot,'science-runs/run-test/summary.json'),'utf8');
    const stateFor=n=>({snapshot:{model_id:'m'+n},designs:{['d'+n]:{status:'committed',data:{model_id:'m'+n,...forecast(n)}}}});
    workerState=stateFor(1);
    assert.equal((await call('status')).body.result.recordingAllowed,true);
    for(const n of [2,3]){
      workerState=stateFor(n);
      await put('science-runs/run-test/astra-current.json',{sessionId:'s',modelId:'m'+n,designId:'d'+n,forecast:forecast(n),decisionId:'decision'+n,sessionVersion:n});
      const status=await call('status');
      assert.equal(status.body.result.geometryModelId,'m1');
      assert.equal(status.body.result.modelId,'m'+n);
      assert.equal(status.body.result.forecast.design_id,'d'+n);
      assert.equal(status.body.result.recordingAllowed,true);
      await put('science-outcome-input.json',{sourceDirectory:'prepared-voice/example',design_id:'d'+(n-1),experiment_id:'e'+(n-1),observation_id:'o'+(n-1)});
      assert.equal((await call('outcome','POST')).status,409);
      assert.match(result.body.error,/different experiment/);
      await put('science-runs/run-test/outcome-current.json',{status:'succeeded',outcomeId:'outcome-old',designId:'d'+(n-1)});
      assert.equal((await call('outcome')).body.status,'not-run');
    }
    workerState=stateFor(4);
    assert.equal((await call('status')).body.result.recordingAllowed,false);
    assert.match(result.body.result.recordingMessage,/earlier model/);
    assert.equal((await call('outcome','POST')).status,409);
    workerState=stateFor(3);workerState.designs.d3.status='completed';
    assert.equal((await call('status')).body.result.recordingAllowed,false);
    assert.match(result.body.result.recordingMessage,/no longer committed/);
    await mkdir(join(dataRoot,'science-runs/run-test/outcomes/outcome-retained'),{recursive:true});
    await put('science-runs/run-test/outcomes/outcome-retained/summary.json',{status:'succeeded',modelUpdated:true});
    await put('science-runs/run-test/outcome-current.json',{status:'succeeded',outcomeId:'outcome-retained',designId:'d3'});
    assert.equal((await call('outcome')).body.result.modelUpdated,true);
    workerUnavailable=true;
    const unavailable=await call('status');
    assert.equal(unavailable.body.status,'succeeded');
    assert.equal(unavailable.body.result.recordingAllowed,false);
    assert.equal(unavailable.body.result.geometry.native,true);
    assert.match(unavailable.body.result.recordingMessage,/worker is unavailable/);
    const prepareRoute=createVoiceCaptureRoutes({repo:process.cwd(),dataRoot,json:(_,status,body)=>{result={status,body}}});
    const declaration=Buffer.from(JSON.stringify({purpose:'outcome',pose:'a',contains_external_excitation:false}));
    await prepareRoute({method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost','content-type':'application/json','content-length':String(declaration.length)},async *[Symbol.asyncIterator](){yield declaration}},{},new URL('http://localhost/api/science/use-latest-capture'));
    assert.equal(result.status,409);
    assert.match(result.body.error,/worker is unavailable/);
    // A completed receipt may be replayed even after its model/design ceased being current,
    // but only with the exact original request and retained configuration.
    const replayConfig={sourceDirectory:'prepared-voice/replay',design_id:'d3',experiment_id:'e3',observation_id:'o3'};
    const manifest='{}';
    await mkdir(join(dataRoot,replayConfig.sourceDirectory),{recursive:true});
    await writeFile(join(dataRoot,replayConfig.sourceDirectory,'manifest.json'),manifest);
    await put('science-outcome-input.json',replayConfig);
    await put('science-runs/run-test/outcomes/outcome-abcd-input.json',{design_id:'d3',experiment_id:'e3',observation_id:'o3'});
    const receipt={status:'succeeded',runId:'run-test',outcomeId:'outcome-abcd',designId:'d3',inputHash:createHash('sha256').update(JSON.stringify(replayConfig)).update(manifest).digest('hex')};
    await put('science-runs/run-test/outcome-current.json',receipt);
    const replay=await call('outcome','POST');
    assert.equal(replay.status,200);assert.equal(replay.body.outcomeId,'outcome-abcd');
    // Test HTTP dispatch identity separately from the real native interruption tests.
    const oldPython=process.env.SINGING_PYTHON;
    try{
      process.env.SINGING_PYTHON='/usr/bin/true';
      await put('science-runs/run-test/outcome-current.json',{...receipt,status:'failed'});
      const resumed=await call('outcome','POST');
      assert.equal(resumed.status,202);assert.equal(resumed.body.outcomeId,'outcome-abcd');
      for(let attempt=0;attempt<100;attempt++){
        const persisted=JSON.parse(await readFile(join(dataRoot,'science-runs/run-test/outcome-current.json'),'utf8'));
        if(persisted.status!=='running')break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(JSON.parse(await readFile(join(dataRoot,'science-runs/run-test/outcome-current.json'),'utf8')).status,'succeeded');
    }finally{if(oldPython===undefined)delete process.env.SINGING_PYTHON;else process.env.SINGING_PYTHON=oldPython}
    await put('science-runs/run-test/outcomes/outcome-abcd-input.json',{design_id:'changed'});
    assert.equal((await call('outcome','POST')).status,409);
    assert.match(result.body.error,/configuration changed/);
    await put('science-outcome-input.json',{...replayConfig,segment_index:1});
    assert.equal((await call('outcome','POST')).status,409);
    assert.match(result.body.error,/worker is unavailable/);
    workerUnavailable=false;workerState=stateFor(3);
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
