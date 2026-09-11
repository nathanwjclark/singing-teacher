import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSessionRecomputeRoutes} from './sessionRecompute.mjs';

const request=(body,method='POST')=>({method,headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'score-replay-route-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'science-runs/run-synthetic'),{recursive:true});
 await writeFile(join(root,'science-current.json'),JSON.stringify({status:'succeeded',runId:'run-synthetic'}));
 await writeFile(join(root,'science-runs/run-synthetic/summary.json'),JSON.stringify({sessionId:'synthetic-session'}));
 const replies=new Map(),children=[];
 const env={...process.env,SCIENCE_URL:'http://127.0.0.1:8766',SCIENCE_TOKEN:'fictional-worker-token',OPENAI_API_KEY:'fictional-provider-key'};
 const options={repo:process.cwd(),dataRoot:root,env,json:(response,code,body)=>replies.set(response,{code,body}),spawnImpl:(_command,_args,spawned)=>{const child=new EventEmitter();child.kill=()=>{};child.spawned=spawned;children.push(child);return child;}};
 return {root,replies,children,options,route:createSessionRecomputeRoutes(options)};
}
const first='replay-11111111-1111-4111-8111-111111111111';
const second='replay-22222222-2222-4222-8222-222222222222';
const run=new URL('http://localhost/api/session-recompute/run'),status=new URL('http://localhost/api/session-recompute/status');
async function poll(action,predicate){for(let i=0;i<1000;i++){await action();if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Completion did not persist');}

test('bounded route reserves before body, persists hash-bound reports and reuses exact retry',async t=>{
 const {root,replies,children,route}=await fixture(t);
 let release;const gate=new Promise(resolve=>{release=resolve});
 const slow={...request(),async *[Symbol.asyncIterator](){await gate;yield Buffer.from(JSON.stringify({requestId:first,maxOperations:16}));}};
 const pending=route(slow,'first',run);
 await route(request({requestId:second,maxOperations:1}),'busy',run);assert.equal(replies.get('busy').code,409);
 release();await pending;assert.equal(replies.get('first').code,202);assert.equal(children.length,1);
 // The verifier gets the worker address and token, never the provider key.
 const spawned=children[0].spawned.env;
 assert.equal(spawned.SCIENCE_URL,'http://127.0.0.1:8766');assert.equal(spawned.SCIENCE_TOKEN,'fictional-worker-token');assert.equal(spawned.PATH,process.env.PATH);
 assert.equal(spawned.OPENAI_API_KEY,undefined);assert.deepEqual(Object.keys(spawned).filter(key=>!['PATH','HOME','TMPDIR','SCIENCE_URL','SCIENCE_TOKEN','PYTHONPATH'].includes(key)),[]);
 await route(request(null,'GET'),'running',status);assert.equal(replies.get('running').body.status,'running');
 const dir=join(root,'replay-verifications',first),report={schemaVersion:'session-recomputation/1',attemptId:first,sessionId:'synthetic-session',runId:'run-synthetic',workerLedgerSha256:'a'.repeat(64),modelUpdated:false,rawMediaIncluded:false,operations:[],counts:{compared:0}};
 await writeFile(join(dir,'report.json'),JSON.stringify(report));children[0].emit('close',0);
 await poll(()=>route(request(null,'GET'),'saved',status),()=>replies.get('saved')?.body.status==='completed');
 assert.deepEqual(replies.get('saved').body.report,report);
 await route(request({requestId:first,maxOperations:16}),'retry',run);assert.equal(replies.get('retry').code,200);assert.equal(children.length,1);
 await route(request({requestId:first,maxOperations:1}),'changed',run);assert.equal(replies.get('changed').code,409);
 await writeFile(join(dir,'report.json'),JSON.stringify({...report,modelUpdated:true}));
 await route(request(null,'GET'),'tamper',status);assert.equal(replies.get('tamper').code,409);assert.match(replies.get('tamper').body.error,/integrity/);
});

test('restart exposes interrupted attempt and a new request completes without changing its evidence',async t=>{
 const {root,replies,children,options,route}=await fixture(t);
 await route(request({requestId:first,maxOperations:2}),'first',run);
 // Simulate exit without a usable numerical result and recover via a new server.
 children[0].emit('close',1);
 await poll(()=>route(request(null,'GET'),'failed',status),()=>replies.get('failed')?.body.status==='failed');
 const before=await readFile(join(root,'replay-verifications',first,'request.json'),'utf8');
 const restarted=createSessionRecomputeRoutes(options);
 await restarted(request({requestId:first,maxOperations:2}),'same',run);assert.equal(replies.get('same').code,409);
 await restarted(request({requestId:second,maxOperations:2}),'new',run);assert.equal(replies.get('new').code,202);children[1].emit('close',1);
 await poll(()=>restarted(request(null,'GET'),'done',status),()=>replies.get('done')?.body.status==='failed');
 assert.equal(await readFile(join(root,'replay-verifications',first,'request.json'),'utf8'),before);
});

test('invalid limits and nonlocal requests never launch a numerical worker',async t=>{
 const {route,replies,children}=await fixture(t);
 for(const maxOperations of [0,17,1.5]){await route(request({requestId:first,maxOperations}),'invalid',run);assert.equal(replies.get('invalid').code,409);}
 await route({...request({requestId:first,maxOperations:1}),socket:{remoteAddress:'192.0.2.1'}},'remote',run);
 assert.equal(replies.get('remote').code,403);assert.equal(children.length,0);
});

test('a verifier left by a stopped server blocks a second one until it exits, then the new server records it',async t=>{
 const {root,replies,options}=await fixture(t);
 // A real detached process stands in for the Python verifier, waiting for a release file.
 const gate=join(root,'release'),verifier=join(root,'verifier.sh');
 await writeFile(verifier,`#!/bin/sh\nwhile [ ! -e '${gate}' ]; do sleep 0.05; done\nexit 1\n`,{mode:0o755});
 const real={...options,env:{...process.env,SINGING_PYTHON:verifier}};delete real.spawnImpl;
 // The first server is a separate Node process that starts the verifier and exits.
 const started=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
import {createSessionRecomputeRoutes} from './server/sessionRecompute.mjs';
const route=createSessionRecomputeRoutes({repo:process.cwd(),dataRoot:${JSON.stringify(root)},env:{...process.env,SINGING_PYTHON:${JSON.stringify(verifier)}},json:(_r,code,body)=>{process.stdout.write(JSON.stringify({code,body}));process.exit(0);}});
await route({method:'POST',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({requestId:'${first}',maxOperations:2}));}},{},new URL('http://localhost/api/session-recompute/run'));
`],{cwd:process.cwd()}).toString());
 assert.equal(started.code,202);assert.ok(Number.isInteger(started.body.pid));
 t.after(()=>{try{process.kill(started.body.pid,'SIGKILL');}catch{}});
 const restarted=createSessionRecomputeRoutes(real);
 await restarted(request(null,'GET'),'orphan',status);
 assert.equal(replies.get('orphan').body.status,'running');assert.equal(replies.get('orphan').body.attemptId,first);
 await restarted(request({requestId:second,maxOperations:2}),'second',run);
 assert.equal(replies.get('second').code,409);assert.match(replies.get('second').body.error,/already running/);
 await writeFile(gate,'');
 await poll(()=>restarted(request(null,'GET'),'settled',status),()=>replies.get('settled')?.body.status==='failed');
 assert.equal(replies.get('settled').body.attemptId,first);
 await restarted(request({requestId:second,maxOperations:2}),'after',run);assert.equal(replies.get('after').code,202);
 await poll(()=>restarted(request(null,'GET'),'done',status),()=>replies.get('done')?.body.status==='failed'&&replies.get('done').body.attemptId===second);
});

test('status without a baseline model is unavailable with a plain reason, not a path',async t=>{
 const {root,replies,route}=await fixture(t);
 await rm(join(root,'science-current.json'));
 await route(request(null,'GET'),'none',status);
 assert.deepEqual(replies.get('none'),{code:200,body:{status:'unavailable',reason:'Complete a baseline voice model first'}});
});

test('the local app server mounts the recompute routes',{timeout:30_000},async t=>{
 const {root}=await fixture(t);
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const app=spawn(process.execPath,['server/local.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',LOCAL_DATA_DIR:root,SCIENCE_URL:'',SCIENCE_TOKEN:'',OPENAI_API_KEY:'',OPENAI_ENV_FILE:'/dev/null'},stdio:'ignore'});
 t.after(()=>app.kill('SIGTERM'));
 const base=`http://127.0.0.1:${port}/api/session-recompute`;
 let reply;for(let i=0;i<100&&!reply;i++){try{reply=await fetch(base+'/status');}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 assert.equal(reply.status,200);assert.deepEqual(await reply.json(),{status:'not-run',runId:'run-synthetic',sessionId:'synthetic-session'});
 const invalid=await fetch(base+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'bad',maxOperations:1})});
 assert.equal(invalid.status,409);assert.match((await invalid.json()).error,/one to sixteen/);
 assert.equal((await fetch(base+'/unknown')).status,405);
});

