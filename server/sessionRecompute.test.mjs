import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
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
 const options={repo:process.cwd(),dataRoot:root,json:(response,code,body)=>replies.set(response,{code,body}),spawnImpl:()=>{const child=new EventEmitter();child.kill=()=>{};children.push(child);return child;}};
 return {root,replies,children,options,route:createSessionRecomputeRoutes(options)};
}
const first='replay-11111111-1111-4111-8111-111111111111';
const second='replay-22222222-2222-4222-8222-222222222222';
const run=new URL('http://localhost/api/session-recompute/run'),status=new URL('http://localhost/api/session-recompute/status');
async function poll(action,predicate){for(let i=0;i<100;i++){await action();if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Completion did not persist');}

test('bounded route reserves before body, persists hash-bound reports and reuses exact retry',async t=>{
 const {root,replies,children,route}=await fixture(t);
 let release;const gate=new Promise(resolve=>{release=resolve});
 const slow={...request(),async *[Symbol.asyncIterator](){await gate;yield Buffer.from(JSON.stringify({requestId:first,maxOperations:16}));}};
 const pending=route(slow,'first',run);
 await route(request({requestId:second,maxOperations:1}),'busy',run);assert.equal(replies.get('busy').code,409);
 release();await pending;assert.equal(replies.get('first').code,202);assert.equal(children.length,1);
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
