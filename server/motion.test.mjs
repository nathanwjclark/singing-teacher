import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,stat,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMotionRoutes} from './motion.mjs';

function fixture(){
 const bytes=Buffer.from('Explicit synthetic media bytes; integrity test does not certify video decoding.');
 const digest=createHash('sha256').update(bytes).digest('hex');
 const record={schemaVersion:'1.0.0',kind:'motion-observation',id:'synthetic-motion',createdAt:'2026-01-01T00:00:00Z',
  provenance:{kind:'development-fixture',producer:'motion-test',producerVersion:'1',sourceIds:['synthetic-camera'],sourceHashes:[digest]},
  attemptId:'synthetic-attempt',cueId:'test-cue',cueVersion:'1',context:{description:'synthetic fixture'},
  samples:[100,500].map((t,i)=>({id:`frame-${i}`,captureMs:t,sourceTimestampMs:t,repetition:1,phase:'gesture',head:null,gapBefore:i===1,
   points:[{name:'tongue_tip',image:null,headRelative:null,visibility:'missing',reason:'tip-not-tracked',confidence:null}]})),
  markers:[{captureMs:600,repetition:1,type:'unsuccessful',phase:'return',source:'user',note:'Synthetic unsuccessful marker'},
   {captureMs:700,repetition:1,type:'stop',phase:'return',source:'user',note:'Synthetic stop'}],
  coordinateFrame:'normalized-image-and-outer-eye-relative-2d',timebase:{clock:'browser-performance',originMs:0,syncUncertaintyMs:null},
  visibility:'Per-point',uncertainty:'unquantified-image-estimates',observedEnvelope:[],
  media:{filename:'original.webm',mimeType:'video/webm',startedAtMs:0,syncUncertaintyMs:null,sha256:digest,byteLength:bytes.length},
  missing:{depth:'not-supported',internalGeometry:'not-observed',calibratedHeadPose:'not-captured'},interpretation:'observed-visible-motion-not-anatomical-limits'};
 return {bytes,record};
}

test('actual HTTP motion persistence preserves exact originals, unknown timing, gaps and unsuccessful attempts across restart',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'motion-api-'));let server;
 const priorFfmpeg=process.env.SINGING_FFMPEG;
 process.env.SINGING_FFMPEG=join(dataRoot,'decoder-unavailable');
 const start=async()=>{
  const routes=createMotionRoutes({dataRoot,json:(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}});
  server=http.createServer((req,res)=>{void routes(req,res,new URL(req.url,'http://localhost')).catch(error=>{res.writeHead(500);res.end(error.message);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;
 };
 const stop=()=>new Promise(resolve=>server.close(resolve));
 try{
  let base=await start();assert.equal((await (await fetch(base+'/api/motion/status')).json()).capture,null);
  const {record,bytes}=fixture(),original=JSON.stringify(record,null,3)+'\n';
  const upload=async(text=original,media=bytes)=>{
   const form=new FormData();form.append('record',new Blob([text],{type:'application/json'}),'original.json');form.append('media',new Blob([media],{type:'video/webm'}),'original.webm');
   return fetch(base+'/api/motion/import',{method:'POST',body:form});
  };
  let response=await upload();assert.equal(response.status,200);const saved=await response.json();
  assert.equal(saved.capture.timingGaps,1);assert.equal(saved.capture.unsuccessfulMarkers,1);assert.equal(saved.capture.syncUncertaintyMs,null);
  assert.equal(saved.capture.includedInPhysicalFit,false);assert.equal(saved.reused,false);
  assert.equal((await (await upload()).json()).reused,true);
  assert.equal((await stat(join(dataRoot,'motion-captures',saved.capture.id,'media'))).mode&0o777,0o600);
  await stop();base=await start();
  const status=await (await fetch(base+'/api/motion/status')).json();assert.deepEqual(status.record,record);
  assert.equal(await (await fetch(base+`/api/motion/record?id=${saved.capture.id}`)).text(),original);
  assert.deepEqual(Buffer.from(await (await fetch(base+`/api/motion/media?id=${saved.capture.id}`)).arrayBuffer()),bytes);
  const changed=Buffer.from(bytes);changed[0]^=1;
  assert.equal((await upload(original,changed)).status,400);
  const invalid=structuredClone(record);invalid.samples[1].id=invalid.samples[0].id;
  assert.equal((await upload(JSON.stringify(invalid))).status,400);
  assert.equal((await upload(' '.repeat(4*1024*1024+1))).status,400);
  assert.equal((await fetch(base+'/api/motion/status',{headers:{Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await (await fetch(base+'/api/motion/status')).json()).capture.id,saved.capture.id);
  const analysis=await (await fetch(base+`/api/motion/analysis?captureId=${saved.capture.id}`)).json();
  assert.equal(analysis.status,'not-run');assert.equal(analysis.availability.available,false);
  // The server reports the version declared by the Python analysis, which the client binds into its request identity.
  const source=await readFile(join(import.meta.dirname,'../science/src/singing_physics/motion_trajectory.py'),'utf8');
  assert.match(analysis.analysisPolicy,/^motion-forward-bank-\d+$/);assert.ok(source.includes(`VERSION = '${analysis.analysisPolicy}'`));
  const declaration={requestId:'analysis',captureId:saved.capture.id,pose:'a',containsExternalExcitation:false};
  const analyze=body=>fetch(base+'/api/motion/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await analyze({...declaration,containsExternalExcitation:true})).status,400);
  assert.equal((await analyze(declaration)).status,503);
  const analysisDir=join(dataRoot,'motion-analyses',saved.capture.id);await mkdir(analysisDir,{recursive:true});
  await writeFile(join(analysisDir,'current.json'),JSON.stringify({analysisId:'earlier',requestId:'analysis',pose:'i',status:'failed',expectedModelId:null}));
  assert.equal((await analyze(declaration)).status,409);
  assert.equal((await (await fetch(base+'/api/motion/status')).json()).capture.id,saved.capture.id);
 }finally{if(priorFfmpeg===undefined)delete process.env.SINGING_FFMPEG;else process.env.SINGING_FFMPEG=priorFfmpeg;if(server?.listening)await stop();await rm(dataRoot,{recursive:true,force:true});}
});
