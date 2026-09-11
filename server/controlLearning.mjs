import {readFile,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

// Cue-execution learning: exact delivered cue wording bound to finite JA/F0 simulator banks.
// Weights are standardized-descriptor affinities under engineering scales, never execution
// probabilities, measured movement or anatomy evidence. Nothing here updates the baseline model.
const MAX_CONTEXT_BYTES=24*1024,MIN_ATTEMPTS=3;
const INTERPRETATION='Weights are descriptor affinities of finite JA/F0 simulator alternatives under engineering scales, conditional on each retained anatomy. They are not execution probabilities, measured movement or anatomy evidence. Microphone residual calibration is reported separately and never changes weights or predictions.';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
async function save(path,value){const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);}
async function context(dataRoot){const c=await read(resolve(dataRoot,'science-current.json'));if(c.status!=='succeeded'||!/^run-[A-Za-z0-9_-]+$/.test(c.runId||''))throw Error('A completed voice fit is required');const dir=resolve(dataRoot,'science-runs',c.runId),summary=await read(resolve(dir,'summary.json'));if(!/^[A-Za-z0-9_-]{1,160}$/.test(summary.sessionId||''))throw Error('Voice fit has no scientific session');return {dir,runId:c.runId,sessionId:summary.sessionId};}
const counted=receipt=>receipt.operation==='score_control_pcm'&&Object.keys(receipt.result?.artifact?.control_support||{}).length>0;
const round=value=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*1e4)/1e4:null;

function forecastSummary(forecast,baseline,receipts){
 const artifact=forecast.artifact.artifact,support=artifact.execution_support,residual=artifact.empirical_residual_calibration,key=artifact.compatibility_sha256;
 const anatomies=[...new Map(artifact.alternatives.map(row=>[row.anatomy_sha256,row.hypothesis_id])).entries()],predictions=Object.fromEntries(artifact.conditional_predictions.map(row=>[row.anatomy_sha256,row]));
 return {forecastId:forecast.forecastId,status:forecast.status,current:forecast.status==='committed'&&forecast.baseline_model_id===baseline,
  committedAt:forecast.committed_at,forecastSha256:forecast.artifact.sha256,predictionStatus:artifact.status,supportStatus:support.status,
  anatomyControlTradeoff:support.anatomy_control_tradeoff,excludedAttempts:support.excluded.length,
  anatomies:anatomies.map(([sha,hypothesisId])=>{const row=support.by_anatomy[sha],calibration=residual.by_anatomy[sha];return {anatomySha256:sha,hypothesisId,
   // Attempts in this ledger now matching this forecast's compatibility key, including any scored after it was frozen.
   matchedAttempts:receipts.filter(r=>counted(r)&&r.result.artifact.compatibility_sha256===key&&sha in r.result.artifact.control_support).length,
   forecastMatchedAttempts:row.matched_attempts,supportStatus:row.status,leadingControlIds:row.leading_control_ids,indistinguishableControlIds:predictions[sha]?.indistinguishable_control_ids||[],
   weights:Object.fromEntries(Object.entries(row.weights).map(([id,w])=>[id,round(w)])),
   residualCalibration:{status:calibration.status,count:calibration.count,features:Object.fromEntries(Object.entries(calibration.features).map(([name,f])=>[name,{unit:f.unit,mean:round(f.mean),sd:round(f.sd)}]))}};})};
}

