import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
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
