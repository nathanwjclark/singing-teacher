import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const files=new Set(['space-diff.json','tract0.obj','tract0.mtl','tract.svg','geometry.json','manifest.json','fit.json','forecast.json','summary.json']);
const types={obj:'text/plain',mtl:'text/plain',svg:'image/svg+xml',json:'application/json'};
async function restDecision(runDirectory,sessionId){
  let rest;
  try{rest=JSON.parse(await readFile(resolve(runDirectory,'astra-rest.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
  if(rest.sessionId!==sessionId||!rest.decisionId||!Number.isFinite(Date.parse(rest.createdAt)))throw new Error('Rest decision lineage is invalid');
  return rest;
}
async function verifyRecording(result,fetchImpl){
  if(result.restDecision)return result;
  const blocked=message=>({...result,recordingAllowed:false,recordingMessage:message,forecastHistorical:true});
  try{
    if(!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)throw new Error('Worker unavailable');
    const base=new URL(process.env.SCIENCE_URL);
    if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Worker unavailable');
    const response=await fetchImpl(new URL(`/sessions/${encodeURIComponent(result.sessionId)}/state`,base),{headers:{Authorization:`Bearer ${process.env.SCIENCE_TOKEN}`},signal:AbortSignal.timeout(2500)});
    if(!response.ok)throw new Error('Worker unavailable');
    const {state}=await response.json(),design=state?.designs?.[result.designId];
    if(!state?.snapshot||state.snapshot.model_id!==result.modelId||design?.data?.model_id!==state.snapshot.model_id)return blocked('This forecast belongs to an earlier model. Ask Astra for a new recording decision.');
    if(design.status!=='committed'||design.data.selected_experiment_id!==result.forecast?.selected_experiment_id||design.data.target_observation_id!==result.forecast?.target_observation_id)return blocked('This recording experiment is no longer committed. Ask Astra for a new recording decision.');
    if(state.pending)return blocked('A scientific job is updating this session. Wait for its result before recording.');
    return {...result,recordingAllowed:true,forecastHistorical:false};
  }catch{return blocked('The scientific worker is unavailable. Existing geometry remains visible; reconnect the worker before recording or scoring.');}
}
export async function activeResult(runDirectory,fetchImpl=fetch){
  const original=JSON.parse(await readFile(resolve(runDirectory,'summary.json'),'utf8'));
  const rest=await restDecision(runDirectory,original.sessionId);
  const resting=rest?{restDecision:rest,recordingAllowed:false,recordingMessage:'Astra selected rest. Request a new recording decision before preparing or scoring another capture.'}:{};
  let active;
  try{active=JSON.parse(await readFile(resolve(runDirectory,'astra-current.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return verifyRecording({...original,...resting},fetchImpl);throw error}
  if(active.sessionId!==original.sessionId||!active.modelId||!active.designId||active.forecast?.design_id!==active.designId||!active.forecast?.target_observation_id||!active.forecast?.selected_experiment_id)throw new Error('Active experiment lineage is invalid');
  return verifyRecording({...original,geometryModelId:original.modelId,modelId:active.modelId,designId:active.designId,sessionVersion:active.sessionVersion,forecast:active.forecast,decisionId:active.decisionId,...resting},fetchImpl);
}
export function scienceRoutes({repo,dataRoot,json,fetchImpl=fetch}) {
  let running=null,starting=false;
  const index=resolve(dataRoot,'science-current.json');
  const saveAt=async(path,value)=>{const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,path)};
  const save=value=>saveAt(index,value);
  async function status(){try{return JSON.parse(await readFile(index,'utf8'))}catch{return {status:'not-run'}}}
  const terminate=()=>{if(running){try{process.kill(-running.pid,'SIGTERM')}catch{/* already exited */}}};
  process.once('exit',terminate);
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{terminate();process.exit(0)});
  function launch(args,output,record,publish,logPath=resolve(output,'process.log')){
    const python=process.env.SINGING_PYTHON||resolve(repo,'science/.venv/bin/python');
    const child=spawn(python,args,{cwd:repo,env:{...process.env,PYTHONPATH:repo+':'+resolve(repo,'science/src')},detached:true,stdio:['ignore','pipe','pipe']});running=child;
    let logs='',launchError=false;for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs=(logs+data.toString()).slice(-100_000)});
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{/* exited */}},570_000);timer.unref();
    child.once('error',()=>{launchError=true});
    child.once('close',async code=>{
      clearTimeout(timer);
      try{
        await mkdir(dirname(logPath),{recursive:true,mode:0o700});
        await writeFile(logPath,logs,{mode:0o600});
        await publish({...record,status:code===0?'succeeded':'failed',finishedAt:new Date().toISOString(),...(code===0?{}:{error:launchError?'Scientific Python could not start':'Scientific job failed; private output and process.log retained'})});
      }catch{console.error('Could not persist scientific completion; inspect the private run directory')}
      finally{if(running===child)running=null}
    });
  }
  return async(req,res,url)=>{
    if(!['/api/tongue-profile','/api/science/status','/api/science/asset','/api/science/run','/api/science/outcome'].includes(url.pathname)&&!url.pathname.startsWith('/api/tongue-neural/'))return false;
    if(!['127.0.0.1','::1'].includes(req.socket.remoteAddress?.replace(/^::ffff:/,''))){json(res,403,{error:'Private model data is available only on this Mac'});return true}
    if(url.pathname.startsWith('/api/tongue-neural/')&&req.method==='GET'){
      const name={'/api/tongue-neural/model':'tongue.onnx','/api/tongue-neural/manifest':'manifest.json'}[url.pathname];
      if(!name){json(res,404,{error:'Unknown tongue model artifact'});return true;}
      try{const data=await readFile(resolve(dataRoot,'tongue-neural/current',name));res.writeHead(200,{'Content-Type':name.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)}catch{json(res,404,{error:'Personal tongue model unavailable'})}return true;
    }
    if(url.pathname==='/api/tongue-profile'&&req.method==='GET'){
      try{const profile=JSON.parse(await readFile(resolve(dataRoot,'tongue-review/live-tip-profile.json'),'utf8'));json(res,200,profile)}catch{json(res,404,{error:'No private tongue profile installed'})}return true;
    }
    if(url.pathname==='/api/science/status'&&req.method==='GET'){
      const state=await status();if(state.status==='running'&&!running)state.status='interrupted';
      if(state.status==='succeeded'&&state.runId){try{state.result=await activeResult(resolve(dataRoot,'science-runs',state.runId),fetchImpl)}catch{state.status='failed';state.error='Published result unavailable'}}
      json(res,200,state);return true;
    }
    if(url.pathname==='/api/science/asset'&&req.method==='GET'){
      const run=url.searchParams.get('run'),name=url.searchParams.get('name');
      if(!/^[A-Za-z0-9-]{1,100}$/.test(run||'')||!files.has(name)){json(res,400,{error:'Unknown model artifact'});return true}
      try{const data=await readFile(resolve(dataRoot,'science-runs',run,name));res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(data)}catch{json(res,404,{error:'Artifact unavailable'})}return true;
    }
    if(url.pathname==='/api/science/outcome'&&['GET','POST'].includes(req.method)){
      const current=await status();
      if(current.status!=='succeeded'||!/^run-[A-Za-z0-9-]+$/.test(current.runId||'')){json(res,409,{error:'A completed model run is required'});return true}
      const runDirectory=resolve(dataRoot,'science-runs',current.runId),outcomeIndex=resolve(runDirectory,'outcome-current.json');
      let active;try{active=await activeResult(runDirectory,fetchImpl)}catch{json(res,409,{error:'Current experiment unavailable'});return true}
      let previous;try{previous=JSON.parse(await readFile(outcomeIndex,'utf8'))}catch{previous={status:'not-run'}}
      if(req.method==='GET'){
        if(previous.designId&&previous.designId!==active.designId){json(res,200,{status:'not-run',designId:active.designId});return true}
        if(previous.status==='running'&&!running)previous.status='interrupted';
        if(previous.status==='succeeded'){
          try{previous.result=JSON.parse(await readFile(resolve(runDirectory,'outcomes',previous.outcomeId,'summary.json'),'utf8'))}
          catch{previous.status='failed';previous.error='Outcome result unavailable'}
        }
        json(res,200,previous);return true;
      }
      if(running||starting){json(res,409,{error:'A scientific job is already running'});return true}
      if(url.search||Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding']){json(res,400,{error:'This action takes no parameters'});return true}
      if(!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN){json(res,409,{error:'Start the shared worker with npm run science:local'});return true}
      starting=true;try{
        let config;try{config=JSON.parse(await readFile(resolve(dataRoot,'science-outcome-input.json'),'utf8'))}catch{json(res,409,{error:'No later voice capture configured'});return true}
        if(config.design_id!==active.designId||config.experiment_id!==active.forecast?.selected_experiment_id||config.observation_id!==active.forecast?.target_observation_id){json(res,409,{error:active.recordingAllowed===false?active.recordingMessage:'Prepared capture belongs to a different experiment. Prepare a new capture for the current decision.'});return true}
        const {sourceDirectory,...parameters}=config;
        if(typeof sourceDirectory!=='string'){json(res,400,{error:'A private sourceDirectory is required'});return true}
        const source=resolve(dataRoot,sourceDirectory);
        if(!source.startsWith(dataRoot+'/')){json(res,400,{error:'Voice source must remain in the private data directory'});return true}
        const manifest=await readFile(resolve(source,'manifest.json'));
        const inputHash=createHash('sha256').update(JSON.stringify(config)).update(manifest).digest('hex');
        const reuse=previous.inputHash===inputHash&&previous.runId===current.runId&&previous.designId===active.designId&&/^outcome-[a-f0-9-]+$/.test(previous.outcomeId||'');
        if(!reuse&&active.recordingAllowed===false){json(res,409,{error:active.recordingMessage});return true}
        if(reuse){
          let retained;try{retained=JSON.parse(await readFile(resolve(runDirectory,'outcomes',previous.outcomeId+'-input.json'),'utf8'))}catch{json(res,409,{error:'Retained outcome configuration unavailable; existing results were preserved'});return true}
          if(JSON.stringify(retained)!==JSON.stringify(parameters)){json(res,409,{error:'Retained outcome configuration changed; refusing to resume'});return true}
        }
        if(reuse&&previous.status==='succeeded'){json(res,200,previous);return true}
        const outcomeId=reuse?previous.outcomeId:'outcome-'+randomUUID();
        const output=resolve(runDirectory,'outcomes',outcomeId);
        await mkdir(resolve(runDirectory,'outcomes'),{recursive:true,mode:0o700});
        const configPath=resolve(runDirectory,'outcomes',outcomeId+'-input.json');
        if(!reuse)await writeFile(configPath,JSON.stringify(parameters),{mode:0o600,flag:'wx'});
        const record={status:'running',runId:current.runId,designId:active.designId,modelId:active.modelId,outcomeId,inputHash,startedAt:reuse?previous.startedAt:new Date().toISOString()};
        await saveAt(outcomeIndex,record);
        launch([resolve(repo,'science/scripts/run_native_outcome.py'),'--run',runDirectory,'--source',source,'--output',output,'--config',configPath],output,record,value=>saveAt(outcomeIndex,value),resolve(runDirectory,'outcomes',outcomeId+'-process.log'));
        json(res,202,record);return true;
      }finally{starting=false}
    }
    if(url.pathname==='/api/science/run'&&req.method==='POST'){
      if(running||starting){json(res,409,{error:'A scientific job is already running'});return true}
      if(url.search||Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding']){json(res,400,{error:'This action takes no parameters'});return true}
      starting=true;try{
      let config;try{config=JSON.parse(await readFile(resolve(dataRoot,'science-input.json'),'utf8'))}catch{json(res,409,{error:'No verified local voice capture configured'});return true}
      if(config.evidenceKind!==undefined&&!['human-observation','development-fixture'].includes(config.evidenceKind)){json(res,400,{error:'Unknown configured voice evidence kind'});return true}
      const source=resolve(dataRoot,config.sourceDirectory||'');
      if(!source.startsWith(dataRoot+'/')){json(res,400,{error:'Voice source must remain in the private data directory'});return true}
      const runId='run-'+Date.now()+'-'+randomUUID().slice(0,8),output=resolve(dataRoot,'science-runs',runId);
      await mkdir(resolve(dataRoot,'science-runs'),{recursive:true,mode:0o700});
      const record={status:'running',runId,startedAt:new Date().toISOString()};await save(record);
      const args=[resolve(repo,'science/scripts/live_capture_jobs.py'),'--source',source,'--output',output];
      if(config.evidenceKind==='development-fixture')args.push('--development-fixture');
      launch(args,output,record,save);
      json(res,202,record);return true;
      }finally{starting=false}
    }
    json(res,405,{error:'Method not allowed'});return true;
  };
}
