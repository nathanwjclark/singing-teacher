import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVisualLikelihoodRoutes} from './visualLikelihood.mjs';
test('optional visual routes default disabled and preserve original motion and baseline workflows',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visual-route-')),old=process.env.VISUAL_LIKELIHOOD_ENABLED;delete process.env.VISUAL_LIKELIHOOD_ENABLED;
 try{
  let reply;const route=createVisualLikelihoodRoutes({repo:process.cwd(),dataRoot:root,json:(_r,status,body)=>{reply={status,body};}});
  async function call(path,method='GET',remote='127.0.0.1'){
   const req=Readable.from([]);req.method=method;req.socket={remoteAddress:remote};req.headers={host:'localhost:5173'};
   await route(req,{},new URL(path,'http://localhost'));return reply;
  }
  const state=await call('/api/visual/status');assert.equal(state.status,200);assert.equal(state.body.enabled,false);assert.deepEqual(state.body.captures,[]);
  assert.equal((await call('/api/visual/freeze','POST')).status,503);
  assert.equal((await call('/api/visual/status','GET','192.0.2.5')).status,403);
 }finally{if(old===undefined)delete process.env.VISUAL_LIKELIHOOD_ENABLED;else process.env.VISUAL_LIKELIHOOD_ENABLED=old;await rm(root,{recursive:true,force:true});}
});

test('concurrent POST is rejected during body await and terminal failure permits a new declaration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visual-reservation-')),old=process.env.VISUAL_LIKELIHOOD_ENABLED;process.env.VISUAL_LIKELIHOOD_ENABLED='1';
 try{
  const replies=new Map();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const route=createVisualLikelihoodRoutes({repo:process.cwd(),dataRoot:root,json:(res,status,body)=>replies.set(res,{status,body})});
  const request=chunks=>{const req=Readable.from(chunks);req.method='POST';req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:5173','content-type':'application/json'};return req;};
  const pending=route(request((async function*(){await gate;yield '{}';})()),'first',new URL('http://localhost/api/visual/freeze'));
  await route(request(['{}']),'second',new URL('http://localhost/api/visual/score'));
  assert.equal(replies.get('second').status,409);
  release();await pending;assert.equal(replies.get('first').status,400);
  const folder=join(root,'visual-runs','failed');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'intent.json'),JSON.stringify({}));await writeFile(join(folder,'failure.json'),JSON.stringify({reason:'native operation failed and collected'}));
  await writeFile(join(root,'visual-current.json'),JSON.stringify({runId:'failed',requestId:'old',fingerprint:'old',running:false,error:'failed'}));
  const body={requestId:'fresh',forecastId:'new-forecast',captureId:'a'.repeat(64),annotations:[],experimentalDeclaration:true};
  await route(request([JSON.stringify(body)]),'retry',new URL('http://localhost/api/visual/score'));
  assert.equal(replies.get('retry').status,400);
  assert.match(replies.get('retry').body.error,/Complete a baseline/);
  // Missing baseline is a separate prerequisite; old failure does not trap retry.
 }finally{if(old===undefined)delete process.env.VISUAL_LIKELIHOOD_ENABLED;else process.env.VISUAL_LIKELIHOOD_ENABLED=old;await rm(root,{recursive:true,force:true});}
});
