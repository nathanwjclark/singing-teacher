import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import http from 'node:http';
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

test('completion during awaited model lookup does not return idle with an old empty result',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lidar-status-race-'));
 const names=['LIDAR_FUSION_ENABLED','SINGING_PYTHON','SCIENCE_URL','SCIENCE_TOKEN'],prior=Object.fromEntries(names.map(n=>[n,process.env[n]]));let modelServer;
 try{
  const repo=join(root,'repo');await mkdir(join(repo,'science/scripts'),{recursive:true});
  const output=join(root,'lidar-fits/fit');await mkdir(output,{recursive:true});
  // Controlled subprocess fixture: it finishes only after status has entered
  // the real HTTP model lookup, exposing the previously observed race.
  await writeFile(join(repo,'science/scripts/app_lidar.py'),[
   'import sys,time,json,pathlib',
   "root=pathlib.Path(sys.argv[sys.argv.index('--data-root')+1])",
   "deadline=time.monotonic()+5",
   "while not (root/'complete-now').exists():",
   '    if time.monotonic()>deadline: raise RuntimeError("test trigger timed out")',
   '    time.sleep(.005)',
   "(root/'lidar-fits/fit/summary.json').write_text(json.dumps({'fitId':'fit','modelId':'parent','status':'rejected','adoption':{'model_updated':False}}))",
  ].join('\n'));
  await mkdir(join(root,'science-runs/voice'),{recursive:true});
  await writeFile(join(root,'science-current.json'),JSON.stringify({status:'succeeded',runId:'voice'}));
  await writeFile(join(root,'science-runs/voice/summary.json'),JSON.stringify({sessionId:'session'}));
  await writeFile(join(root,'lidar-fit-current.json'),JSON.stringify({fitId:'fit',running:true}));
  modelServer=http.createServer(async(_req,res)=>{
   await writeFile(join(root,'complete-now'),'1');
   for(let attempt=0;attempt<200;attempt++){
    if(!JSON.parse(await readFile(join(root,'lidar-fit-current.json'),'utf8')).running)break;
    await new Promise(resolve=>setTimeout(resolve,5));
   }
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({state:{snapshot:{model_id:'parent'}}}));
  });
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{LIDAR_FUSION_ENABLED:'1',SINGING_PYTHON:'/usr/bin/python3',SCIENCE_URL:`http://127.0.0.1:${modelServer.address().port}`,SCIENCE_TOKEN:'synthetic-test-token'});
  let reply;const route=createLidarRoutes({repo,dataRoot:root,json:(_r,_s,body)=>{reply=body;}});
  async function status(){const req=Readable.from([]);req.method='GET';req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'localhost:5173'};await route(req,{},new URL('http://localhost/api/lidar/status'));return reply;}
  const first=await status();assert.equal(first.result,null);assert.equal(first.busy,true);
  const second=await status();assert.equal(second.busy,false);assert.equal(second.result.status,'rejected');
 }finally{if(modelServer)await new Promise(resolve=>modelServer.close(resolve));for(const name of names){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}await rm(root,{recursive:true,force:true});}
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
