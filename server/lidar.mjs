import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const execute=promisify(execFile),id=/^[A-Za-z0-9_-]{1,100}$/;
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export function createLidarRoutes({repo,dataRoot,json}){
 let busy=false;
 const currentFile=join(dataRoot,'lidar-fit-current.json');
 const successFile=join(dataRoot,'lidar-last-success.json');
 const enabled=()=>process.env.LIDAR_FUSION_ENABLED==='1';
 async function save(state){await mkdir(dataRoot,{recursive:true,mode:0o700});const temp=currentFile+'.'+randomUUID();await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,currentFile);}
 async function rememberSuccess(state){
  if(!id.test(state.fitId??''))return;
  const result=await read(join(dataRoot,'lidar-fits',state.fitId,'summary.json'));
  if(result?.adoption?.model_updated!==true||result.adoption.model_id!==result.modelId||result.fitId!==state.fitId)return;
  const value={fitId:state.fitId,modelId:result.modelId,sessionId:result.sessionId};
  const previous=await read(successFile);if(previous?.fitId===state.fitId)return;
  const temporary=successFile+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,successFile);
 }
 const python=()=>process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python');
 const args=(operation)=>[join(repo,'science/scripts/app_lidar.py'),'--operation',operation,'--data-root',dataRoot];
 const options=(timeout=90000)=>({cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src')].join(':')},timeout,maxBuffer:8*1024*1024});
 async function model(){
  const current=await read(join(dataRoot,'science-current.json'));
  if(current?.status!=='succeeded'||!id.test(current.runId))return null;
  const summary=await read(join(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!summary?.sessionId||!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)return null;
  const result=await fetch(`${process.env.SCIENCE_URL}/sessions/${encodeURIComponent(summary.sessionId)}/commands`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.SCIENCE_TOKEN}`},body:JSON.stringify({action:'state'}),signal:AbortSignal.timeout(5000)});
  return result.ok?(await result.json()).state?.snapshot?.model_id??null:null;
 }
 async function launch(state){
  busy=true;state.running=true;state.error=null;
  try{await save(state);}catch(error){busy=false;throw error;}
  const folder=join(dataRoot,'lidar-fits',state.fitId);
  void execute(python(),[...args('fit'),'--request',join(folder,'app-request.json'),'--output',folder],options(240000))
   .catch(error=>{state.error=(error.stderr??'').split('\n').findLast(line=>/^(ValueError|RuntimeError|FileNotFoundError):/.test(line))||'LiDAR fit paused. Retry in the app to recover its recorded job; baseline and original evidence were preserved.';})
   .finally(async()=>{state.running=false;await rememberSuccess(state);await save(state);busy=false;}).catch(()=>{busy=false;});
 }
 return async(req,res,url)=>{
  if(!['/api/lidar/status','/api/lidar/import','/api/lidar/frame','/api/lidar/rgb','/api/lidar/fit','/api/lidar/artifact'].includes(url.pathname))return false;
  let local=false;try{local=['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))&&['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host);}catch{}
  if(!local){json(res,403,{error:'Use this Mac’s localhost page for experimental LiDAR fitting.'});return true;}
  try{
   let state=await read(currentFile)??{};
   if(state.running&&!busy&&enabled())await launch(state);
   if(url.pathname.endsWith('/status')&&req.method==='GET'){
    const capture=await read(join(dataRoot,'lidar-current.json'));
    const result=state.fitId?await read(join(dataRoot,'lidar-fits',state.fitId,'summary.json')):null;
    const currentModelId=await model().catch(()=>null);
    await rememberSuccess(state);
    const successful=await read(successFile);
    const saved=successful&&id.test(successful.fitId??'')?await read(join(dataRoot,'lidar-fits',successful.fitId,'summary.json')):null;
    const lastSuccessfulResult=saved?.fitId===successful?.fitId&&saved?.modelId===successful?.modelId&&saved?.sessionId===successful?.sessionId&&saved?.adoption?.model_updated===true&&saved?.adoption?.model_id===saved?.modelId?saved:null;
    const pull=await read(join(dataRoot,'native-pull-latest.json'));
    json(res,200,{enabled:enabled(),busy,capture,currentModelId,result,error:state.error??null,
     resultCurrent:!!result&&result.modelId===currentModelId,lastSuccessfulResult,lastSuccessfulResultCurrent:!!lastSuccessfulResult&&lastSuccessfulResult.modelId===currentModelId,
     availableArchive:pull?.name?.startsWith('rear-lidar-')?{name:pull.name,sha256:pull.sha256}:null});return true;
   }
   if(!enabled()){json(res,503,{error:'Optional LiDAR fusion is disabled; baseline modeling remains available.'});return true;}
   if(url.pathname.endsWith('/artifact')&&req.method==='GET'){
    const fitId=url.searchParams.get('fitId'),name=url.searchParams.get('name');
    if(!id.test(fitId??'')||!['tract0.obj','tract0.mtl','tract.svg','geometry.json','manifest.json','space-diff.json'].includes(name))throw Error('Unknown LiDAR geometry artifact');
    const folder=join(dataRoot,'lidar-fits',fitId),summary=await read(join(folder,'summary.json')),entry=summary?.geometry?.files?.[name];
    if(!entry)throw Error('Adopted geometry artifact is unavailable');
    const bytes=await readFile(join(folder,'geometry',name));
    if(bytes.length!==entry.byteLength||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Adopted geometry artifact hash mismatch');
    res.writeHead(200,{'Content-Type':name.endsWith('.json')?'application/json':name.endsWith('.svg')?'image/svg+xml':'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return true;
   }
   if(['/api/lidar/frame','/api/lidar/rgb'].includes(url.pathname)&&req.method==='GET'){
    const captureId=url.searchParams.get('captureId'),sequence=Number(url.searchParams.get('sequence'));
    if(!id.test(captureId??'')||!Number.isSafeInteger(sequence)||sequence<0)throw Error('Select an original scan frame.');
    const capture=await read(join(dataRoot,'lidar-current.json'));
    if(capture?.captureId!==captureId)throw Error('Selected scan changed; refresh before annotation.');
    if(url.pathname.endsWith('/frame')){
     const result=await execute(python(),[...args('frame'),'--capture-id',captureId,'--sequence',String(sequence)],options());json(res,200,JSON.parse(result.stdout));return true;
    }
    const frame=capture.frames.find(f=>f.sequence===sequence),artifact=frame?.rgbArtifact;
    if(!artifact||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifact.path))throw Error('Original RGB is unavailable for this frame.');
    const bytes=await readFile(join(dataRoot,'lidar-imports',capture.importId,'capture',artifact.path));
    if(bytes.length!==artifact.bytes||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw Error('Original RGB hash mismatch.');
    res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return true;
   }
   if(req.method!=='POST'||!['/api/lidar/import','/api/lidar/fit'].includes(url.pathname)){json(res,405,{error:'Method not allowed'});return true;}
   if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw Error('Send a JSON experimental declaration.');
   let count=0;const chunks=[];for await(const chunk of req){count+=chunk.length;if(count>16000)throw Error('LiDAR declaration is too large');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(busy){json(res,409,{error:'LiDAR processing is already running.'});return true;}
   if(url.pathname.endsWith('/import')){
    if(!body||Object.keys(body).length)throw Error('Import takes an empty JSON object.');busy=true;
    try{const result=await execute(python(),args('import'),options());json(res,200,{capture:JSON.parse(result.stdout)});}finally{busy=false;}return true;
   }
   if(!body||Object.keys(body).sort().join(',')!=='annotation,captureId,expectedModelId,requestId'||!id.test(body.captureId??'')||!id.test(body.requestId??'')||typeof body.expectedModelId!=='string'||body.expectedModelId.length>256||!body.annotation||typeof body.annotation!=='object')throw Error('Declare a current scan, baseline and experimental annotation.');
   const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex');
   if(state.requestId===body.requestId&&state.fingerprint!==fingerprint){json(res,409,{error:'This request ID already identifies a different declaration.'});return true;}
   if(state.fitId){
    const folder=join(dataRoot,'lidar-fits',state.fitId),intent=await read(join(folder,'intent.json')),failure=await read(join(folder,'failure.json'));
    if(state.requestId===body.requestId&&!state.error&&await read(join(folder,'summary.json'))){json(res,200,{accepted:true,reused:true});return true;}
    if(intent&&!failure&&!await read(join(folder,'summary.json'))){
     if(state.fingerprint!==fingerprint){json(res,409,{error:'Retry the previous LiDAR declaration before starting a different fit.'});return true;}
     await launch(state);json(res,202,{accepted:true,reused:true,fitId:state.fitId});return true;
    }
   }
   const capture=await read(join(dataRoot,'lidar-current.json'));
   if(capture?.captureId!==body.captureId)throw Error('Selected rear scan changed; refresh.');
   const currentModelId=await model();if(currentModelId!==body.expectedModelId)throw Error('Baseline model changed; refresh.');
   const fitId=randomUUID(),folder=join(dataRoot,'lidar-fits',fitId);await mkdir(folder,{recursive:true,mode:0o700});
   await writeFile(join(folder,'app-request.json'),JSON.stringify(body),{mode:0o600,flag:'wx'});
   state={fitId,requestId:body.requestId,fingerprint,captureId:body.captureId,expectedModelId:body.expectedModelId};await launch(state);
   json(res,202,{accepted:true,fitId});return true;
  }catch(error){const reason=(error.stderr??'').split('\n').findLast(line=>/^(ValueError|RuntimeError|FileNotFoundError):/.test(line));json(res,400,{error:reason||(!error.code?error.message:'LiDAR processing could not finish; originals and baseline were retained.')});return true;}
 };
}
