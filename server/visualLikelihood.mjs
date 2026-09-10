import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const execute=promisify(execFile),id=/^[A-Za-z0-9_-]{1,100}$/,captureId=/^[a-f0-9]{64}$/;
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function createVisualLikelihoodRoutes({repo,dataRoot,json}){
 let busy=false;
 const pointer=join(dataRoot,'visual-current.json'),enabled=()=>process.env.VISUAL_LIKELIHOOD_ENABLED==='1';
 const python=()=>process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python');
 const args=operation=>[join(repo,'science/scripts/app_visual.py'),'--operation',operation,'--data-root',dataRoot];
 const options=timeout=>({cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src')].join(':')},timeout,maxBuffer:8*1024*1024});
 async function save(value){await mkdir(dataRoot,{recursive:true,mode:0o700});const temporary=pointer+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,pointer);}
 async function session(){
  const current=await read(join(dataRoot,'science-current.json'));
  if(current?.status!=='succeeded'||!id.test(current.runId??''))return null;
  const voice=await read(join(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!voice?.sessionId||!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)return null;
  const response=await fetch(`${process.env.SCIENCE_URL}/sessions/${encodeURIComponent(voice.sessionId)}/commands`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.SCIENCE_TOKEN}`},body:JSON.stringify({action:'state'}),signal:AbortSignal.timeout(5000)});
  return response.ok?(await response.json()).state:null;
 }
 async function launch(state){
  busy=true;state.running=true;state.error=null;await save(state);
  const folder=join(dataRoot,'visual-runs',state.runId);
  void execute(python(),[...args('execute'),'--request',join(folder,'request.json'),'--output',folder],options(240000))
   .catch(error=>{state.error=(error.stderr??'').split('\n').findLast(line=>/^(ValueError|RuntimeError|FileNotFoundError):/.test(line))||'Visual processing paused; retry to recover the recorded scientific job.';})
   .finally(async()=>{state.running=false;await save(state);busy=false;}).catch(()=>{busy=false;});
 }
 return async(req,res,url)=>{
  if(!['/api/visual/status','/api/visual/frames','/api/visual/frame','/api/visual/freeze','/api/visual/score'].includes(url.pathname))return false;
  let local=false;try{local=['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))&&['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host);}catch{}
  if(!local){json(res,403,{error:'Use this Mac’s localhost page for private visual experiments.'});return true;}
  try{
   let state=await read(pointer)??{};
   if(state.running&&!busy&&enabled())await launch(state);
   if(req.method==='GET'&&url.pathname.endsWith('/status')){
    const wasBusy=busy,captures=[];
    for(const name of await readdir(join(dataRoot,'motion-captures')).catch(()=>[])){
     if(!captureId.test(name)||captures.length>=100)continue;
     const receipt=await read(join(dataRoot,'motion-captures',name,'summary.json'));
     if(receipt)captures.push({captureId:name,observationId:receipt.observationId,mediaSha256:receipt.mediaSha256,mimeType:receipt.mimeType});
    }
    const latestResult=state.runId?await read(join(dataRoot,'visual-runs',state.runId,'summary.json')):null;
    const current=await session().catch(()=>null);
    json(res,200,{enabled:enabled(),busy:wasBusy||busy,captures,currentModelId:current?.snapshot?.model_id??null,
     sessionId:current?.session_id??null,visualForecasts:current?.visual_forecasts??{},latestResult,error:state.error??null});return true;
   }
   if(!enabled()){json(res,503,{error:'Optional conditional visual likelihood is disabled. Baseline modeling and saved motion remain available.'});return true;}
   if(req.method==='GET'&&url.pathname.endsWith('/frame')){
    const capture=url.searchParams.get('captureId'),index=Number(url.searchParams.get('frameIndex'));
    if(!captureId.test(capture??'')||!Number.isSafeInteger(index)||index<0)throw Error('Select an exact original video frame.');
    const result=JSON.parse((await execute(python(),[...args('frame'),'--capture-id',capture,'--frame-index',String(index)],options(45000))).stdout);
    const raw=await readFile(join(dataRoot,'visual-frames',capture,`frame-${index}.png`));
    if(raw.length!==result.pngByteLength||createHash('sha256').update(raw).digest('hex')!==result.pngSha256)throw Error('Decoded frame integrity mismatch');
    res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(raw);return true;
   }
   if(req.method!=='POST'||url.pathname.endsWith('/status')||url.pathname.endsWith('/frame')){json(res,405,{error:'Method not allowed'});return true;}
   if(busy){json(res,409,{error:'A visual experiment is already running.'});return true;}
   if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw Error('Send a JSON visual declaration.');
   let count=0;const chunks=[];for await(const chunk of req){count+=chunk.length;if(count>32000)throw Error('Visual declaration is too large');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!body||!captureId.test(body.captureId??''))throw Error('Select a saved motion recording.');
   if(url.pathname.endsWith('/frames')){
    if(Object.keys(body).join(',')!=='captureId')throw Error('Frame indexing takes only captureId.');
    busy=true;try{const output=await execute(python(),[...args('frames'),'--capture-id',body.captureId],options(45000));json(res,200,JSON.parse(output.stdout));}finally{busy=false;}return true;
   }
   const operation=url.pathname.endsWith('/freeze')?'freeze':'score';
   const fields=operation==='freeze'?['requestId','expectedModelId','forecastId','captureId','cameraCandidates','calibrationFrames','targets','calibrationTolerancePx','experimentalDeclaration']:
    ['requestId','forecastId','captureId','annotations','experimentalDeclaration'];
   if(Object.keys(body).sort().join(',')!==fields.sort().join(',')||!id.test(body.requestId??'')||!id.test(body.forecastId??'')||body.experimentalDeclaration!==true)throw Error('Complete the explicit visual experiment declaration.');
   const request={...body,operation},fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
   if(state.requestId===body.requestId&&state.fingerprint!==fingerprint){json(res,409,{error:'This request ID belongs to different visual annotations.'});return true;}
   if(state.runId){
    const folder=join(dataRoot,'visual-runs',state.runId),intent=await read(join(folder,'intent.json')),finished=await read(join(folder,'summary.json')),failed=await read(join(folder,'failure.json'));
    if(state.requestId===body.requestId&&finished){json(res,200,{accepted:true,reused:true});return true;}
    if(intent&&!finished&&!failed){
     if(state.fingerprint!==fingerprint){json(res,409,{error:'Retry the pending visual declaration before starting another.'});return true;}
     await launch(state);json(res,202,{accepted:true,reused:true});return true;
    }
   }
   const current=await session();if(!current?.snapshot)throw Error('Complete a baseline model and connect its scientific worker.');
   if(operation==='freeze'&&body.expectedModelId!==current.snapshot.model_id)throw Error('Baseline changed; refresh before freezing.');
   const runId=randomUUID(),folder=join(dataRoot,'visual-runs',runId);await mkdir(folder,{recursive:true,mode:0o700});
   await writeFile(join(folder,'request.json'),JSON.stringify(request),{mode:0o600,flag:'wx'});
   state={runId,requestId:body.requestId,fingerprint,captureId:body.captureId,forecastId:body.forecastId,operation};await launch(state);
   json(res,202,{accepted:true,runId,forecastId:body.forecastId});return true;
  }catch(error){const reason=(error.stderr??'').split('\n').findLast(line=>/^(ValueError|RuntimeError|FileNotFoundError):/.test(line));json(res,400,{error:reason||(!error.code?error.message:'Visual processing could not finish; original evidence and baseline remain available.')});return true;}
 };
}
