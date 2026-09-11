import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {probeSetupStatus,saveProbeSetup} from './probeSetup.mjs';
const execute=promisify(execFile);
const id=/^[A-Za-z0-9_-]{1,100}$/;
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export function createProbeRoutes({repo,dataRoot,json,runProcess=execute}) {
 let busy=false;
 const stateFile=join(dataRoot,'probe-current.json');
 async function save(state){await mkdir(dataRoot,{recursive:true,mode:0o700});const temporary=stateFile+'.'+randomUUID();await writeFile(temporary,JSON.stringify(state),{mode:0o600});await rename(temporary,stateFile);}
 async function launch(next,fitting,folder){
  busy=true;next.running=true;next.error=null;
  try{await save(next);}catch(error){busy=false;throw error;}
  const python=process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python');
  const args=[join(repo,'science/scripts',fitting?'run_probe_fit.py':'prepare_probe_capture.py'),'--data-root',dataRoot,'--output',folder];
  if(fitting)args.push('--import-id',next.importId,'--expected-model-id',next.expectedModelId);
  void runProcess(python,args,{cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src')].join(':')},timeout:240000,maxBuffer:65536})
   .catch(async error=>{const safe=(error.stderr??'').split('\n').filter(x=>/^(ValueError|FileNotFoundError):/.test(x)).at(-1);next.error=safe??'Probe processing paused. Retry in the app to recover the recorded job; original artifacts were retained.';await save(next);})
   .finally(async()=>{next.running=false;await save(next);busy=false;}).catch(()=>{busy=false;});
 }
 async function model(){
  const current=await read(join(dataRoot,'science-current.json'));
  if(current?.status!=='succeeded'||!id.test(current.runId))return null;
  const summary=await read(join(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!summary?.sessionId||!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)return null;
  const response=await fetch(`${process.env.SCIENCE_URL}/sessions/${encodeURIComponent(summary.sessionId)}/commands`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.SCIENCE_TOKEN}`},body:JSON.stringify({action:'state'}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;return (await response.json()).state?.snapshot?.model_id??null;
 }
 return async(req,res,url)=>{
  if(!['/api/probe/status','/api/probe/import','/api/probe/fit','/api/probe/setup'].includes(url.pathname))return false;
  const remote=req.socket.remoteAddress?.replace(/^::ffff:/,'');
  let local=false;
  try{local=['127.0.0.1','::1'].includes(remote)&&['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host);}catch{}
  if(!local){json(res,403,{error:'Use this Mac’s localhost page for private probe processing.'});return true;}
  try{
   // Sample busy before reading anything: a job that finishes during this request must not be
   // reported idle alongside files read while it still ran, nor be mistaken for an interrupted one.
   const running=busy,state=await read(stateFile)??{};
   if(state.running&&!running&&!busy){
    if(state.operation==='fit'&&id.test(state.fitId??'')&&id.test(state.importId??'')&&typeof state.expectedModelId==='string'){
     await launch(state,true,join(dataRoot,'probe-fits',state.fitId));
    }else{state.running=false;state.error='Probe import was interrupted. Import again in the app; original artifacts were retained.';await save(state);}
   }
   if(req.method==='GET'&&url.pathname.endsWith('/status')){
    const imported=state.importId?await read(join(dataRoot,'probe-imports',state.importId,'summary.json')):null;
    const fit=state.fitId?await read(join(dataRoot,'probe-fits',state.fitId,'summary.json')):null;
    const measurement=imported?await read(join(dataRoot,'probe-imports',state.importId,imported.measurementPath)):null;
    const currentModelId=await model().catch(()=>null);
    const setup=await probeSetupStatus(dataRoot,state.importId).catch(()=>({setup:null,capture:null,legacyConfiguration:false,error:'Saved probe setup could not be verified. Reopen setup and verify the original evidence again.'}));
    const profile=imported?.setupId?true:await access(join(dataRoot,'probe-fit-profile.json')).then(()=>true).catch(()=>false);
    const resumable=state.fitId&&!fit&&await read(join(dataRoot,'probe-fits',state.fitId,'intent.json'));
    const fitBlockedReason=!imported?.eligible?'Complete calibration setup and analyze the probe with verified calibration first.':!currentModelId?'A current scientific model and worker are required.':!profile&&!resumable?'Declare the probe placement and controls in Calibration setup.':null;
    json(res,200,{busy:running||busy,import:imported,fit,measurement,currentModelId,canFit:!running&&!busy&&!fitBlockedReason,fitBlockedReason,setup,error:state.error??null});return true;
   }
   if(req.method!=='POST'||url.pathname.endsWith('/status')){json(res,405,{error:'Method not allowed'});return true;}
   const configuring=url.pathname.endsWith('/setup');
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>(configuring?26*1024*1024:4096))throw Error('Request too large');}
   if(configuring){
    if(busy){json(res,409,{error:'A probe operation is already running'});return true;}
    let body;try{body=JSON.parse(raw);}catch{throw Error('Invalid JSON request');}
    if(body.importId!==state.importId)throw Error('Probe import changed; refresh calibration setup');
    busy=true;
    try{const setup=await saveProbeSetup({repo,dataRoot,body,runProcess});json(res,200,{saved:true,setup});}
    finally{busy=false;}
    return true;
   }
   let body;try{body=JSON.parse(raw);}catch{throw Error('Invalid JSON request');}const fitting=url.pathname.endsWith('/fit');
   if(!id.test(body.requestId??'')||Object.keys(body).some(k=>!(fitting?['requestId','importId','expectedModelId']:['requestId']).includes(k)))throw Error('Invalid probe request');
   if(fitting&&(!id.test(body.importId??'')||typeof body.expectedModelId!=='string'||body.expectedModelId.length>256))throw Error('Invalid probe fit identity');
   if(busy){json(res,409,{error:'A probe operation is already running'});return true;}
   if(state.requestId===body.requestId&&!state.error){json(res,200,{accepted:true,reused:true});return true;}
   if(fitting&&body.importId!==state.importId)throw Error('Import changed; refresh before fitting');
   let operationId=randomUUID(),expectedModelId=body.expectedModelId;
   if(fitting&&state.fitId){
    const previous=join(dataRoot,'probe-fits',state.fitId);
    if(await read(join(previous,'summary.json'))){json(res,200,{accepted:true,reused:true});return true;}
    const intent=await read(join(previous,'intent.json'));
    if(intent&&!await read(join(previous,'failure.json'))){operationId=state.fitId;expectedModelId=intent.parentModelId;}
   }
   const folder=join(dataRoot,fitting?'probe-fits':'probe-imports',operationId);
   const next={...state,requestId:body.requestId,operation:fitting?'fit':'import',expectedModelId,
    ...(fitting?{fitId:operationId}:{importId:operationId,fitId:null})};
   await launch(next,fitting,folder);
   json(res,202,{accepted:true});return true;
  }catch(error){
   // A SyntaxError here comes from a saved probe file, never from the request body.
   if(error instanceof SyntaxError){json(res,500,{error:'A saved probe file could not be read. Import the probe again; original artifacts were retained.'});return true;}
   json(res,400,{error:error.message});return true;
  }
 };
}