export function controlContextFromState(state){
 const base={minimumMatchedAttempts:MIN_ATTEMPTS,modelUpdated:false,movementMeasured:false,interpretation:INTERPRETATION};
 if(!state?.snapshot)return {...base,status:'unsupported',reason:'Fit a voice model before cue-execution learning',baselineModelId:null,bindings:[],truncated:false};
 const baseline=state.snapshot.model_id,receipts=state.control_receipts||[];
 const forecasts=Object.entries(state.control_forecasts||{}).map(([forecastId,row])=>({forecastId,...row})).sort((a,b)=>a.committed_at.localeCompare(b.committed_at));
 let bindings=Object.entries(state.control_bindings||{}).sort(([,a],[,b])=>a.declared_at.localeCompare(b.declared_at)).map(([bindingId,binding])=>{
  const own=receipts.filter(r=>r.binding_id===bindingId),count=(...statuses)=>own.filter(r=>statuses.includes(r.status)).length,latest=forecasts.filter(f=>f.binding_id===bindingId).at(-1);
  return {bindingId,deliveredCue:binding.cue.wording,cueSha256:binding.cue.wording_sha256,mode:binding.cue.mode,context:binding.context,
   controls:binding.controls.map(c=>({controlId:c.control_id,JA:c.JA,f0Hz:c.f0_hz})),gain:binding.gain,gainRole:'declared acquisition nuisance for the whole bank',declaredAt:binding.declared_at,
   attempts:{scored:count('scored','partial'),noAlternativeFits:count('no-alternative-fits'),unscorable:count('unscorable'),stopped:count('stopped'),failed:own.filter(r=>r.operation==='score_control_pcm'&&['failed','cancelled','submission_failed','rejected'].includes(r.status)).length},
   latestForecast:latest?forecastSummary(latest,baseline,receipts):null};
 });
 const result=truncated=>({...base,status:bindings.length?'available':'no_bindings',baselineModelId:baseline,bindings,truncated});
 // The newest bindings are the ones Astra can repeat; older ones are dropped first to stay bounded.
 while(bindings.length&&Buffer.byteLength(JSON.stringify(result(true)))>MAX_CONTEXT_BYTES)bindings=bindings.slice(1);
 return result(bindings.length<Object.keys(state.control_bindings||{}).length);
}

async function worker(sessionId){
 if(!process.env.SCIENCE_URL||!process.env.SCIENCE_TOKEN)return null;
 const base=new URL(process.env.SCIENCE_URL);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1')return null;
 const response=await fetch(new URL('/sessions/'+sessionId+'/state',base),{headers:{Authorization:'Bearer '+process.env.SCIENCE_TOKEN},signal:AbortSignal.timeout(5000)});
 return response.ok?(await response.json()).state:null;
}

async function delivery(dataRoot,c,state){
 let resting=false;try{await lstat(resolve(c.dir,'astra-rest.json'));resting=true;}catch(error){if(error.code!=='ENOENT')resting=true;}
 if(resting)return {current:false,reason:'Astra selected rest; ask for a new recording decision'};
 try{const pointer=await read(resolve(c.dir,'astra-current.json')),design=state?.designs?.[pointer.designId];
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(pointer.decisionId||''))throw Error('invalid');
  const decision=await read(resolve(dataRoot,'astra-decisions',c.sessionId,pointer.decisionId+'.json'));
  const current=pointer.modelId===state?.snapshot?.model_id&&design?.status==='committed'&&decision.status==='succeeded'&&decision.decision?.action==='record';
  return {current,decisionId:pointer.decisionId,cue:decision.decision?.cue??null,cueBindingId:decision.decision?.cueBindingId??null,
   experimentId:decision.decision?.experimentId??null,reason:current?null:'The saved Astra decision is no longer current'};
 }catch{return {current:false,reason:'Ask Astra for a recording decision first'};}
}

export async function readControlStatus({dataRoot}){
 let c;try{c=await context(dataRoot);}catch{return {...controlContextFromState(null),running:false,forecast:null,score:null,stop:null,delivery:{current:false,reason:'Analyze a saved voice recording first'}};}
 let state=null;try{state=await worker(c.sessionId);}catch{state=null;}
 const phases={};for(const name of ['forecast','score','stop']){try{phases[name]=await read(resolve(c.dir,'control-'+name+'.json'));}catch{phases[name]=null;}}
 for(const phase of Object.values(phases)){if(phase?.status==='running')phase.status='interrupted';
  // The sealed artifact lives in the ledger; polling returns only the receipt fields.
  if(phase?.result)phase.result={...phase.result,result:undefined};}
 return {...controlContextFromState(state),runId:c.runId,sessionId:c.sessionId,running:false,workerAvailable:Boolean(state),pendingScientificJob:Boolean(state?.pending),...phases,delivery:await delivery(dataRoot,c,state)};
}

