import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {MAX_FILE_BYTES, createSessionExportRoutes} from './sessionExport.mjs';
import {REPORT_BYTES} from './sessionRecompute.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'session-export-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const put = async (path, data) => { await mkdir(resolve(root, path, '..'), {recursive: true}); await writeFile(join(root, path), JSON.stringify(data)); };
  await put('science-current.json', {runId: 'run-one', status: 'succeeded'});
  await put('science-runs/run-one/summary.json', {runId: 'run-one', sessionId: 'session-one', modelId: 'original-model'});
  return {root, put};
}
function request(route, overrides = {}) {
  return route({method: 'GET', socket: {remoteAddress: '127.0.0.1'}, headers: {host: 'localhost:5173'}, ...overrides}, {}, new URL('http://localhost:5173/api/session-export'));
}
const replay = () => ({state: {session_id: 'session-one', version: 4, snapshot: {model_id: 'updated-model'}, attempts: [{attempt_id: 'attempt-1'}], jobs: [{result: {scores: [{standardized_rms: 3}]}, request: {parameters: {pcm: [1, 2, 3]}}}]}, events: [{sha256: 'b'.repeat(64), state: {parameters: {pcm: [1, 2]}}}], ledger_sha256: 'a'.repeat(64)});
const env = {SCIENCE_URL: 'http://127.0.0.1:8766', SCIENCE_TOKEN: 'fictional-worker-secret', OPENAI_API_KEY: 'fictional-api-secret'};

test('exports authoritative model plus bound receipts; preserves hashes and explicitly omits media/secrets', async t => {
  const {root, put} = await fixture(t);
  await put('astra-decisions/session-one/decision.json', {sessionId: 'session-one', runId: 'run-one', status: 'succeeded', api_key: env.OPENAI_API_KEY, input: JSON.stringify({pcm: [4, 5]})});
  await put('probe-fits/fit-one/summary.json', {sessionId: 'session-one', modelId: 'updated-model'});
  await put('probe-fits/fit-other/summary.json', {sessionId: 'different-session'});
  let output, calls = 0;
  const route = createSessionExportRoutes({dataRoot: root, env, json: (_r, status, data) => { output = {status, data}; }, fetchImpl: async (url, options) => {
    calls++; assert.equal(new URL(url).pathname, calls === 1 ? '/sessions/session-one/replay' : '/sessions/session-one/state'); assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined);
    return Response.json(replay());
  }});
  await request(route);
  assert.equal(output.status, 200); assert.equal(calls, 2);
  assert.equal(output.data.summary.modelId, 'updated-model'); assert.equal(output.data.summary.probeFitCount, 1);
  assert.equal(output.data.summary.decisionCount, 1); assert.equal(output.data.summary.scoreCount, 1);
  assert.equal(output.data.workerLedgerSha256, 'a'.repeat(64));
  const record = output.data.artifacts.find(a => a.source.endsWith('decision.json'));
  assert.equal(record.sha256, createHash('sha256').update(await readFile(join(root, record.source))).digest('hex'));
  assert.equal(output.data.replay.state.jobs[0].request.parameters.pcm.omitted, true);
  assert.equal(JSON.parse(record.data.input).pcm.omitted, true);
  assert.ok(output.data.omissions.length >= 3);
  assert.ok(!JSON.stringify(output.data).includes(env.OPENAI_API_KEY));
  assert.ok(!JSON.stringify(output.data).includes(env.SCIENCE_TOKEN));
  assert.ok(!JSON.stringify(output.data).includes('different-session'));
});

test('unavailable or foreign worker replay is explicit partial history, never a fabricated current model', async t => {
  const {root} = await fixture(t);
  for (const fetchImpl of [async () => {throw Error('offline');}, async () => Response.json({...replay(), state: {...replay().state, session_id: 'other'}})]) {
    let result;
    const route = createSessionExportRoutes({dataRoot: root, env, fetchImpl, json: (_r, status, data) => {result = {status, data};}});
    await request(route);
    assert.equal(result.status, 200); assert.equal(result.data.status, 'partial'); assert.equal(result.data.replay, null);
    assert.equal(result.data.summary.modelId, null); assert.equal(result.data.summary.sessionVersion, null);
    assert.ok(result.data.missing.some(row => row.source === 'worker/session-replay'));
  }
});

