import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createSessionExportRoutes} from './sessionExport.mjs';

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
  await put('learning-memory/session-one.json', {sessionId: 'session-one', text: 'x'.repeat(2 * 1024 * 1024)});
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
  const {root, put} = await fixture(t), repo = process.cwd();
  const python = process.env.SINGING_PYTHON || resolve(repo, 'science/.venv/bin/python');
  const children = [];
  t.after(async () => { for (const child of children) child.kill('SIGTERM'); await Promise.all(children.map(child => new Promise(resolve => {if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(() => {child.kill('SIGKILL'); resolve();}, 2000).unref();}))); });
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
