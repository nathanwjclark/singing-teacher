import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const attemptId=value=>typeof value==='string'&&/^replay-[a-f0-9-]{36}$/.test(value);
const read=async(path,limit=8*1024*1024)=>{if((await stat(path)).size>limit)throw Error('Verification artifact exceeds size limit');return JSON.parse(await readFile(path,'utf8'));};
const save=async(path,value)=>{const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path);};

export function createSessionRecomputeRoutes({repo,dataRoot,json,env=process.env,spawnImpl=spawn}){
 let running=null;
 const index=resolve(dataRoot,'session-recompute-current.json');
 async function context(){
  const current=await read(resolve(dataRoot,'science-current.json'));
  if(current.status!=='succeeded'||!safeId(current.runId))throw Error('Complete a baseline voice model first');
  const summary=await read(resolve(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!safeId(summary.sessionId))throw Error('Current run has no valid scientific session');
  return {runId:current.runId,sessionId:summary.sessionId};
 }
 async function receipt(attempt){
  if(!attemptId(attempt))throw Error('Invalid verification attempt');
  const dir=resolve(dataRoot,'replay-verifications',attempt),value=await read(resolve(dir,'receipt.json'));
  const bytes=await readFile(resolve(dir,'report.json'));
  if(bytes.length>8*1024*1024||hash(bytes)!==value.reportSha256||bytes.length!==value.reportByteLength)throw Error('Verification report integrity mismatch');
  const report=JSON.parse(bytes);
  if(report.schemaVersion!=='session-recomputation/1'||report.attemptId!==attempt||report.sessionId!==value.sessionId||report.runId!==value.runId||report.workerLedgerSha256!==value.workerLedgerSha256||report.modelUpdated!==false||report.rawMediaIncluded!==false)throw Error('Verification report identity mismatch');
  return {...value,report};
 }
 async function finish(attempt,code){
  const dir=resolve(dataRoot,'replay-verifications',attempt),request=await read(resolve(dir,'request.json'));
  if(code===0){
   const bytes=await readFile(resolve(dir,'report.json'));if(bytes.length>8*1024*1024)throw Error('Verification report exceeds limit');
   const report=JSON.parse(bytes);
   if(report.schemaVersion!=='session-recomputation/1'||report.attemptId!==attempt||report.runId!==request.runId||report.sessionId!==request.sessionId||report.modelUpdated!==false||report.rawMediaIncluded!==false||!/^[a-f0-9]{64}$/.test(report.workerLedgerSha256||''))throw Error('Verification report identity mismatch');
   const value={status:'completed',attemptId:attempt,runId:request.runId,sessionId:request.sessionId,workerLedgerSha256:report.workerLedgerSha256,reportSha256:hash(bytes),reportByteLength:bytes.length};
   await save(resolve(dir,'receipt.json'),value);await save(index,value);return;
  }
  let reason='Verification stopped before completion. Start another attempt; the original session is unchanged.';
  try{const failed=await read(resolve(dir,'failure.json'));if(typeof failed.reason==='string')reason=failed.reason.slice(0,500);}catch{}
  await save(index,{status:'failed',attemptId:attempt,...request,reason});
 }
 async function status(){
  let c;try{c=await context();}catch(error){return {status:'unavailable',reason:error.message};}
  let value;try{value=await read(index);}catch(error){if(error.code==='ENOENT')return {status:'not-run',...c};throw error;}
  if(value.runId!==c.runId||value.sessionId!==c.sessionId)return {status:'not-run',...c,reason:'No verification has run for this session.'};
  if(value.status==='running'&&running!==value.attemptId){
   try{await finish(value.attemptId,0);}catch{await finish(value.attemptId,1);}
   value=await read(index);
  }
  return value.status==='completed'?await receipt(value.attemptId):value;
 }
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/session-recompute/'))return false;
  const host=req.headers.host,address=req.socket.remoteAddress?.replace(/^::ffff:/,'');
  if(!['127.0.0.1','::1'].includes(address)||!/^((localhost|127\.0\.0\.1)|\[::1\])(:\d+)?$/.test(host||'')||(req.headers.origin&&!['http://'+host,'https://'+host].includes(req.headers.origin))){json(res,403,{error:'Run numerical replay from this computer’s local app.'});return true;}
  let reserved=false,launched=false;
  try{
   if(req.method==='GET'&&url.pathname==='/api/session-recompute/status'&&!url.search){json(res,200,await status());return true;}
   if(req.method!=='POST'||url.pathname!=='/api/session-recompute/run'||url.search){json(res,405,{error:'Unsupported verification action'});return true;}
   if(running){json(res,409,{error:'A bounded numerical verification is already running.'});return true;}
   running='reserved';reserved=true;
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1024)throw Error('Verification request too large');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString());
   if(Object.keys(body).sort().join(',')!=='maxOperations,requestId'||!attemptId(body.requestId)||!Number.isInteger(body.maxOperations)||body.maxOperations<1||body.maxOperations>16)throw Error('Select one to sixteen operations and a fresh request identity');
   const c=await context(),attempt=body.requestId,dir=resolve(dataRoot,'replay-verifications',attempt),request={...c,maxOperations:body.maxOperations};
   await mkdir(dir,{recursive:true,mode:0o700});
   try{
    const prior=await read(resolve(dir,'request.json'));
    if(JSON.stringify(prior)!==JSON.stringify(request))throw Error('Retry does not match the original verification request');
    try{const saved=await receipt(attempt);json(res,200,saved);return true;}catch(error){if(error.code!=='ENOENT')throw error;}
    throw Error('This earlier attempt was interrupted. Start a new verification attempt.');
   }catch(error){if(error.code!=='ENOENT')throw error;}
   await save(resolve(dir,'request.json'),request);
   const value={status:'running',attemptId:attempt,...c};await save(index,value);running=attempt;
   const child=spawnImpl(env.SINGING_PYTHON||resolve(repo,'science/.venv/bin/python'),[resolve(repo,'science/scripts/app_recompute.py'),'--data-root',dataRoot,'--output',dir,'--max-operations',String(body.maxOperations)],{cwd:repo,env:{...env,PYTHONPATH:repo+':'+resolve(repo,'science/src')},stdio:['ignore','ignore','ignore'],detached:true});
   launched=true;
   const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}},300000);
   child.once('error',()=>{});
   child.once('close',async code=>{clearTimeout(timer);try{await finish(attempt,code);}catch{await save(index,{...value,status:'failed',reason:'Verification output unavailable or failed integrity validation.'}).catch(()=>{});}finally{if(running===attempt)running=null;}});
   json(res,202,value);return true;
  }catch(error){json(res,409,{error:error.message||'Numerical verification unavailable'});return true;}finally{if(reserved&&!launched)running=null;}
 };
}