test('cross-origin/nonlocal writes and changing current run cannot export misleading data', async t => {
  const {root, put} = await fixture(t);
  let result, calls = 0;
  const route = createSessionExportRoutes({dataRoot: root, env, fetchImpl: async () => {calls++; await put('science-current.json', {runId: 'run-other', status: 'succeeded'}); return Response.json(replay());}, json: (_r, status, data) => {result = {status, data};}});
  await request(route, {method: 'POST'}); assert.equal(result.status, 405);
  await request(route, {socket: {remoteAddress: '10.0.0.2'}}); assert.equal(result.status, 403);
  await request(route, {headers: {host: 'localhost:5173', origin: 'https://foreign.example'}}); assert.equal(result.status, 403);
  assert.equal(calls, 0);
  await request(route); assert.equal(result.status, 409); assert.match(result.data.error, /changed/);
});

test('oversized optional receipt remains missing without breaking baseline replay', async t => {
  const {root, put} = await fixture(t);
  await put('learning-memory/session-one.json', {sessionId: 'session-one', text: 'x'.repeat(MAX_FILE_BYTES)});
  let result;
  const route = createSessionExportRoutes({dataRoot: root, env, fetchImpl: async () => Response.json(replay()), json: (_r, _s, data) => {result = data;}});
  await request(route); assert.equal(result.summary.modelId, 'updated-model'); assert.ok(result.missing.some(row => row.source.startsWith('learning-memory/')));
});

test('a model update during receipt collection returns a retryable conflict', async t => {
  const {root} = await fixture(t);
  let calls = 0, result;
  const route = createSessionExportRoutes({dataRoot: root, env, fetchImpl: async () => {
    const current = replay(); if (++calls > 1) {current.state.version++; current.ledger_sha256 = 'c'.repeat(64);} return Response.json(current);
  }, json: (_r, status, data) => {result = {status, data};}});
  await request(route); assert.equal(result.status, 409); assert.match(result.data.error, /session changed/);
});

