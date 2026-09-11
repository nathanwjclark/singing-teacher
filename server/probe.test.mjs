import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {createProbeRoutes} from './probe.mjs';

test('probe routes reject remote use and report interrupted work without fabricated acceptance',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'probe-route-'));
 try{
  await writeFile(join(dataRoot,'probe-current.json'),JSON.stringify({running:true,requestId:'old'}));
  let reply;
  const routes=createProbeRoutes({repo:process.cwd(),dataRoot,json:(_res,status,body)=>{reply={status,body};}});
  async function call(path,method='GET',body='',remote='127.0.0.1'){
   const req=Readable.from(body?[Buffer.from(body)]:[]);req.method=method;req.socket={remoteAddress:remote};req.headers={host:'localhost:5173'};
   await routes(req,{},new URL(path,'http://localhost:5173'));return reply;
  }
  assert.equal((await call('/api/probe/status','GET','','192.0.2.10')).status,403);
  const status=await call('/api/probe/status');
  assert.equal(status.status,200);assert.equal(status.body.canFit,false);
  assert.match(status.body.error,/interrupted/);
  assert.equal(JSON.parse(await readFile(join(dataRoot,'probe-current.json'))).running,false);
  assert.equal((await call('/api/probe/fit','POST',JSON.stringify({requestId:'new',importId:'../bad',expectedModelId:'model'}))).status,400);
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});

test('server restart automatically resumes saved fit folder and manual retry preserves original model binding',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'probe-resume-'));
 try{
  const folder=join(dataRoot,'probe-fits','fit');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'intent.json'),JSON.stringify({parentModelId:'original'}));
  await writeFile(join(dataRoot,'probe-current.json'),JSON.stringify({operation:'fit',running:true,requestId:'old',fitId:'fit',importId:'import',expectedModelId:'original'}));
  let reply,release;const calls=[];
  const routes=createProbeRoutes({repo:process.cwd(),dataRoot,json:(_r,status,body)=>{reply={status,body};},
   runProcess:(_python,args)=>{calls.push(args);return new Promise(resolve=>{release=resolve;});}});
  async function call(path,method='GET',body=''){
   const req=Readable.from(body?[Buffer.from(body)]:[]);req.method=method;req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:5173'};
   await routes(req,{},new URL(path,'http://localhost:5173'));return reply;
  }
  await call('/api/probe/status');assert.equal(calls.length,1);
  assert.equal(calls[0].at(-1),'original');assert.ok(calls[0].includes(folder));
  await call('/api/probe/status');assert.equal(calls.length,1);
  release();
  for(let i=0;i<1000&&JSON.parse(await readFile(join(dataRoot,'probe-current.json'))).running;i++)await new Promise(r=>setTimeout(r,5));
  await call('/api/probe/fit','POST',JSON.stringify({requestId:'retry',importId:'import',expectedModelId:'newer'}));
  assert.equal(reply.status,202);assert.equal(calls.length,2);
  assert.equal(calls[1].at(-1),'original');assert.ok(calls[1].includes(folder));
  release();
  for(let i=0;i<1000&&JSON.parse(await readFile(join(dataRoot,'probe-current.json'))).running;i++)await new Promise(r=>setTimeout(r,5));
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});

test('a job that finishes during a status request is reported busy, not idle with files read while it ran',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'probe-finish-'));
 try{
  let reply,release;
  const routes=createProbeRoutes({repo:process.cwd(),dataRoot,json:(_res,status,body)=>{reply={status,body};},
   runProcess:()=>new Promise(resolve=>{release=resolve;})});
  const call=async(path,method='GET',body='')=>{
   const req=Readable.from(body?[Buffer.from(body)]:[]);req.method=method;req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:5173'};
   await routes(req,{},new URL(path,'http://localhost:5173'));return reply;
  };
  assert.equal((await call('/api/probe/import','POST',JSON.stringify({requestId:'first'}))).status,202);
  // The status route reads science-current.json after the import files; a FIFO holds that read
  // open until the job has finished and saved its state.
  execFileSync('mkfifo',[join(dataRoot,'science-current.json')]);
  const pending=call('/api/probe/status');
  release();
  for(let i=0;i<1000&&JSON.parse(await readFile(join(dataRoot,'probe-current.json'))).running;i++)await new Promise(r=>setTimeout(r,5));
  await new Promise(r=>setTimeout(r,20));
  await writeFile(join(dataRoot,'science-current.json'),'{}');
  const status=await pending;
  assert.equal(status.status,200);assert.equal(status.body.busy,true);assert.equal(status.body.canFit,false);
  assert.equal(JSON.parse(await readFile(join(dataRoot,'probe-current.json'))).error,null);
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});

test('setup uploads are read in linear time up to their limit and larger bodies are refused',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'probe-body-'));
 try{
  let reply;const routes=createProbeRoutes({repo:process.cwd(),dataRoot,json:(_res,status,body)=>{reply={status,body};}});
  async function post(path,size){
   const head='{"importId":"stale","pad":"',tail='"}',chunk=Buffer.alloc(64*1024,'a'),chunks=[Buffer.from(head)];
   for(let left=size-head.length-tail.length;left>0;left-=chunk.length)chunks.push(chunk.subarray(0,Math.min(left,chunk.length)));
   chunks.push(Buffer.from(tail));
   const req=Readable.from(chunks);req.method='POST';req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:5173'};
   const started=performance.now();await routes(req,{},new URL(path,'http://localhost:5173'));return {...reply,ms:performance.now()-started};
  }
  const limit=26*1024*1024,largest=await post('/api/probe/setup',limit);
  // The body parsed: rejection comes from the import binding, not the size guard.
  assert.equal(largest.status,400);assert.match(largest.body.error,/Probe import changed/);
  console.log(`max-size setup body read and parsed in ${largest.ms.toFixed(0)} ms`);
  assert.ok(largest.ms<1500,`max-size setup body took ${largest.ms} ms`);
  assert.match((await post('/api/probe/setup',limit+1)).body.error,/Request too large/);
  assert.match((await post('/api/probe/import',4097)).body.error,/Request too large/);
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});
