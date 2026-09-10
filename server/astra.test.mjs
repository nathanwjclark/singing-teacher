import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createAstraRoutes} from './astra.mjs';

async function setup(t,{decide,callBudget=6}={}){
 const root=await mkdtemp(join(tmpdir(),'astra-routes-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const originalEnv={url:process.env.SCIENCE_URL,token:process.env.SCIENCE_TOKEN};process.env.SCIENCE_URL='http://127.0.0.1:8766';process.env.SCIENCE_TOKEN='private';t.after(()=>{for(const [key,value] of [['SCIENCE_URL',originalEnv.url],['SCIENCE_TOKEN',originalEnv.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const directory=join(root,'science-runs','run-one');await mkdir(directory,{recursive:true});await writeFile(join(root,'science-current.json'),JSON.stringify({status:'succeeded',runId:'run-one'}));
 const forecast={design_id:'initial',model_id:'model-one',target_observation_id:'target',rankings:[{experiment:{experiment_id:'a',pose:'a'},predictions:[{features:{brightness:3}}],status:'insufficient_distinct_hypotheses'}],feature_scales:{},minimum_separation:.05,retention_margin:.05,maximum_discrepancy:2,profile:{sample_rate_hz:44100}};
 await writeFile(join(directory,'summary.json'),JSON.stringify({sessionId:'session-one',forecast,source:'development-fixture',eligibleWindows:1,calibrationWindows:1}));
 let state={version:2,snapshot:{model_id:'model-one',hypotheses:[{hypothesis_id:'one',anatomy:{}}],evidence_ids:['voice']},pending:null,designs:{initial:{status:'unsupported',data:forecast}},attempts:[],sensations:[],jobs:[]},calls=0;const commands=[];
 const provider={getProviderStatus:()=>({available:true,configured:true,provider:'api',model:'gpt-6-astra'}),generateDecision:async args=>{calls++;return {decision:decide?await decide(args,state):{action:'record',experimentId:'a',cue:'Sing a comfortable ah.',explanation:'Compare the predicted vowel response.'},provider:'api',model:'gpt-6-astra',usage:{inputTokens:12}};}};
 const fetchImpl=async(url,options)=>{const path=new URL(url).pathname;if(path.endsWith('/state'))return Response.json({state});if(path.endsWith('/commands')){const c=JSON.parse(options.body);commands.push(c);assert.equal(c.expected_version,state.version);state.version++;if(c.action==='select_experiment'){state.designs[c.source_design_id].status='superseded';state.designs[c.design_id]={status:'committed',data:{...forecast,model_id:state.snapshot.model_id,design_id:c.design_id,target_observation_id:c.target_observation_id,selected_experiment_id:c.experiment_id}};}else if(c.action==='propose_design'){state.pending={job_id:'job-new'};}else if(c.action==='collect_job'){const proposed=commands.findLast(v=>v.action==='propose_design').parameters;state.pending=null;state.designs[proposed.design_id]={status:'unsupported',data:{...forecast,model_id:state.snapshot.model_id,design_id:proposed.design_id}};}return Response.json({state});}if(path==='/jobs/job-new')return Response.json({status:'succeeded'});throw Error(path);};
 let response;const route=createAstraRoutes({dataRoot:root,json:(_res,status,data)=>{response={status,data:JSON.parse(JSON.stringify(data))};},provider,fetchImpl,callBudget});
 async function request(payload,path='/api/astra/decide',headers={}){const req=Readable.from(payload===undefined?[]:[JSON.stringify(payload)]);req.method=payload===undefined?'GET':'POST';req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:3000',...headers};await route(req,{},new URL(path,'http://localhost:3000'));return response;}
 return {request,root,directory,commands,state,calls:()=>calls};
}

test('decision commits actual forecast selection, preserves original summary, and replays without billing',async t=>{const s=await setup(t);const before=await readFile(join(s.directory,'summary.json'),'utf8');const a=await s.request({requestId:'one'});assert.equal(a.status,200);assert.equal(a.data.designId,'astra-design-one');assert.equal(s.commands[0].action,'select_experiment');const pointer=JSON.parse(await readFile(join(s.directory,'astra-current.json'),'utf8'));assert.equal(pointer.forecast.selected_experiment_id,'a');assert.equal(pointer.modelId,'model-one');assert.equal(await readFile(join(s.directory,'summary.json'),'utf8'),before);assert.deepEqual(await s.request({requestId:'one'}),a);assert.equal(s.calls(),1);assert.equal((await s.request({requestId:'one',goal:'different'})).status,409);});
test('updated model generates a fresh forecast before asking for and committing the next decision',async t=>{const s=await setup(t);s.state.snapshot.model_id='model-two';s.state.designs.initial.status='completed';assert.equal((await s.request({requestId:'second'})).status,200);assert.deepEqual(s.commands.map(c=>c.action),['propose_design','collect_job','select_experiment']);assert.equal(s.commands[0].parameters.max_synthesis_calls,1);});
test('unsupported actions consume bounded attempt budget without committing a capture',async t=>{const s=await setup(t,{callBudget:1,decide:()=>({action:'record',experimentId:'unknown',cue:'bad',explanation:'bad'})});assert.equal((await s.request({requestId:'bad'})).status,502);assert.equal(s.commands.length,0);assert.equal((await s.request({requestId:'bad'})).status,409);assert.equal((await s.request({requestId:'new'})).status,429);assert.equal(s.calls(),1);});
test('rest and concurrent state changes never publish a new capture design',async t=>{const s=await setup(t,{decide:()=>({action:'rest',experimentId:null,cue:'Rest your voice.',explanation:'Stop for discomfort.'})});assert.equal((await s.request({requestId:'rest'})).data.designId,null);assert.equal(s.commands.length,0);await assert.rejects(readFile(join(s.directory,'astra-current.json')));const status=await s.request(undefined,'/api/astra/status');assert.equal(status.data.remainingCalls,5);assert.equal(status.data.latest.decision.action,'rest');});
test('stale session and foreign origin reject writes',async t=>{const s=await setup(t,{decide:(_args,state)=>{state.version++;return {action:'record',experimentId:'a',cue:'ah',explanation:'test'};}});assert.equal((await s.request({requestId:'stale'})).status,409);assert.equal(s.commands.length,0);assert.equal((await s.request({requestId:'evil'},'/api/astra/decide',{origin:'https://evil.example'})).status,403);});
test('restart after scientific selection restores publication without a second provider call',async t=>{const s=await setup(t);assert.equal((await s.request({requestId:'recover'})).status,200);const path=join(s.root,'astra-decisions','session-one','recover.json'),receipt=JSON.parse(await readFile(path,'utf8'));receipt.status='running';await writeFile(path,JSON.stringify(receipt));await rm(join(s.directory,'astra-current.json'));assert.equal((await s.request({requestId:'recover'})).status,200);assert.equal(s.calls(),1);assert.equal(JSON.parse(await readFile(join(s.directory,'astra-current.json'),'utf8')).decisionId,'recover');});
test('unfinished Astra forecast resumes under a new browser request, unrelated jobs are not collected',async t=>{const s=await setup(t);s.state.snapshot.model_id='model-two';s.state.designs.initial.status='completed';const parameters={design_id:'astra-forecast-resume',target_observation_id:'astra-target-resume'};s.commands.push({action:'propose_design',parameters});s.state.pending={job_id:'job-new',request:{operation:'design_pcm',parameters}};assert.equal((await s.request({requestId:'after-reload'})).status,200);assert.deepEqual(s.commands.map(c=>c.action),['propose_design','collect_job','select_experiment']);assert.equal(s.commands[1].command_id,'astra-resume-collect_job');assert.equal(s.commands[2].source_design_id,'astra-forecast-resume');s.state.pending={job_id:'other',request:{operation:'update_pcm',parameters:{}}};assert.equal((await s.request({requestId:'another'})).status,409);s.state.pending={job_id:'other',request:{operation:'design_pcm',parameters:{design_id:'astra-forecast-foreign',target_observation_id:'unrelated'}}};assert.equal((await s.request({requestId:'again'})).status,409);assert.equal(s.calls(),1);});

test('status separates unfinished and failed attempts from the latest successful decision',async t=>{
 const s=await setup(t),dir=join(s.root,'astra-decisions','session-one');await mkdir(dir,{recursive:true});
 const runningReceipt={requestId:'pending',status:'running',createdAt:'2099-01-01T00:00:00.000Z'};
 await writeFile(join(dir,'pending.json'),JSON.stringify(runningReceipt));
 let status=(await s.request(undefined,'/api/astra/status')).data;
 assert.equal(status.latest,null);assert.equal(status.latestCurrent,false);assert.deepEqual(status.latestAttempt,{requestId:'pending',status:'running'});
 await writeFile(join(dir,'pending.json'),JSON.stringify({...runningReceipt,status:'failed',error:'Decision did not complete'}));
 assert.equal((await s.request({requestId:'good'})).status,200);
 status=(await s.request(undefined,'/api/astra/status')).data;
 assert.equal(status.latest.requestId,'good');assert.equal(status.latest.decision.action,'record');assert.equal(status.latestCurrent,true);
 assert.equal(status.latestAttempt.status,'failed');assert.equal(status.latestAttempt.requestId,'pending');assert.equal(status.remainingCalls,4);
});

test('status stops advertising a committed recording after outcome, probe model update, stop or worker loss',async t=>{
 const s=await setup(t);await s.request({requestId:'selected'});
 const get=async()=>(await s.request(undefined,'/api/astra/status')).data;
 assert.equal((await get()).latestCurrent,true);
 for(const status of ['outcome_pending','completed','stale','stopped','failed']){
  s.state.designs['astra-design-selected'].status=status;
  const report=await get();assert.equal(report.latestCurrent,false);assert.equal(report.latestDesignStatus,status);assert.equal(report.latest.requestId,'selected');
 }
 s.state.designs['astra-design-selected'].status='committed';s.state.snapshot.model_id='probe-updated-model';
 assert.equal((await get()).latestCurrent,false);assert.equal((await get()).currentModelId,'probe-updated-model');
 s.state.snapshot.model_id='model-one';delete process.env.SCIENCE_URL;
 const unavailable=await get();assert.equal(unavailable.latestCurrent,false);assert.match(unavailable.error,/unavailable/);
});
test('first-run status explains how to begin without exposing a path or calling the provider',async t=>{const s=await setup(t);await rm(join(s.root,'science-current.json'));const status=await s.request(undefined,'/api/astra/status');assert.equal(status.status,200);assert.equal(status.data.provider.available,true);assert.equal(status.data.sessionId,null);assert.equal(status.data.error,'Import a voice capture and fit the scientific model before asking Astra');assert.ok(!JSON.stringify(status).includes(s.root));assert.equal((await s.request({requestId:'too-early'})).status,409);assert.equal(s.calls(),0);await writeFile(join(s.root,'science-current.json'),'invalid-json');const corrupt=await s.request(undefined,'/api/astra/status');assert.notEqual(corrupt.data.error,status.data.error);assert.equal(s.calls(),0);});

test('Astra receives bound current motion evidence and rejects altered or stale originals',async t=>{
 const {createHash}=await import('node:crypto');const hash=b=>createHash('sha256').update(b).digest('hex');let received;
 const s=await setup(t,{decide:args=>{received=args.input.motionAudio;return {action:'rest',experimentId:null,cue:'Rest.',explanation:'Inspect conditional evidence.'}}});
 const record=Buffer.from('{"kind":"motion-observation"}'),media=Buffer.from('encoded-fixture-bytes'),rh=hash(record),mh=hash(media),id=hash(rh+mh);
 const put=async(path,value)=>{await mkdir(join(s.root,path,'..'),{recursive:true});await writeFile(join(s.root,path),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 const receipt={id,recordSha256:rh,mediaSha256:mh,mediaByteLength:media.length};
 await put(`motion-captures/${id}/summary.json`,receipt);await put(`motion-captures/${id}/record.json`,record);await put(`motion-captures/${id}/media`,media);
 await put('motion-latest.json',{id});await put(`motion-analyses/${id}/current.json`,{status:'succeeded',captureId:id,expectedModelId:'model-one',analysisId:'analysis-one',pose:'a'});
 await put(`motion-analyses/${id}/analysis-one/summary.json`,{kind:'motion-pcm-fit-1',status:'available',captureId:id,pose:'a',sessionId:'session-one',modelId:'model-one',modelUpdated:false,
 sourceHashes:{record:rh,media:mh,receipt:hash(JSON.stringify(receipt))},windows:[{index:0,status:'scored',fit:{joint:{candidates:[{candidate_id:'actual-candidate',status:'scored',weighted_mean_square_discrepancy:.25}]}}}],assumptions:['fixed controls']});
 assert.equal((await s.request({requestId:'motion-current'})).status,200);assert.equal(received.windows[0].candidates[0].discrepancy,.25);assert.equal(received.modelId,'model-one');assert.ok(!JSON.stringify(received).includes('encoded-fixture-bytes'));
 const {readMotionContext}=await import('./motionContext.mjs');
 assert.equal((await readMotionContext({dataRoot:s.root,sessionId:'session-one',modelId:'other'})).status,'unavailable');
 assert.equal((await readMotionContext({dataRoot:s.root,sessionId:'other',modelId:'model-one'})).status,'unavailable');
 await put(`motion-captures/${id}/media`,'altered');assert.equal((await readMotionContext({dataRoot:s.root,sessionId:'session-one',modelId:'model-one'})).status,'unavailable');
});

test('Astra receives adopted depth ordering and distinguishes historical contribution',async t=>{
 let context;const s=await setup(t,{decide:args=>{context=args.input.lidar;return {action:'rest',experimentId:null,cue:'Rest.',explanation:'Inspect depth-conditioned hypotheses.'}}});
 const sha='a'.repeat(64),fusion={job_id:'depth-job',result_sha256:sha,source_evidence_id:'depth-frame',source_manifest_sha256:sha,source_kind:'development-fixture',baseline_model_id:'before-depth',scan_pose:'a',scan_JA_values:[-3],scan_JA_weights:[1],without_depth_order:['one'],with_depth_order:['one'],rankings:[{hypothesis_id:'one',depth_discrepancy:.1,predictions:[{JA_requested:-3,weight:1,distance_m:.025}]}]};
 s.state.snapshot.lidar_fusion=fusion;s.state.snapshot.evidence_ids.push('depth-frame');s.state.snapshot.evidence_hashes=[sha];
 s.state.lidar_fusions=[{status:'adopted',job_id:'depth-job',result_sha256:sha,model_id:'model-one',model_updated:true}];
 assert.equal((await s.request({requestId:'depth-context'})).status,200);
 assert.equal(context.rankingIsCurrent,true);assert.equal(context.rankings[0].predictions[0].distanceMeters,.025);assert.match(context.evidenceVerification,/at adoption/);
 const {lidarContextFromState}=await import('./lidarContext.mjs');
 s.state.snapshot.model_id='later-acoustic-model';assert.equal(lidarContextFromState(s.state,{enabled:true}).rankingIsCurrent,false);
 s.state.snapshot.evidence_hashes=[];assert.equal(lidarContextFromState(s.state,{enabled:true}).status,'unavailable');
 assert.equal(lidarContextFromState({}, {enabled:false}).status,'disabled');
});

test('Astra receives optional visual context with explicit unchanged anatomy semantics',async t=>{
 let visual;const app=await setup(t,{decide:async({input})=>{visual=input.visual;return {action:'rest',experimentId:null,cue:'Rest comfortably.',explanation:'No new measurement is available.'};}});
 const response=await app.request({requestId:'visual-context'});
 assert.equal(response.status,200);assert.equal(visual.modelUpdated,false);assert.deepEqual(visual.forecasts,[]);
 assert.match(visual.interpretation,/not measured internal anatomy/);
});
