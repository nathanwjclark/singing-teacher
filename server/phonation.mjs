import {readFile,writeFile,mkdir,rename,readdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const capability=(status,reason,evidenceAt=null)=>({status,reason,evidenceAt});
async function store(path,data){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});await rename(tmp,path);}
async function current(dataRoot){const current=await read(resolve(dataRoot,'science-current.json'));if(current.status!=='succeeded'||!validId(current.runId))throw Error('No completed voice fit');const summary=await read(resolve(dataRoot,'science-runs',current.runId,'summary.json'));if(!validId(summary.sessionId))throw Error('No session identity');return {runId:current.runId,sessionId:summary.sessionId,summary};}
async function history(dataRoot,sessionId){try{const dir=resolve(dataRoot,'phonation',sessionId);return (await Promise.all((await readdir(dir)).filter(n=>/^[a-f0-9-]+\.json$/.test(n)).map(n=>read(resolve(dir,n))))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
export async function readPhonationContext({dataRoot,enabled=process.env.PHONATION_MEASUREMENT_ENABLED==='1',now=Date.now(),maxAgeMs=300000}){
 const result={capabilityVersion:'optional-phonation-runtime-1.0.0',baselineScoring:'unchanged',measurement:capability('disabled','Optional phonation measurement is disabled'),inference:capability('disabled','Source inference is not connected to this session'),coaching:capability('disabled','No current verified phonation evidence'),latest:null,running:false};
 let context;try{context=await current(dataRoot);}catch{return {...result,measurement:capability(enabled?'unsupported':'disabled',enabled?'A fitted original recording is required':'Optional phonation measurement is disabled')};}
 const records=await history(dataRoot,context.sessionId),latest=records.at(-1)||null;result.latest=latest;result.sessionId=context.sessionId;result.runId=context.runId;
 if(!enabled)return result;
 let failures=0;for(const record of records.toReversed()){if(!['failed','timed-out','running'].includes(record.status))break;failures++;}if(failures>=3){result.measurement=capability('disabled','Three optional analyses failed in this session; start a new fit to recover',latest?.evidenceAt||null);return result;}
 if(!latest){result.measurement=capability('unsupported','Analyze a verified original recording to obtain phonation measurements');return result;}
 const evidenceAt=latest.evidenceAt||null;
 if(latest.status==='running'){result.measurement=capability('failed','Previous optional analysis was interrupted; retry deliberately',evidenceAt);return result;}
 result.measurement=capability(latest.status,latest.reason,evidenceAt);
 if(latest.status==='available'){
  const stale=latest.runId!==context.runId||!Number.isFinite(Date.parse(evidenceAt))||now-Date.parse(evidenceAt)>maxAgeMs;
  result.coaching=capability('unsupported','Saved recordings are dated history; live coaching requires fresh microphone evidence',evidenceAt);
  if(!stale)result.descriptors=latest.result;
 }
 return result;
}

function execute(repo,args,timeoutMs){return new Promise((resolvePromise,reject)=>{const child=spawn(process.execPath,['--experimental-strip-types',resolve(repo,'server/phonation-worker.mjs'),...args],{cwd:repo,stdio:['ignore','pipe','pipe']});let stdout='',overflow=false;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Object.assign(Error('Optional analysis timed out'),{kind:'timed-out'}));},timeoutMs);child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1000000){overflow=true;child.kill('SIGKILL');}});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('Optional analysis worker unavailable'));});child.on('close',code=>{clearTimeout(timer);if(code!==0||overflow){reject(Error('Optional analysis failed'));return;}try{resolvePromise(JSON.parse(stdout));}catch{reject(Error('Optional analysis returned invalid output'));}});});}
export function createPhonationRoutes({repo,dataRoot,json,enabled=process.env.PHONATION_MEASUREMENT_ENABLED==='1',analyze=execute,timeoutMs=15000}){
 let running=false;
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/phonation/'))return false;
  const host=req.headers.host,address=req.socket.remoteAddress?.replace(/^::ffff:/,'');
  if(!['127.0.0.1','::1'].includes(address)||!host||!/^((localhost|127\.0\.0\.1)|\[::1\])(:\d+)?$/.test(host)||(req.headers.origin&&!['http://'+host,'https://'+host].includes(req.headers.origin))){json(res,403,{error:'Use phonation from the local app'});return true;}
  try{
   if(url.pathname==='/api/phonation/status'&&req.method==='GET'){json(res,200,{...await readPhonationContext({dataRoot,enabled}),running});return true;}
   if(url.pathname!=='/api/phonation/analyze'||req.method!=='POST'){json(res,405,{error:'Method not allowed'});return true;}
   if(!enabled){json(res,200,await readPhonationContext({dataRoot,enabled}));return true;}
   if(running){json(res,409,{error:'Optional phonation analysis is already running'});return true;}
   if(url.search||Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding']){json(res,400,{error:'Analysis uses verified saved audio and accepts no parameters'});return true;}
   running=true;
   try{
    const context=await current(dataRoot),records=await history(dataRoot,context.sessionId);
    let failures=0;for(const record of records.toReversed()){if(!['failed','timed-out','running'].includes(record.status))break;failures++;}
    if(failures>=3){json(res,200,{...await readPhonationContext({dataRoot,enabled}),measurement:capability('disabled','Three optional analyses failed in this session; baseline remains available. Start a new fit to recover.')});return true;}
    try{await access(resolve(repo,'server/phonation-worker.mjs'));await access(resolve(repo,'src/phonation/measure.ts'));}catch{json(res,200,{...await readPhonationContext({dataRoot,enabled}),measurement:capability('unsupported','Optional extractor module is unavailable')});return true;}
    const id=randomUUID(),directory=resolve(dataRoot,'phonation',context.sessionId);await mkdir(directory,{recursive:true,mode:0o700});const path=resolve(directory,id+'.json');let receipt={id,runId:context.runId,sessionId:context.sessionId,createdAt:new Date().toISOString(),evidenceAt:context.summary.createdAt,status:'running',reason:'Optional original-audio analysis started',sourceImportSha256:context.summary.sourceImportSha256};await store(path,receipt);
    try{const result=await analyze(repo,[resolve(dataRoot,'science-runs',context.runId)],timeoutMs);if(!result||!['available','insufficient-quality','unsupported'].includes(result.status))throw Error('Invalid optional analysis result');receipt={...receipt,status:result.status,reason:result.reason,result,completedAt:new Date().toISOString()};}
    catch(error){receipt={...receipt,status:error.kind==='timed-out'?'timed-out':'failed',reason:error.kind==='timed-out'?'Optional analysis timed out; baseline unchanged':'Optional analysis failed; baseline unchanged',completedAt:new Date().toISOString()};}
    await store(path,receipt);json(res,200,{...await readPhonationContext({dataRoot,enabled}),running:false});return true;
   }finally{running=false;}
  }catch{json(res,200,{measurement:capability('failed','Optional phonation data unavailable; baseline remains usable'),inference:capability('disabled','Source inference unavailable'),coaching:capability('disabled','No usable phonation evidence'),latest:null,running:false});return true;}
 };
}