test('a live process that reused the recorded pid is not taken for the verifier',async t=>{
 const {root,replies,route}=await fixture(t);
 const dir=join(root,'replay-verifications',first);await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'request.json'),JSON.stringify({runId:'run-synthetic',sessionId:'synthetic-session',maxOperations:2}));
 const started=execFileSync('ps',['-o','lstart=','-p',String(process.pid)]).toString().trim();
 const record=processStartedAt=>writeFile(join(root,'session-recompute-current.json'),JSON.stringify({status:'running',attemptId:first,runId:'run-synthetic',sessionId:'synthetic-session',pid:process.pid,startedAt:new Date().toISOString(),processStartedAt}));
 // This test process exists; with its real start time it is the recorded process.
 await record(started);await route(request(null,'GET'),'same',status);assert.equal(replies.get('same').body.status,'running');
 // The same pid with another start time is a different process: the attempt is over.
 await record('Thu Jan  1 00:00:00 1970');await route(request(null,'GET'),'reused',status);
 assert.equal(replies.get('reused').body.status,'failed');assert.equal(replies.get('reused').body.attemptId,first);
});

test('when the verifier exits, a child it left running is stopped with it',async t=>{
 const {root,replies,options}=await fixture(t);
 // A real verifier stand-in that starts a long-running child (like the Node extractor
 // after a deadline kill) and exits without waiting for it.
 const verifier=join(root,'verifier.sh'),record=join(root,'child.pid');
 await writeFile(verifier,`#!/bin/sh\n/bin/sleep 60 &\necho $! > '${record}'\nexit 1\n`,{mode:0o755});
 const real={...options,env:{...process.env,SINGING_PYTHON:verifier}};delete real.spawnImpl;
 const route=createSessionRecomputeRoutes(real);
 await route(request({requestId:first,maxOperations:1}),'start',run);assert.equal(replies.get('start').code,202);
 await poll(()=>route(request(null,'GET'),'done',status),()=>replies.get('done')?.body.status==='failed');
 const child=Number(await readFile(record,'utf8'));
 t.after(()=>{try{process.kill(child,'SIGKILL');}catch{}});
 let gone=false;
 for(let i=0;i<250&&!gone;i++){try{process.kill(child,0);await new Promise(resolve=>setTimeout(resolve,20));}catch{gone=true;}}
 assert.ok(gone,'the verifier\'s child is still running');
});
