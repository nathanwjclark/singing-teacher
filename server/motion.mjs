import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateLearningRecord} from '../src/contracts/learning.ts';

const JSON_LIMIT=4*1024*1024,MEDIA_LIMIT=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const identifier=/^[a-f0-9]{64}$/;

export function createMotionRoutes({dataRoot,json,repo=join(import.meta.dirname,'..')}){
 let importing=false;
 let analysisBusy=false,decoderCheck;
 const root=join(dataRoot,'motion-captures'),latest=join(dataRoot,'motion-latest.json');
 const analysisRoot=join(dataRoot,'motion-analyses');
 async function decoderAvailability(){
  if(!decoderCheck)decoderCheck=Promise.all([process.env.SINGING_FFMPEG||'ffmpeg',process.env.SINGING_FFPROBE||'ffprobe'].map(binary=>promisify(execFile)(binary,['-version'],{timeout:5000,maxBuffer:131072})))
   .then(()=>({available:true,reason:null})).catch(()=>({available:false,reason:'Optional audio decoding is unavailable on this Mac. Your motion recording remains saved and replayable.'}));
  return decoderCheck;
 }
 async function saveAnalysis(path,state){
  await mkdir(join(analysisRoot,state.captureId),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomUUID();await writeFile(temporary,JSON.stringify(state),{mode:0o600});await rename(temporary,path);
 }
 async function currentModel(){
  const current=await optional(join(dataRoot,'science-current.json'));
  if(current?.status!=='succeeded'||!/^[A-Za-z0-9_-]+$/.test(current.runId??''))return null;
  const voice=await optional(join(dataRoot,'science-runs',current.runId,'summary.json'));
  if(!voice?.sessionId||!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)return null;
  const response=await fetch(`${process.env.SCIENCE_URL}/sessions/${encodeURIComponent(voice.sessionId)}/commands`,
   {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.SCIENCE_TOKEN}`},body:JSON.stringify({action:'state'}),signal:AbortSignal.timeout(5000)});
  return response.ok?(await response.json()).state?.snapshot?.model_id??null:null;
 }
 async function verifyAnalysis(result,state){
  if(result.captureId!==state.captureId||result.modelId!==state.expectedModelId)throw Error('Audio analysis result identity differs from its declared capture or model.');
  const source=await capture(state.captureId),media=await readFile(join(root,state.captureId,'media'));
  const receipt=await readFile(join(root,state.captureId,'summary.json'));
  if(media.length!==source.summary.mediaByteLength||hash(media)!==source.summary.mediaSha256||
   result.sourceHashes?.media!==source.summary.mediaSha256||result.sourceHashes?.record!==source.summary.recordSha256||result.sourceHashes?.receipt!==hash(receipt))
   throw Error('Audio analysis original evidence hashes no longer agree.');
 }
 async function analysisStatus(captureId){
  if(!identifier.test(captureId??''))throw Error('Invalid motion capture identifier');
  const path=join(analysisRoot,captureId,'current.json');let state=await optional(path);
  const currentModelId=await currentModel().catch(()=>null);
  if(!state)return {status:'not-run',analysisId:null,error:null,result:null,resultCurrent:false,currentModelId,availability:await decoderAvailability()};
  const result=await optional(join(analysisRoot,captureId,state.analysisId,'summary.json'));
  if(result)await verifyAnalysis(result,state);
  // While this server's own worker is still running, complete() publishes the result
  // after the worker exits; flipping here would report success while a new analysis
  // is still refused. A summary left by an earlier server process is recovered.
  if(result&&state.status!=='succeeded'&&!analysisBusy){
   state={...state,status:'succeeded',error:null};await saveAnalysis(path,state);
  }else if(state.status==='running'&&!analysisBusy){
   let alive=false;try{if(Number.isSafeInteger(state.pid)&&state.pid>0){process.kill(state.pid,0);alive=true;}}catch{}
   if(!alive){state={...state,status:'interrupted',error:'Audio analysis was interrupted. Retry in the app; your saved evidence and model are unchanged.'};await saveAnalysis(path,state);}
  }
  return {...state,result,resultCurrent:!!result&&result.modelId===currentModelId,currentModelId,availability:await decoderAvailability()};
 }
 async function analyze(req,res,url){
  if(req.method==='GET'&&url.pathname.endsWith('/analysis')){
   json(res,200,await analysisStatus(url.searchParams.get('captureId')));return;
  }
  if(req.method!=='POST'||!url.pathname.endsWith('/analyze')){json(res,405,{error:'Method not allowed'});return;}
  if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw Error('Expected a small JSON audio declaration.');
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2048)throw Error('Audio declaration is too large.');chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!body||Object.keys(body).sort().join(',')!=='captureId,containsExternalExcitation,pose,requestId'||!identifier.test(body.captureId??'')||
   !/^[A-Za-z0-9_-]{1,100}$/.test(body.requestId??'')||!['a','e','i','o','u'].includes(body.pose)||body.containsExternalExcitation!==false)
   throw Error('Declare a saved capture, vowel and no external excitation.');
  await capture(body.captureId);
  const previous=await analysisStatus(body.captureId);
  if(previous.requestId===body.requestId&&(previous.pose!==body.pose||previous.expectedModelId!==previous.currentModelId)){
   json(res,409,{error:'This request ID belongs to a different vowel or baseline model. Start a new analysis request.'});return;
  }
  if(previous.requestId===body.requestId&&previous.status==='succeeded'&&previous.result?.analysisPolicy==='motion-forward-bank-2'){json(res,200,{accepted:true,reused:true,analysisId:previous.analysisId});return;}
  if(analysisBusy||previous.status==='running'){json(res,409,{error:'An audio analysis is already running.'});return;}
  if(!previous.availability.available){json(res,503,{error:previous.availability.reason});return;}
  if(!previous.currentModelId){json(res,503,{error:'Complete a voice model fit and connect its worker before analyzing motion audio.'});return;}
  const analysisId=randomUUID(),path=join(analysisRoot,body.captureId,'current.json');
  const state={analysisId,captureId:body.captureId,requestId:body.requestId,pose:body.pose,expectedModelId:previous.currentModelId,status:'running',error:null,startedAt:new Date().toISOString()};
  analysisBusy=true;
  try{await saveAnalysis(path,state);}catch(error){analysisBusy=false;throw error;}
  const output=join(analysisRoot,body.captureId,analysisId),python=process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python');
  const child=spawn(python,[join(repo,'science/scripts/app_motion.py'),'--data-root',dataRoot,'--capture-id',body.captureId,'--pose',body.pose,'--expected-model-id',state.expectedModelId,'--output',output],
   {cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src')].join(':')},detached:true,stdio:['ignore','ignore','pipe']});
  let stderr='',settled=false,timedOut=false,force;
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});
  const kill=signal=>{try{if(child.pid)process.kill(-child.pid,signal);}catch{}};
  const timeout=setTimeout(()=>{timedOut=true;kill('SIGTERM');force=setTimeout(()=>kill('SIGKILL'),2000);},240000);
  const complete=async(code,error)=>{
   if(settled)return;settled=true;clearTimeout(timeout);if(force)clearTimeout(force);
   if(timedOut)kill('SIGKILL');
   try{
    const result=await optional(join(output,'summary.json'));
    if(result)await verifyAnalysis(result,state);
    state.status=!error&&code===0&&result?'succeeded':'failed';
    state.error=state.status==='succeeded'?null:timedOut?'Audio analysis reached its time limit. Retry in the app; the model was not changed.':
     stderr.split('\n').findLast(line=>/^(ValueError|RuntimeError|FileNotFoundError):/.test(line))||'Audio analysis could not finish. Your original recording and model were preserved.';
    await saveAnalysis(path,state);
   }catch{state.status='failed';state.error='Audio result verification failed; the original capture and model were preserved.';await saveAnalysis(path,state);}finally{analysisBusy=false;}
  };
  child.once('error',error=>{void complete(null,error).catch(()=>{});});child.once('close',code=>{void complete(code,null).catch(()=>{});});
  if(child.pid){state.pid=child.pid;await saveAnalysis(path,state);}
  json(res,202,{accepted:true,analysisId});
 }
 async function capture(id){
  if(!identifier.test(id??''))throw Error('Invalid motion capture identifier');
  const summary=await optional(join(root,id,'summary.json'));
  if(!summary)throw Error('Motion capture not found');
  const record=await readFile(join(root,id,'record.json'));
  if(hash(record)!==summary.recordSha256)throw Error('Stored motion JSON integrity mismatch');
  return {summary,record};
 }
 return async(req,res,url)=>{
  if(!['/api/motion/import','/api/motion/status','/api/motion/record','/api/motion/media','/api/motion/analyze','/api/motion/analysis'].includes(url.pathname))return false;
  let local=false;
  try{local=['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))&&['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)&&(!req.headers.origin||new URL(req.headers.origin).host===req.headers.host);}catch{}
  if(!local){json(res,403,{error:'Use this Mac’s localhost page to retain private motion evidence.'});return true;}
  if(url.pathname.endsWith('/analyze')||url.pathname.endsWith('/analysis')){
   try{await analyze(req,res,url);}catch(error){json(res,400,{error:error instanceof SyntaxError?'Invalid audio declaration.':error.code?'Audio analysis could not start; original evidence was preserved.':error.message});}
   return true;
  }
  if(req.method==='GET'){
   try{
    if(url.pathname.endsWith('/status')){
     const pointer=await optional(latest);
     if(!pointer){json(res,200,{busy:importing,capture:null,record:null});return true;}
     const value=await capture(pointer.id);
     json(res,200,{busy:importing,capture:value.summary,record:JSON.parse(value.record)});return true;
    }
    if(!url.pathname.endsWith('/record')&&!url.pathname.endsWith('/media')){json(res,405,{error:'Method not allowed'});return true;}
    const id=url.searchParams.get('id'),value=await capture(id),isMedia=url.pathname.endsWith('/media');
    const bytes=isMedia?await readFile(join(root,id,'media')):value.record;
    if(isMedia&&(hash(bytes)!==value.summary.mediaSha256||bytes.length!==value.summary.mediaByteLength))throw Error('Stored companion media integrity mismatch');
    res.writeHead(200,{'Content-Type':isMedia?value.summary.mimeType.split(';')[0]:'application/json','Content-Length':bytes.length,
     'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
     'Content-Disposition':`attachment; filename="motion-${id}.${isMedia?(value.summary.mimeType.startsWith('video/mp4')?'mp4':'webm'):'json'}"`});
    res.end(bytes);return true;
   }catch(error){json(res,409,{error:error.code?'Private motion evidence could not be read.':error.message});return true;}
  }
  if(req.method!=='POST'||!url.pathname.endsWith('/import')){json(res,405,{error:'Method not allowed'});return true;}
  if(importing){json(res,409,{error:'A motion import is already running.'});return true;}
  importing=true;
  let staging;
  try{
   const contentType=req.headers['content-type']??'';
   if(url.search||!contentType.startsWith('multipart/form-data;'))throw Error('Send the original motion JSON and companion media as multipart files.');
   const limit=JSON_LIMIT+MEDIA_LIMIT+65536,length=Number(req.headers['content-length']);
   if(Number.isFinite(length)&&length>limit)throw Error('Motion upload exceeds the 68 MiB limit.');
   let count=0;const chunks=[];
   for await(const chunk of req){count+=chunk.length;if(count>limit)throw Error('Motion upload exceeds the 68 MiB limit.');chunks.push(chunk);}
   const form=await new Request('http://localhost/upload',{method:'POST',headers:{'content-type':contentType},body:Buffer.concat(chunks)}).formData();
   if([...form.keys()].sort().join(',')!=='media,record')throw Error('Exactly one record file and one media file are required.');
   const recordFile=form.get('record'),mediaFile=form.get('media');
   if(typeof recordFile==='string'||typeof mediaFile==='string'||!recordFile||!mediaFile)throw Error('Choose both original files.');
   if(recordFile.size<1||recordFile.size>JSON_LIMIT||mediaFile.size<1||mediaFile.size>MEDIA_LIMIT)throw Error('Motion JSON must be at most 4 MiB and companion media at most 64 MiB.');
   const recordBytes=Buffer.from(await recordFile.arrayBuffer()),mediaBytes=Buffer.from(await mediaFile.arrayBuffer());
   const record=JSON.parse(recordBytes.toString('utf8')),checked=validateLearningRecord(record);
   if(!checked.valid||record.kind!=='motion-observation')throw Error('Invalid motion observation: '+checked.errors.slice(0,4).join('; '));
   const media=record.media;
   if(!media||!identifier.test(media.sha256??'')||!Number.isSafeInteger(media.byteLength))throw Error('This recording lacks its original media integrity binding; export a new capture.');
   if(!/^video\/(webm|mp4)(?:;[^\r\n]*)?$/.test(media.mimeType))throw Error('Only recorded WebM or MP4 companion media is supported.');
   if(mediaBytes.length!==media.byteLength||hash(mediaBytes)!==media.sha256)throw Error('Companion media does not match the motion JSON hash and byte length.');
   if(!record.provenance.sourceHashes.includes(media.sha256))throw Error('Motion provenance does not bind the companion media hash.');
   const recordSha256=hash(recordBytes),id=hash(Buffer.from(recordSha256+media.sha256));
   const summary={id,observationId:record.id,attemptId:record.attemptId,recordSha256,mediaSha256:media.sha256,
    mediaByteLength:mediaBytes.length,mimeType:media.mimeType,sampleCount:record.samples.length,
    timingGaps:record.samples.filter(sample=>sample.gapBefore).length,
    unsuccessfulMarkers:record.markers.filter(marker=>marker.type==='unsuccessful').length,
    syncUncertaintyMs:record.timebase.syncUncertaintyMs,missing:record.missing,
    status:'retained-byte-verified',includedInPhysicalFit:false,
    interpretation:'Original 2D tracking estimates and media retained; no calibrated depth, inferred articulation or anatomical limits established.'};
   await mkdir(root,{recursive:true,mode:0o700});
   const existing=await optional(join(root,id,'summary.json'));
   if(existing){
    const saved=await capture(id),original=await readFile(join(root,id,'media'));
    if(JSON.stringify(existing)!==JSON.stringify(summary)||!saved.record.equals(recordBytes)||!original.equals(mediaBytes))throw Error('Existing motion evidence changed; original files were preserved.');
   }else{
    staging=join(root,'.incoming-'+randomUUID());await mkdir(staging,{mode:0o700});
    for(const [name,bytes] of [['record.json',recordBytes],['media',mediaBytes],['summary.json',JSON.stringify(summary)]])await writeFile(join(staging,name),bytes,{mode:0o600,flag:'wx'});
    await rename(staging,join(root,id));staging=null;
   }
   const pointer=latest+'.'+randomUUID();await writeFile(pointer,JSON.stringify({id}),{mode:0o600,flag:'wx'});await rename(pointer,latest);
   json(res,200,{capture:summary,reused:!!existing});
  }catch(error){json(res,400,{error:error instanceof SyntaxError?'Invalid motion JSON.':error.code?'Motion import failed; existing evidence was preserved.':error.message});}
  finally{if(staging)await rm(staging,{recursive:true,force:true});importing=false;}
  return true;
 };
}
