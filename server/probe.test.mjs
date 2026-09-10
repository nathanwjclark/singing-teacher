import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createProbeRoutes} from './probe.mjs';

test('probe routes reject remote use and report interrupted work without fabricated acceptance',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'probe-route-'));
 try{
  await writeFile(join(dataRoot,'probe-current.json'),JSON.stringify({running:true,requestId:'old'}));
  let reply;
  const routes=createProbeRoutes({repo:process.cwd(),dataRoot,json:(_res,status,body)=>{reply={status,body};}});
  async function call(path,method='GET',body='',remote='127.0.0.1'){
   const req=Readable.from(body?[body]:[]);req.method=method;req.socket={remoteAddress:remote};req.headers={host:'localhost:5173'};
   await routes(req,{},new URL(path,'http://localhost:5173'));return reply;
  }
  assert.equal((await call('/api/probe/status','GET','','192.0.2.10')).status,403);
  const status=await call('/api/probe/status');
  assert.equal(status.status,200);assert.equal(status.body.canFit,false);
  assert.match(status.body.error,/interrupted/);
  assert.equal(JSON.parse(await readFile(join(dataRoot,'probe-current.json'))).running,false);
  assert.equal((await call('/api/probe/import','POST',JSON.stringify({requestId:'old'}))).status,409);
  assert.equal((await call('/api/probe/fit','POST',JSON.stringify({requestId:'new',importId:'../bad',expectedModelId:'model'}))).status,400);
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});
