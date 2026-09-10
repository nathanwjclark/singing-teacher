import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
const id=/^[A-Za-z0-9_-]{1,100}$/;
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export function createProbeRoutes({repo,dataRoot,json}) {
 let busy=false;
 const stateFile=join(dataRoot,'probe-current.json');
 async function save(state){await mkdir(dataRoot,{recursive:true,mode:0o700});const temporary=stateFile+'.'+randomUUID();await writeFile(temporary,JSON.stringify(state),{mode:0o600});await rename(temporary,stateFile);}
 async function model(){
  const current=await read(join(dataRoot,'science-current.json'));
  if(current?.status!=='succeeded'||!id.test(current.runId))return null;
  const summary=await read(join(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!summary?.sessionId||!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)return null;
  const response=await fetch(`${process.env.SCIENCE_URL}/sessions/${encodeURIComponent(summary.sessionId)}/commands`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.SCIENCE_TOKEN}`},body:JSON.stringify({action:'state'}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;return (await response.json()).state?.snapshot?.model_id??null;
 }
 return async(req,res,url)=>{
  if(!['/api/probe/status','/api/probe/import','/api/probe/fit'].includes(url.pathname))return false;
  try{
   const state=await read(stateFile)??{};
   if(req.method==='GET'&&url.pathname.endsWith('/status')){
    const imported=state.importId?await read(join(dataRoot,'probe-imports',state.importId,'summary.json')):null;
    const fit=state.fitId?await read(join(dataRoot,'probe-fits',state.fitId,'summary.json')):null;
    const measurement=imported?await read(join(dataRoot,'probe-imports',state.importId,imported.measurementPath)):null;
    const currentModelId=await model().catch(()=>null);
    const profile=await access(join(dataRoot,'probe-fit-profile.json')).then(()=>true).catch(()=>false);
    const fitBlockedReason=!imported?.eligible?'Import a probe with verified calibration first.':!currentModelId?'A current scientific model and worker are required.':!profile?'A declared private probe-fit-profile.json is required.':null;
    json(res,200,{busy,import:imported,fit,measurement,currentModelId,canFit:!busy&&!fitBlockedReason,fitBlockedReason,error:state.error??null});return true;
   }
   if(req.method!=='POST'||url.pathname.endsWith('/status')){json(res,405,{error:'Method not allowed'});return true;}
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('Request too large');}
   const body=JSON.parse(raw);const fitting=url.pathname.endsWith('/fit');
   if(!id.test(body.requestId??'')||Object.keys(body).some(k=>!(fitting?['requestId','importId','expectedModelId']:['requestId']).includes(k)))throw Error('Invalid probe request');
   if(fitting&&(!id.test(body.importId??'')||typeof body.expectedModelId!=='string'||body.expectedModelId.length>256))throw Error('Invalid probe fit identity');
   if(busy){json(res,409,{error:'A probe operation is already running'});return true;}
   if(state.requestId===body.requestId){json(res,200,{accepted:true,reused:true});return true;}
   if(fitting&&body.importId!==state.importId)throw Error('Import changed; refresh before fitting');
   const operationId=randomUUID();const folder=join(dataRoot,fitting?'probe-fits':'probe-imports',operationId);
   const next={...state,requestId:body.requestId,error:null,...(fitting?{fitId:operationId}:{importId:operationId,fitId:null})};
   busy=true;
   try{await save(next);}catch(error){busy=false;throw error;}
   const python=process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python');
   const args=[join(repo,'science/scripts',fitting?'run_probe_fit.py':'prepare_probe_capture.py'),'--data-root',dataRoot,'--output',folder];
   if(fitting)args.push('--import-id',body.importId,'--expected-model-id',body.expectedModelId);
   void execute(python,args,{cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src')].join(':')},timeout:240000,maxBuffer:65536})
    .catch(async error=>{const safe=(error.stderr??'').split('\n').filter(x=>/^(ValueError|FileNotFoundError):/.test(x)).at(-1);next.error=safe??'Probe processing failed; original bytes and available receipts were retained.';await save(next);})
    .finally(()=>{busy=false;}).catch(()=>{});
   json(res,202,{accepted:true});return true;
  }catch(error){json(res,400,{error:error instanceof SyntaxError?'Invalid JSON request':error.message});return true;}
 };
}
