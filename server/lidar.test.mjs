import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
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