export function createControlLearningRoutes({repo,dataRoot,json}){
 let running=false,activePhase=null,childProcess=null;
 const terminate=()=>{if(childProcess)childProcess.kill('SIGTERM');};process.once('exit',terminate);
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/control/'))return false;
  const host=req.headers.host,address=req.socket.remoteAddress?.replace(/^::ffff:/,'');if(!['127.0.0.1','::1'].includes(address)||!host||!/^((localhost|127\.0\.0\.1)|\[::1\])(:\d+)?$/.test(host)||(req.headers.origin&&!['http://'+host,'https://'+host].includes(req.headers.origin))){json(res,403,{error:'Use cue-execution learning from the local app'});return true;}
  try{
   if(req.method==='GET'&&url.pathname==='/api/control/status'){const busy=running,phase=activePhase,status=await readControlStatus({dataRoot});if(busy&&phase&&status[phase])status[phase].status='running';json(res,200,{...status,running:busy||running});return true;}
   const phase={'/api/control/forecast':'forecast','/api/control/score':'score','/api/control/stop':'stop'}[url.pathname];if(req.method!=='POST'||!phase){json(res,405,{error:'Method not allowed'});return true;}
   if(running){json(res,409,{error:'A cue-execution job is running'});return true;}
   if(url.search||Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding']){json(res,400,{error:'This action uses the delivered cue and saved original audio and takes no parameters'});return true;}
   running=true;const c=await context(dataRoot),path=resolve(c.dir,'control-'+phase+'.json');let previous;try{previous=await read(path);}catch{previous=null;}
   // The ledger keeps at most one committed control forecast.
   const status=await readControlStatus({dataRoot}),committed=status.bindings.flatMap(b=>b.latestForecast?.current?[b.latestForecast.forecastId]:[])[0]||null;
   const refuse=error=>{running=false;json(res,409,{error});return true;};
   let key;
   if(phase==='forecast'){
    if(!status.delivery.current)return refuse(status.delivery.reason);
    key='forecast:'+status.baselineModelId+':'+status.delivery.decisionId;
    // One prediction per Astra decision; once it is scored, stopped or replaced, a new decision is needed.
    if(previous?.key===key&&previous.status==='succeeded'){if(previous.result?.forecastId!==committed)return refuse('The prediction for this Astra decision was already used; ask Astra for a new recording decision');running=false;json(res,200,previous);return true;}
   }else{
    key=phase+':'+(committed||previous?.forecastId);
    if(phase==='score'){let pull;try{pull=await read(resolve(dataRoot,'native-pull-latest.json'));}catch{return refuse('Pull a new capture from the iPhone first');}key+=':'+pull.sha256;}
    if(previous?.key===key&&previous.status==='succeeded'){running=false;json(res,200,previous);return true;}
    // Without a committed forecast only an interrupted run of this same attempt may resume.
    if(!committed&&!(previous?.key===key&&previous.status==='running'))return refuse('Freeze a current cue-execution forecast before recording');
   }
   const attempt=previous?.key===key&&(previous.status!=='failed'||status.pendingScientificJob)?previous.id:randomUUID(),record={id:attempt,key,status:'running',forecastId:phase==='forecast'?null:committed||previous?.forecastId||null,createdAt:previous?.id===attempt?previous.createdAt:new Date().toISOString()};await save(path,record);
   const output=resolve(c.dir,'control-attempts',attempt);await mkdir(output,{recursive:true,mode:0o700});
   const child=spawn(process.env.SINGING_PYTHON||resolve(repo,'science/.venv/bin/python'),[resolve(repo,'science/scripts/app_control.py'),'--data-root',dataRoot,'--phase',phase,'--output',output],{cwd:repo,env:{...process.env,PYTHONPATH:repo+':'+resolve(repo,'science/src')},stdio:['ignore','ignore','pipe']});
   activePhase=phase;childProcess=child;let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});const timer=setTimeout(()=>child.kill('SIGTERM'),150000);let launchError=false;child.on('error',()=>{launchError=true;});
   child.on('close',async code=>{clearTimeout(timer);try{let result;try{result=await read(resolve(output,'result.json'));}catch{result=null;}const reason=code===0?null:launchError?'Cue-execution runner unavailable':(/ValueError: (.+)\n?$/.exec(stderr.trim())?.[1]||'Cue-execution job failed; baseline retained');await save(path,{...record,status:code===0&&result?'succeeded':'failed',result,reason,completedAt:new Date().toISOString()});}catch{console.error('Cue-execution receipt could not be saved');}finally{running=false;activePhase=null;childProcess=null;}});
   json(res,202,record);return true;
  }catch{running=false;json(res,409,{error:'Cue-execution learning unavailable; complete a voice fit and start the scientific worker'});return true;}
 };
}