test('real native fit/design/outcome replay reaches the read-only exporter', {timeout: 90000}, async t => {
  // node:test runs after-hooks in registration order: stop the worker before the
  // fixture removes the directory it is still writing to.
  const children = [];
  t.after(async () => { for (const child of children) child.kill('SIGTERM'); await Promise.all(children.map(child => new Promise(resolve => {if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => {child.kill('SIGKILL'); resolve();}, 2000).unref();}))); });
  const {root, put} = await fixture(t), repo = process.cwd();
  const python = process.env.SINGING_PYTHON || resolve(repo, 'science/.venv/bin/python');
  const childEnv = {...process.env, PYTHONPATH: repo + ':' + repo + '/science/src'};
  const script = `
import sys,json
from pathlib import Path
from science.tests.test_session import calibration,send,collect,design_params,now
from singing_physics.engine import Engine
from singing_physics.service import JobService
from singing_physics.session import SessionController
root=Path(sys.argv[1])
with JobService(root/'worker') as service:
 controller=SessionController(root/'worker/sessions',service,'session-one')
 send(controller,'ingest_calibration',document=calibration())
 send(controller,'search',parameters={'anatomy_bounds':{'hard_palate_length':[4.,4.8]},'nuisance_profiles':[{'profile_id':'declared','trials':{'cal':{'JA':-2.,'f0_hz':180.,'gain':.8}}}],'max_synthesis_calls':6,'rounds':1,'seed':7})
 collect(controller,service)
 send(controller,'propose_design',parameters=design_params())
 state=collect(controller,service)
 with Engine() as engine:
  engine.set_anatomy(state['snapshot']['hypotheses'][0]['anatomy'])
  pcm=(engine.synthesize('a',{'JA':-2.},f0_hz=180.,duration_s=.25)[4410:8506]*.8).tolist()
 send(controller,'submit_outcome',design_id='design',parameters={'experiment_id':'a','observation_id':'target','artifact_id':'later-audio','observed_at':now(),'pcm':pcm,'source_kind':'engine-generated'})
 collect(controller,service)
 (root/'reference.json').write_text(json.dumps(controller.execute({'action':'replay'})))
`;
  const setup = spawn(python, ['-c', script, root], {cwd: repo, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']}); children.push(setup);
  let errors = ''; setup.stderr.on('data', chunk => {errors += chunk;});
  const code = await new Promise((resolve, reject) => {setup.once('error', reject); setup.once('exit', resolve);});
  assert.equal(code, 0, errors);
  const reference = JSON.parse(await readFile(join(root, 'reference.json'), 'utf8'));
  await put('science-runs/run-one/outcomes/outcome-one/summary.json', {sessionId: 'session-one', modelId: reference.state.snapshot.model_id, scores: reference.state.jobs.at(-1).result.scores});
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const workerEnv = {...childEnv, SINGING_SCIENCE_TOKEN: 'a'.repeat(64)};
  const worker = spawn(python, ['-m', 'singing_physics.http_service', '--root', join(root, 'worker'), '--port', String(port)], {cwd: repo, env: workerEnv, stdio: ['ignore', 'pipe', 'pipe']}); children.push(worker);
  worker.stdout.resume(); worker.stderr.resume();
  const serviceEnv = {SCIENCE_URL: 'http://127.0.0.1:' + port, SCIENCE_TOKEN: 'a'.repeat(64)};
  let ready = false;
  for (let i = 0; i < 100; i++) {try {if ((await fetch(serviceEnv.SCIENCE_URL + '/health', {headers: {Authorization: 'Bearer ' + serviceEnv.SCIENCE_TOKEN}})).ok) {ready = true; break;}} catch {} await pause(100);}
  assert.ok(ready, 'native worker readiness');
  let output;
  const route = createSessionExportRoutes({dataRoot: root, env: serviceEnv, json: (_r, status, data) => {output = {status, data};}});
  await request(route);
  assert.equal(output.status, 200); assert.equal(output.data.workerLedgerSha256, reference.ledger_sha256);
  assert.equal(output.data.summary.modelId, reference.state.snapshot.model_id);
  assert.equal(output.data.summary.sessionVersion, reference.state.version);
  assert.equal(output.data.summary.eventCount, reference.events.length);
  assert.equal(output.data.summary.attemptCount, 1); assert.equal(output.data.summary.scoreCount, 1);
  assert.ok(output.data.omissions.some(row => row.path.endsWith('/pcm')));
  assert.ok(output.data.artifacts.some(row => row.source.includes('outcomes/outcome-one')));
});

test('motion export binds actual originals and excludes foreign or altered evidence', async t => {
 const {root,put}=await fixture(t), digest=b=>createHash('sha256').update(b).digest('hex');
 const record=Buffer.from('{"kind":"motion-observation"}'),media=Buffer.from('fixture media bytes');
 const recordSha=digest(record),mediaSha=digest(media),id=digest(recordSha+mediaSha);
 const capture={id,recordSha256:recordSha,mediaSha256:mediaSha,mediaByteLength:media.length};
 await put(`motion-captures/${id}/summary.json`,capture);
 await writeFile(join(root,`motion-captures/${id}/record.json`),record);
 await writeFile(join(root,`motion-captures/${id}/media`),media);
 const receiptSha=digest(await readFile(join(root,`motion-captures/${id}/summary.json`)));
 const result={kind:'motion-pcm-fit-1',captureId:id,sessionId:'session-one',modelId:'updated-model',modelUpdated:false,
  sourceHashes:{record:recordSha,media:mediaSha,receipt:receiptSha},temporalAnalysis:{status:'no-temporal-links'}};
 await put(`motion-analyses/${id}/analysis-one/summary.json`,result);
 await put(`motion-analyses/${id}/analysis-foreign/summary.json`,{...result,sessionId:'foreign-session'});
 let output;const route=createSessionExportRoutes({dataRoot:root,env,fetchImpl:async()=>Response.json(replay()),json:(_r,status,data)=>{output={status,data}}});
 await request(route);assert.equal(output.status,200);assert.equal(output.data.summary.motionAnalysisCount,1);
 const row=output.data.artifacts.find(a=>a.binding?.role==='conditional-motion-audio-analysis');
 assert.equal(row.binding.current,true);assert.equal(row.data.temporalAnalysis.status,'no-temporal-links');
 assert.ok(!JSON.stringify(output).includes('fixture media bytes'));assert.ok(!JSON.stringify(output).includes('foreign-session'));
 await writeFile(join(root,`motion-captures/${id}/media`),'changed');await request(route);
 assert.equal(output.data.summary.motionAnalysisCount,0);assert.ok(output.data.missing.some(a=>a.source.includes('analysis-one')));
});

test('LiDAR export binds original archive and authoritative adoption, including rejected attempts',async t=>{
 const {root,put}=await fixture(t),original=Buffer.from('synthetic archive transport fixture');
 const sha=createHash('sha256').update(original).digest('hex');
 await mkdir(join(root,'lidar-imports',sha),{recursive:true});await writeFile(join(root,'lidar-imports',sha,'original.zip'),original);
 const declaration={sourceKind:'development-fixture'},dh=createHash('sha256').update(JSON.stringify(declaration)).digest('hex');
 const scientific=replay(),result={status:'ranked',with_depth_order:['candidate'],rankings:[],annotation:{registration:{source_hashes:[dh]},correspondence:{source_hashes:[dh]}}};
 const adoption={job_id:'depth-job',status:'adopted',model_updated:true,model_id:'updated-model'};
 scientific.state.jobs.push({job_id:'depth-job',request:{operation:'rank_lidar_hypotheses'},result});scientific.state.lidar_fusions=[adoption];
 await put('lidar-fits/fit-one/summary.json',{fitId:'fit-one',sessionId:'session-one',modelId:'updated-model',jobId:'depth-job',importId:sha,archiveSha256:sha,result,adoption});
 await put('lidar-fits/fit-one/experimental-declaration.json',declaration);
 let output;const route=createSessionExportRoutes({dataRoot:root,env,fetchImpl:async()=>Response.json(scientific),json:(_r,status,data)=>{output={status,data}}});
 await request(route);assert.equal(output.status,200);assert.equal(output.data.summary.lidarFusionCount,1);
 assert.equal(output.data.artifacts.find(a=>a.source==='lidar-fits/fit-one/summary.json').binding.originalBytesVerified,true);
 assert.ok(output.data.artifacts.some(a=>a.source.endsWith('experimental-declaration.json')));
 await put('lidar-fits/fit-one/experimental-declaration.json',{sourceKind:'tampered'});
 await request(route);assert.ok(!output.data.artifacts.some(a=>a.source.endsWith('experimental-declaration.json')));assert.ok(output.data.missing.some(a=>a.source.endsWith('experimental-declaration.json')));
 scientific.state.lidar_fusions[0]={...adoption,status:'rejected',model_updated:false};
 await request(route);assert.ok(!output.data.artifacts.some(a=>a.binding?.role==='experimental-lidar-fusion'));
 scientific.state.lidar_fusions=[adoption];await writeFile(join(root,'lidar-imports',sha,'original.zip'),'changed');
 await request(route);assert.ok(output.data.missing.some(a=>a.source==='lidar-fits/fit-one/summary.json'));assert.ok(!output.data.artifacts.some(a=>a.binding?.role==='experimental-lidar-fusion'));
});

test('exports only session-bound visual results with freshly verified original media',async t=>{
 const {root,put}=await fixture(t), scientific=replay();
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const record=Buffer.from('{}'),media=Buffer.from('original-video-fixture');
 const recordHash=hash(record),mediaHash=hash(media),captureId=hash(recordHash+mediaHash);
 const prefix=`motion-captures/${captureId}`;await mkdir(join(root,prefix),{recursive:true});
 await writeFile(join(root,prefix,'record.json'),record);await writeFile(join(root,prefix,'media'),media);
 const original={id:captureId,recordSha256:recordHash,mediaSha256:mediaHash,mediaByteLength:media.length};
 await put(`${prefix}/summary.json`,original);
 const envelope={sha256:'f'.repeat(64),artifact:{model_id:'updated-model',targets:[],calibration_status:'scored'}};
 scientific.state.visual_forecasts={f:{baseline_model_id:'updated-model',artifact:envelope,status:'committed'}};
 scientific.state.visual_receipts=[{forecast_id:'f',job_id:'visual',operation:'freeze_visual_forecast',status:'succeeded',baseline_model_id:'updated-model'}];
 scientific.state.jobs.push({job_id:'visual',status:'succeeded',request:{operation:'freeze_visual_forecast'},result:envelope});
 await put('visual-runs/visual-one/summary.json',{operation:'freeze',forecastId:'f',sessionId:'session-one',baselineModelId:'updated-model',
 result:envelope,modelUpdated:false,captureId,sourceHashes:{record:recordHash,media:mediaHash,receipt:hash(JSON.stringify(original))}});
 let output;const route=createSessionExportRoutes({dataRoot:root,env,json:(_r,status,data)=>{output={status,data};},fetchImpl:async()=>Response.json(scientific)});
 await request(route);assert.equal(output.status,200);assert.equal(output.data.summary.visualResultCount,1);
 await writeFile(join(root,prefix,'media'),'changed');await request(route);
 assert.equal(output.data.summary.visualResultCount,0);
 assert.ok(output.data.missing.some(r=>r.source==='visual-runs/visual-one/summary.json'));
});

test('exports the latest score recomputation only while its report matches the receipt',async t=>{
  const {root,put}=await fixture(t);
  const attempt='replay-11111111-1111-4111-8111-111111111111',dir=`replay-verifications/${attempt}`;
  const report={schemaVersion:'session-recomputation/1',attemptId:attempt,runId:'run-one',sessionId:'session-one',workerLedgerSha256:'c'.repeat(64),modelUpdated:false,rawMediaIncluded:false,
    counts:{total:3,matched:1,failed:1,unavailable:0,unsupported:1,skipped:0,policyVerified:1,legacyVersionUnverified:0},operations:[]};
  const bytes=JSON.stringify(report),receipt={status:'completed',attemptId:attempt,runId:'run-one',sessionId:'session-one',workerLedgerSha256:'c'.repeat(64),
    reportSha256:createHash('sha256').update(bytes).digest('hex'),reportByteLength:Buffer.byteLength(bytes)};
  await put(dir+'/report.json',report);await put(dir+'/receipt.json',receipt);await put('session-recompute-current.json',receipt);
  const exported=async()=>{let output;await request(createSessionExportRoutes({dataRoot:root,env,json:(_r,status,data)=>{output={status,data};},fetchImpl:async()=>Response.json(replay())}));assert.equal(output.status,200);return output.data;};
  let data=await exported(),artifact=data.artifacts.find(a=>a.source===dir+'/report.json');
  assert.deepEqual(artifact.data.counts,report.counts);
  assert.deepEqual(artifact.binding,{sessionId:'session-one',role:'read-only-score-recomputation',modelUpdated:false,current:false});
  assert.ok(!data.missing.some(row=>row.source.startsWith('replay-verifications')));
  // A report edited after its receipt was written is excluded and reported missing.
  await put(dir+'/report.json',{...report,counts:{...report.counts,matched:2,failed:0}});
  data=await exported();
  assert.ok(!data.artifacts.some(a=>a.source.startsWith('replay-verifications/')));
  assert.match(data.missing.find(row=>row.source===dir).reason,/invalid, unbound/);
  // A completed index whose report file is gone is recorded as missing, not skipped.
  await put(dir+'/report.json',report);await rm(join(root,dir,'report.json'));
  data=await exported();
  assert.ok(!data.artifacts.some(a=>a.source.startsWith('replay-verifications/')));
  assert.deepEqual(data.missing.find(row=>row.source===dir),{source:dir,reason:'Completed score recomputation receipt or report is missing'});
  // Reports may reach the verifier's cap (REPORT_BYTES), above the limit for other receipts.
  const large={...report,operations:[{jobId:'x',padding:'p'.repeat(MAX_FILE_BYTES)}]},largeBytes=JSON.stringify(large);
  assert.ok(MAX_FILE_BYTES<Buffer.byteLength(largeBytes)&&Buffer.byteLength(largeBytes)<=REPORT_BYTES);
  const largeReceipt={...receipt,reportSha256:createHash('sha256').update(largeBytes).digest('hex'),reportByteLength:Buffer.byteLength(largeBytes)};
  await put(dir+'/report.json',large);await put(dir+'/receipt.json',largeReceipt);await put('session-recompute-current.json',largeReceipt);
  data=await exported();
  assert.equal(data.artifacts.find(a=>a.source===dir+'/report.json').byteLength,largeReceipt.reportByteLength);
  // A receipt for another session is not this session's check and not missing evidence.
  await put('session-recompute-current.json',{...largeReceipt,sessionId:'session-two'});
  data=await exported();
  assert.ok(!data.artifacts.some(a=>a.source.startsWith('replay-verifications/')));
  assert.ok(!data.missing.some(row=>row.source.startsWith('replay-verifications')));
});

test('binds cue-execution forecast, score and stop receipts to the ledger and the retained original manifest',async t=>{
 const {root,put}=await fixture(t),scientific=replay(),hash=x=>createHash('sha256').update(x).digest('hex');
 const manifest=Buffer.from('{"capture_id":"fictional-control-capture"}'),manifestSha=hash(manifest);
 const forecast={sha256:'c'.repeat(64),artifact:{kind:'frozen-control-pcm',target_id:'target'}};
 const score={sha256:'d'.repeat(64),artifact:{kind:'scored-control-pcm',observation_hashes:[manifestSha],control_support:{}}};
 scientific.state.control_forecasts={target:{artifact:forecast,status:'scored',binding_id:'cue-one',baseline_model_id:'updated-model'},stopped:{artifact:forecast,status:'stopped',binding_id:'cue-one',baseline_model_id:'updated-model'}};
 scientific.state.control_receipts=[{operation:'forecast_control_pcm',job_id:'forecast-job',forecast_id:'target',binding_id:'cue-one',status:'available',result:null},
  {operation:'score_control_pcm',job_id:'score-job',forecast_id:'target',binding_id:'cue-one',status:'scored',result:score},
  {operation:'record_control_attempt',forecast_id:'stopped',binding_id:'cue-one',status:'stopped',result:null}];
 const base={sessionId:'session-one',bindingId:'cue-one',baselineModelId:'updated-model',modelUpdated:false};
 await put('science-runs/run-one/control-attempts/forecast-one/result.json',{...base,phase:'forecast',forecastId:'target',result:forecast});
 await put('science-runs/run-one/control-attempts/score-one/result.json',{...base,phase:'score',forecastId:'target',jobId:'score-job',result:score,source_manifest_sha256:manifestSha});
 await mkdir(join(root,'science-runs/run-one/control-attempts/score-one/original'),{recursive:true});
 await writeFile(join(root,'science-runs/run-one/control-attempts/score-one/original/manifest.json'),manifest);
 await put('science-runs/run-one/control-attempts/stop-one/result.json',{...base,phase:'stop',forecastId:'stopped'});
 await put('science-runs/run-one/control-attempts/forged-one/result.json',{...base,phase:'score',forecastId:'target',jobId:'score-job',result:{...score,sha256:'e'.repeat(64)},source_manifest_sha256:manifestSha});
 await put('science-runs/run-one/control-attempts/foreign-one/result.json',{...base,sessionId:'other-session',phase:'forecast',forecastId:'target',result:forecast});
 let output;const route=createSessionExportRoutes({dataRoot:root,env,json:(_r,status,data)=>{output={status,data};},fetchImpl:async()=>Response.json(scientific)});
 await request(route);assert.equal(output.status,200);assert.equal(output.data.summary.controlScoreCount,1);
 const roles=output.data.artifacts.filter(a=>a.binding?.role?.startsWith('cue-execution-')).map(a=>[a.binding.role,a.binding.originalBytesVerified,a.binding.modelUpdated]);
 assert.deepEqual(roles.sort(),[['cue-execution-forecast',false,false],['cue-execution-score',true,false],['cue-execution-stop',false,false]]);
 assert.ok(output.data.missing.some(r=>r.source.endsWith('forged-one/result.json')));
 assert.ok(!output.data.artifacts.some(a=>a.source.includes('foreign-one')));
 await writeFile(join(root,'science-runs/run-one/control-attempts/score-one/original/manifest.json'),'changed');
 await request(route);
 assert.ok(output.data.missing.some(r=>r.source.endsWith('score-one/result.json')));
 assert.ok(!output.data.artifacts.some(a=>a.binding?.role==='cue-execution-score'));
});
