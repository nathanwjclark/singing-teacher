import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(path,value)=>{const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path)};
export async function readLearningMemory({dataRoot,sessionId}){
 if(!safe(sessionId))throw Error('Invalid session identity');
 try{return await read(resolve(dataRoot,'learning-memory',sessionId+'.json'))}catch(error){if(error.code!=='ENOENT')throw error;return {kind:'subjective-cue-memory',sessionId,entries:[],scope:'subjective_not_physiological_evidence'}}
}
export function createLearningRoutes({dataRoot,json}){
 let busy=false;
 async function current(){
  const index=await read(resolve(dataRoot,'science-current.json'));
  if(index.status!=='succeeded'||!safe(index.runId))throw Error('Completed model run required');
  const run=resolve(dataRoot,'science-runs',index.runId),pointer=await read(resolve(run,'outcome-current.json'));
  if(pointer.status!=='succeeded'||!safe(pointer.outcomeId))throw Error('Completed outcome required');
  const outcome=await read(resolve(run,'outcomes',pointer.outcomeId,'summary.json'));
  if(!safe(outcome.sessionId)||typeof outcome.observationId!=='string'||!outcome.submitted)throw Error('Recorded outcome attempt required');
  return {run,runId:index.runId,outcome};
 }
 async function command(sessionId,value){
  const url=new URL(process.env.SCIENCE_URL||'http://invalid');
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!/^[A-Za-z0-9_-]{32,256}$/.test(process.env.SCIENCE_TOKEN||''))throw Error('Shared private scientific worker required');
  const response=await fetch(new URL('/sessions/'+sessionId+'/commands',url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+process.env.SCIENCE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(value)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Scientific session command failed');return result;
 }
 return async(req,res,url)=>{
  if(!['/api/learning/memory','/api/learning/sensation'].includes(url.pathname))return false;
  if(!['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))){json(res,403,{error:'Private local learning memory only'});return true}
  try{
   const {run,runId,outcome}=await current();
   if(req.method==='GET'&&url.pathname==='/api/learning/memory'){json(res,200,await readLearningMemory({dataRoot,sessionId:outcome.sessionId}));return true}
   if(req.method!=='POST'||url.pathname!=='/api/learning/sensation'){json(res,405,{error:'Unsupported method'});return true}
   if(busy){json(res,409,{error:'Sensation save already in progress; retry'});return true}busy=true;
   try{
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>10000)throw Error('Report too large')}
    const body=JSON.parse(raw);if(!body||Object.keys(body).length!==1||typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)throw Error('Supply one subjective text report, 1..2000 characters');
    const text=body.text.trim(),id=createHash('sha256').update(JSON.stringify([outcome.sessionId,outcome.observationId,text])).digest('hex');
    const dir=resolve(dataRoot,'learning-memory');await mkdir(dir,{recursive:true,mode:0o700});
    const memory=await readLearningMemory({dataRoot,sessionId:outcome.sessionId});
    if(memory.entries.some(e=>e.id===id)){json(res,200,memory);return true}
    let decisionId=null,cue=null;
    try{const pointer=await read(resolve(run,'astra-current.json'));if(pointer.sessionId===outcome.sessionId&&pointer.designId===outcome.designId&&safe(pointer.decisionId)){const decision=await read(resolve(dataRoot,'astra-decisions',outcome.sessionId,pointer.decisionId+'.json'));if(decision.sessionId===outcome.sessionId&&decision.designId===outcome.designId){decisionId=pointer.decisionId;cue=decision.decision?.cue??null}}}catch(error){if(error.code!=='ENOENT')throw error}
    const intentPath=resolve(dir,id+'.intent.json');let intent;
    try{intent=await read(intentPath)}catch(error){if(error.code!=='ENOENT')throw error;const state=(await command(outcome.sessionId,{action:'state'})).state;
     if(!state.attempts.some(a=>a.attempt_id===outcome.observationId))throw Error('Outcome attempt is not recorded in session');
     intent={command:{action:'record_sensation',command_id:'sensation-'+id,expected_version:state.version,attempt_id:outcome.observationId,text},entry:{id,attemptId:outcome.observationId,modelId:outcome.modelId,runId,designId:outcome.designId,text,createdAt:new Date().toISOString(),decisionId,cue}};await save(intentPath,intent)}
    try{await command(outcome.sessionId,intent.command)}catch(error){
     if(!error.message.includes('stale_session_version'))throw error;
     const state=(await command(outcome.sessionId,{action:'state'})).state;
     await save(resolve(dir,id+'.v'+intent.command.expected_version+'.intent.json'),intent);
     intent={...intent,command:{...intent.command,command_id:'sensation-'+id+'-v'+state.version,expected_version:state.version}};
     await save(intentPath,intent);await command(outcome.sessionId,intent.command);
    }
    memory.entries.push(intent.entry);await save(resolve(dir,outcome.sessionId+'.json'),memory);
    json(res,200,memory);return true;
   }finally{busy=false}
  }catch(error){json(res,409,{error:error.message});return true}
 };
}
