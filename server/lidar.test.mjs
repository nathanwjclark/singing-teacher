import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLidarRoutes} from './lidar.mjs';

test('LiDAR is off by default, retains baseline availability and rejects remote use',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lidar-route-')),prior=process.env.LIDAR_FUSION_ENABLED;delete process.env.LIDAR_FUSION_ENABLED;
 try{
  let reply;
  const route=createLidarRoutes({repo:process.cwd(),dataRoot:root,json:(_res,status,body)=>{reply={status,body};}});
  async function call(path,method='GET',remote='127.0.0.1'){
   const req=Readable.from([]);req.method=method;req.socket={remoteAddress:remote};req.headers={host:'localhost:5173'};
   await route(req,{},new URL(path,'http://localhost'));return reply;
  }
  const status=await call('/api/lidar/status');assert.equal(status.status,200);assert.equal(status.body.enabled,false);assert.equal(status.body.result,null);
  assert.equal((await call('/api/lidar/fit','POST')).status,503);
  assert.equal((await call('/api/lidar/status','GET','192.0.2.5')).status,403);
  process.env.LIDAR_FUSION_ENABLED='1';assert.equal((await call('/api/lidar/status')).body.enabled,true);
  assert.equal((await call('/api/lidar/frame?captureId=../../bad&sequence=0')).status,400);
 }finally{if(prior===undefined)delete process.env.LIDAR_FUSION_ENABLED;else process.env.LIDAR_FUSION_ENABLED=prior;await rm(root,{recursive:true,force:true});}
});

test('last adopted receipt survives a new failed attempt and a route restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lidar-success-'));
 try{
  const folder=join(root,'lidar-fits','success');await mkdir(folder,{recursive:true});
  const success={fitId:'success',modelId:'adopted',sessionId:'session',adoption:{model_updated:true,model_id:'adopted'},geometry:{modelId:'adopted',files:{}}};
  await writeFile(join(folder,'summary.json'),JSON.stringify(success));
  await writeFile(join(root,'lidar-fit-current.json'),JSON.stringify({fitId:'success',running:false}));
  const factory=()=>createLidarRoutes({repo:process.cwd(),dataRoot:root,json:(_res,_status,body)=>{reply=body;}});let reply,route=factory();
  async function status(){const req=Readable.from([]);req.method='GET';req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:5173'};await route(req,{},new URL('http://localhost/api/lidar/status'));return reply;}
  assert.deepEqual((await status()).lastSuccessfulResult,success);
  await writeFile(join(root,'lidar-fit-current.json'),JSON.stringify({fitId:'failure',running:false,error:'Invalid new annotation'}));
  let value=await status();assert.equal(value.result,null);assert.equal(value.error,'Invalid new annotation');assert.deepEqual(value.lastSuccessfulResult,success);
  route=factory();value=await status();assert.deepEqual(value.lastSuccessfulResult,success);
  // A ranked numerical result without authoritative adoption cannot replace it.
  const rejected=join(root,'lidar-fits','rejected');await mkdir(rejected);
  await writeFile(join(rejected,'summary.json'),JSON.stringify({fitId:'rejected',modelId:'adopted',sessionId:'session',status:'ranked',adoption:{model_updated:false,status:'rejected'}}));
  await writeFile(join(root,'lidar-fit-current.json'),JSON.stringify({fitId:'rejected',running:false}));
  value=await status();assert.equal(value.result.status,'ranked');assert.deepEqual(value.lastSuccessfulResult,success);
 }finally{await rm(root,{recursive:true,force:true});}
});
