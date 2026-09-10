import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const read=async path=>JSON.parse(await readFile(path,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
const save=async(path,value)=>{const temporary=path+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);};
const names=new Set(['before-tract.svg','after-tract.svg','before-geometry.json','after-geometry.json','before-audio.wav','after-audio.wav']);

export function createTeachingRoutes({repo,dataRoot,json,enabled=process.env.VISUAL_TEACHING_MODEL_ENABLED==='1',audioEnabled=process.env.VISUAL_TEACHING_AUDIO_ENABLED==='1',fetchImpl=fetch}){
 let running=false,child=null;
 const index=resolve(dataRoot,'teaching-current.json');
 async function context(){
  const current=await read(resolve(dataRoot,'science-current.json'));if(current.status!=='succeeded'||!/^run-[A-Za-z0-9_-]+$/.test(current.runId||''))throw Error('A completed voice fit is required');
  const dir=resolve(dataRoot,'science-runs',current.runId),summary=await read(resolve(dir,'summary.json'));
  let pointer;try{pointer=await read(resolve(dir,'astra-current.json'));}catch(error){if(error.code!=='ENOENT')throw error;pointer=summary;}
  let resting=false;try{await readFile(resolve(dir,'astra-rest.json'));resting=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  const base=new URL(process.env.SCIENCE_URL||'');if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!process.env.SCIENCE_TOKEN)throw Error('Scientific worker unavailable');
  const response=await fetchImpl(new URL('/sessions/'+encodeURIComponent(summary.sessionId)+'/state',base),{headers:{Authorization:'Bearer '+process.env.SCIENCE_TOKEN},signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('Scientific worker unavailable');const state=(await response.json()).state;
  return {runId:current.runId,sessionId:summary.sessionId,pointer,state,resting};
 }
 function isCurrent(c,r){const design=c.state?.designs?.[r.designId];return !c.resting&&!c.state.pending&&c.runId===r.runId&&c.sessionId===r.sessionId&&c.state.snapshot?.model_id===r.modelId&&c.pointer.designId===r.designId&&design?.status==='committed'&&(!r.frozenForecast||canonical(design.data)===canonical(r.frozenForecast));}
 function assets(result){const value=structuredClone(result);for(const side of ['before','after']){for(const field of ['svg','data']){const entry=value[side]?.geometry?.[field];if(entry)entry.url='/api/teaching/asset?attempt='+encodeURIComponent(value.attemptId)+'&name='+entry.name;}if(value[side]?.audio)value[side].audio.url='/api/teaching/asset?attempt='+encodeURIComponent(value.attemptId)+'&name='+value[side].audio.name;}return value;}
 async function status(){
  if(!enabled)return {enabled,audioEnabled,status:'disabled',current:false,reason:'Personalized teaching is disabled; general explanations remain available'};
  let saved;try{saved=await read(index);}catch{saved={status:'not-run'};}
  let result=saved.result?assets(saved.result):undefined;
  if(result&&!audioEnabled){for(const side of ['before','after'])if(result[side])delete result[side].audio;if(result.capabilities)result.capabilities.synthesis={available:false,reason:'Model synthesis playback is disabled'};}
  let c;try{c=await context();}catch{return {enabled,audioEnabled,...saved,result,status:running?'running':saved.status==='running'?'failed':saved.status,current:false,reason:'Scientific worker unavailable; retained predictions are historical'};}
  if(result){
   const job=[...(c.state.jobs||[])].reverse().find(j=>j.request?.operation==='update_pcm'&&j.result?.observation_receipt?.observation_id===result.targetObservationId&&j.result.observation_receipt.design_sha256===result.forecastSha256);
   if(job){const outcome=job.result,receipt=outcome.observation_receipt;
    result.outcome={evidenceMode:'recorded-result',attemptId:job.job_id,observationId:receipt.observation_id,observedAt:receipt.observed_at,
     sourceKind:job.request.parameters.source_kind,canonical:receipt.canonical,predictionErrors:outcome.scores||[],
     modelUpdated:job.status==='succeeded'&&typeof outcome.updated_snapshot?.model_id==='string'&&outcome.updated_snapshot.model_id!==result.modelId,
     previousModelId:result.modelId,resultModelId:outcome.updated_snapshot?.model_id??null,
     originalAudio:{available:false,reason:'Original recording playback is not exposed by this teaching view'},
     interpretation:'Recorded acoustic differences do not confirm that the illustrated internal movement occurred.'};
   }
  }
  const current=result?isCurrent(c,result):false;
  return {enabled,audioEnabled,...saved,result,status:running?'running':saved.status==='running'?'failed':saved.status,current,
   currentModelId:c.state.snapshot?.model_id,currentDesignId:c.pointer.designId,
   ...(result&&!current?{reason:'This prediction is historical; the session or recording design has advanced'}:{})};
 }
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/teaching/'))return false;
  const host=req.headers.host,address=req.socket.remoteAddress?.replace(/^::ffff:/,'');if(!['127.0.0.1','::1'].includes(address)||!/^((localhost|127\.0\.0\.1)|\[::1\])(:\d+)?$/.test(host||'')||(req.headers.origin&&!['http://'+host,'https://'+host].includes(req.headers.origin))){json(res,403,{error:'Use teaching from the local app'});return true;}
  try{
   if(req.method==='GET'&&url.pathname==='/api/teaching/status'){json(res,200,await status());return true;}
   if(req.method==='GET'&&url.pathname==='/api/teaching/asset'){
    const attempt=url.searchParams.get('attempt'),name=url.searchParams.get('name');if(!enabled||!/^teaching-[a-f0-9-]+$/.test(attempt||'')||!names.has(name)||name.endsWith('.wav')&&!audioEnabled){json(res,404,{error:'Teaching asset unavailable'});return true;}
    const dir=resolve(dataRoot,'teaching-attempts',attempt),result=await read(resolve(dir,'result.json')),bound=result.files[name],bytes=await readFile(resolve(dir,name));
    if(!bound||bound.sha256!==hash(bytes)||bound.byteLength!==bytes.length)throw Error('Teaching asset integrity mismatch');
    res.writeHead(200,{'Content-Type':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.wav')?'audio/wav':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(bytes);return true;
   }
   if(req.method!=='POST'||url.pathname!=='/api/teaching/prepare'){json(res,405,{error:'Method not allowed'});return true;}
   if(!enabled){json(res,200,await status());return true;}
   if(running){json(res,409,{error:'Teaching export is already running'});return true;}
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>2048)throw Error('Teaching request too large');chunks.push(chunk);}
   const request=JSON.parse(Buffer.concat(chunks).toString());if(Object.keys(request).sort().join(',')!=='demonstrationId,designId,modelId'||!['cricothyroid-pitch','soft-palate-coupling','tongue-jaw-vowels','source-filter'].includes(request.demonstrationId))throw Error('Unsupported teaching request');
   if(request.demonstrationId!=='tongue-jaw-vowels'){json(res,200,{status:'educational-only',demonstrationId:request.demonstrationId,reason:'This mechanism has general educational support; no personalized operator is available'});return true;}
   const c=await context();if(!isCurrent(c,{...request,runId:c.runId,sessionId:c.sessionId}))throw Error('A current committed recording design is required');
   const prior=await status();if(prior.current&&prior.result?.designId===request.designId&&prior.result?.modelId===request.modelId&&prior.result?.capabilities.synthesis.available===audioEnabled){json(res,200,prior);return true;}
   running=true;const attempt='teaching-'+randomUUID(),output=resolve(dataRoot,'teaching-attempts',attempt);await mkdir(output,{recursive:true,mode:0o700});await save(resolve(output,'request.json'),request);
   const record={status:'running',attemptId:attempt};await save(index,record);
   const args=[resolve(repo,'science/scripts/app_teaching.py'),'--data-root',dataRoot,'--output',output,'--request',resolve(output,'request.json'),...(audioEnabled?['--audio']:[])];
   child=spawn(process.env.SINGING_PYTHON||resolve(repo,'science/.venv/bin/python'),args,{cwd:repo,env:{...process.env,PYTHONPATH:repo+':'+resolve(repo,'science/src')},stdio:['ignore','ignore','ignore']});
   const timer=setTimeout(()=>child?.kill('SIGTERM'),120000);child.once('error',()=>{});child.once('close',async code=>{clearTimeout(timer);try{const result=code===0?await read(resolve(output,'result.json')):null;await save(index,{...record,status:result?'succeeded':'failed',...(result?{result}:{reason:'Optional teaching export unavailable; text coaching remains available'})});}catch{console.error('Teaching completion could not be saved');}finally{running=false;child=null;}});
   json(res,202,record);return true;
  }catch{if(!child)running=false;json(res,409,{error:'Teaching comparison unavailable or stale; refresh the current recording decision'});return true;}
 };
}
