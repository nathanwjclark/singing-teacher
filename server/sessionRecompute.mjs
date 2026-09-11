import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
// app_recompute.py refuses to write a larger report.
export const REPORT_BYTES=8*1024*1024;
const read=async(path,limit=REPORT_BYTES)=>{if((await stat(path)).size>limit)throw Error('Verification artifact exceeds size limit');return JSON.parse(await readFile(path,'utf8'));};
const save=async(path,value)=>{const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path);};
// science/scripts/app_recompute.py kills its process group 290 seconds after it starts,
// so a verifier left by an earlier server process is gone before this window closes.
const DEADLINE_MS=300000;
const execFileAsync=promisify(execFile);
// The kernel's start time for a pid; a reused pid has a different one.
const processStart=async pid=>{try{return (await execFileAsync('ps',['-o','lstart=','-p',String(pid)])).stdout.trim()||null;}catch{return null;}};
// Single flight across restarts: a verifier started by an earlier server process is
// still running while a process with its pid and recorded start time exists inside
// the attempt deadline.
const alive=async value=>Number.isInteger(value.pid)&&value.pid>0&&typeof value.processStartedAt==='string'&&Date.now()<Date.parse(value.startedAt)+DEADLINE_MS&&await processStart(value.pid)===value.processStartedAt;
// The verifier needs the worker address and token, and Node on PATH for the extractor;
// nothing else from this server's environment (no provider keys) is passed on.
const verifierEnv=(env,repo)=>Object.fromEntries(Object.entries({PATH:env.PATH,HOME:env.HOME,TMPDIR:env.TMPDIR,SCIENCE_URL:env.SCIENCE_URL,SCIENCE_TOKEN:env.SCIENCE_TOKEN,PYTHONPATH:repo+':'+resolve(repo,'science/src')}).filter(([,value])=>value!==undefined));
export const recomputeAttempt=value=>typeof value==='string'&&/^replay-[a-f0-9-]{36}$/.test(value);
// A report counts only when its bytes match the receipt and it names the receipt's run, session and ledger.
export function boundReport(receipt,{sha256,byteLength,report}){
 if(sha256!==receipt.reportSha256||byteLength!==receipt.reportByteLength||report.schemaVersion!=='session-recomputation/1'||report.attemptId!==receipt.attemptId||report.sessionId!==receipt.sessionId||report.runId!==receipt.runId||report.workerLedgerSha256!==receipt.workerLedgerSha256||report.modelUpdated!==false||report.rawMediaIncluded!==false)throw Error('Verification report integrity mismatch');
 return report;
}

export function createSessionRecomputeRoutes({repo,dataRoot,json,env=process.env,spawnImpl=spawn}){
 let running=null;
 const index=resolve(dataRoot,'session-recompute-current.json');
 async function context(){
  let current;try{current=await read(resolve(dataRoot,'science-current.json'));}catch(error){if(error.code==='ENOENT')throw Error('Complete a baseline voice model first');throw error;}
  if(current.status!=='succeeded'||!safeId(current.runId))throw Error('Complete a baseline voice model first');
  const summary=await read(resolve(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!safeId(summary.sessionId))throw Error('Current run has no valid scientific session');
  return {runId:current.runId,sessionId:summary.sessionId};
 }
 async function receipt(attempt){
  if(!recomputeAttempt(attempt))throw Error('Invalid verification attempt');
  const dir=resolve(dataRoot,'replay-verifications',attempt),value=await read(resolve(dir,'receipt.json'));
  if(value.attemptId!==attempt)throw Error('Verification report integrity mismatch');
  const bytes=await readFile(resolve(dir,'report.json'));
  if(bytes.length>REPORT_BYTES)throw Error('Verification report integrity mismatch');
  return {...value,report:boundReport(value,{sha256:hash(bytes),byteLength:bytes.length,report:JSON.parse(bytes)})};
 }
 async function finish(attempt,code){
  const dir=resolve(dataRoot,'replay-verifications',attempt),request=await read(resolve(dir,'request.json'));
  if(code===0){
   const bytes=await readFile(resolve(dir,'report.json'));if(bytes.length>REPORT_BYTES)throw Error('Verification report exceeds limit');
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
  value=await settle(value);
  return value.status==='completed'?await receipt(value.attemptId):value;
 }
 // Record the outcome of an attempt whose verifier is gone: this process did not
 // start it (server restart) and its pid no longer runs.
 async function settle(value){
  if(value.status!=='running'||running===value.attemptId||await alive(value))return value;
  try{await finish(value.attemptId,0);}catch{await finish(value.attemptId,1);}
  return read(index);
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
   if(Object.keys(body).sort().join(',')!=='maxOperations,requestId'||!recomputeAttempt(body.requestId)||!Number.isInteger(body.maxOperations)||body.maxOperations<1||body.maxOperations>16)throw Error('Select one to sixteen operations and a fresh request identity');
   let current=null;try{current=await settle(await read(index));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(current?.status==='running')throw Error('A bounded numerical verification is already running.');
   const c=await context(),attempt=body.requestId,dir=resolve(dataRoot,'replay-verifications',attempt),request={...c,maxOperations:body.maxOperations};
   await mkdir(dir,{recursive:true,mode:0o700});
   try{
    const prior=await read(resolve(dir,'request.json'));
    if(JSON.stringify(prior)!==JSON.stringify(request))throw Error('Retry does not match the original verification request');
    try{const saved=await receipt(attempt);json(res,200,saved);return true;}catch(error){if(error.code!=='ENOENT')throw error;}
    throw Error('This earlier attempt was interrupted. Start a new verification attempt.');
   }catch(error){if(error.code!=='ENOENT')throw error;}
   await save(resolve(dir,'request.json'),request);running=attempt;
   // Detached: the verifier leads its own process group, so the deadline and its exit
   // stop its extractor subprocesses too. It is not killed when this server exits.
   const child=spawnImpl(env.SINGING_PYTHON||resolve(repo,'science/.venv/bin/python'),[resolve(repo,'science/scripts/app_recompute.py'),'--data-root',dataRoot,'--output',dir,'--max-operations',String(body.maxOperations)],{cwd:repo,env:verifierEnv(env,repo),stdio:['ignore','ignore','ignore'],detached:true});
   launched=true;
   // Listen before any await so a verifier that exits at once is still recorded.
   const exited=new Promise(resolveExit=>{child.once('error',()=>resolveExit(1));child.once('close',resolveExit);});
   const startedAt=new Date().toISOString(),processStartedAt=Number.isInteger(child.pid)?await processStart(child.pid):null;
   const value={status:'running',attemptId:attempt,...c,pid:child.pid,startedAt,processStartedAt},saved=save(index,value);
   const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}},DEADLINE_MS);
   // The verifier leads its own group; anything it started (an extractor still
   // running after a deadline kill) goes with it.
   void exited.then(async code=>{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL');}catch{}await saved.catch(()=>{});try{await finish(attempt,code);}catch{await save(index,{...value,status:'failed',reason:'Verification output unavailable or failed integrity validation.'}).catch(()=>{});}finally{if(running===attempt)running=null;}});
   await saved;json(res,202,value);return true;
  }catch(error){json(res,409,{error:error.message||'Numerical verification unavailable'});return true;}finally{if(reserved&&!launched)running=null;}
 };
}
