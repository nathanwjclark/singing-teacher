/** Read-only A job / genuine native PCM adapters into Lead B's public KIT schema. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {canonicalJson, validateRecord} from '../../src/contracts/index.ts';
import {AUDIO_EXTRACTOR_VERSION, audioFrameSize} from '../../src/lib/audio.ts';
import type {AudioMeasurement, CandidateAnatomy, Forecast, JobRecord, ObservationBundle} from '../../src/contracts/index.ts';

export const hash = (bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const readJson = async(path:string)=>JSON.parse(await readFile(path,'utf8'));
function checked<T>(value:T):T {const result=validateRecord(value);if(!result.valid)throw Error(result.errors.join('; '));return value;}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown,label:string):string=>{if(typeof x!=='string'||!x.trim())throw Error(`Missing ${label}`);return x;};
export interface LocalJob {
  row:{id:string;key:string;request:string;request_hash:string;status:string;error:string|null;manifest_hash:string|null;created:number;updated:number};
  currentModelId:string|null;
  request:{operation:string;model_id?:string;session_id?:string;parameters:Record<string,unknown>};
  result:Record<string,unknown>|null;
  manifest:Record<string,unknown>|null;
  outputRoot:string;
}
/** SQLite is opened read-only: inspecting jobs cannot restart/cancel a scheduler. */
export async function readLocalJob(python:string,jobRoot:string,jobId:string):Promise<LocalJob>{
  text(jobId,'job ID');
  const code=`import json,sqlite3,sys\nfrom pathlib import Path\ndb=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)\ndb.row_factory=sqlite3.Row\nrow=db.execute('SELECT * FROM jobs WHERE id=?',(sys.argv[2],)).fetchone()\nif row is None: raise ValueError('Unknown job')\nrequest=json.loads(row['request'])\nmodel=db.execute('SELECT model_id FROM models WHERE session_id=?',(request.get('session_id'),)).fetchone()\nprint(json.dumps({'row':dict(row),'currentModelId':model['model_id'] if model else None}))`;
  const raw=JSON.parse(execFileSync(python,['-c',code,resolve(jobRoot,'jobs.sqlite3'),jobId],{encoding:'utf8'}));
  if(hash(raw.row.request)!==raw.row.request_hash)throw Error('Local request integrity failure');
  const request=JSON.parse(raw.row.request);
  const outputRoot=resolve(jobRoot,'artifacts',jobId);
  let manifest:Record<string,unknown>|null=null,result:Record<string,unknown>|null=null;
  if(raw.row.status==='succeeded'){
    const bytes=await readFile(resolve(outputRoot,'manifest.json'));
    if(hash(bytes)!==raw.row.manifest_hash)throw Error('Local result manifest integrity failure');
    manifest=JSON.parse(bytes.toString());
    if(!manifest||manifest.job_id!==jobId||manifest.request_sha256!==raw.row.request_hash||manifest.model_id!==(request.model_id??null))throw Error('Local manifest identity mismatch');
    if(!object(manifest.files)||typeof manifest.files['result.json']!=='string')throw Error('Local result hash is missing');
    const actualRoot=await realpath(outputRoot);
    for(const [name,expected]of Object.entries(manifest.files)){
      const path=await realpath(resolve(outputRoot,name));
      if(!path.startsWith(actualRoot+sep)||hash(await readFile(path))!==expected)throw Error('Local output artifact integrity failure');
    }
    result=await readJson(resolve(outputRoot,'result.json'));
  }
  return {...raw,request,result,manifest,outputRoot};
}

export function jobRecord(job:LocalJob):JobRecord{
  const states:Record<string,JobRecord['state']>={queued:'queued',running:'running',succeeded:'completed',failed:'failed',cancelled:'cancelled'};
  let state=states[job.row.status];if(!state)throw Error('Unsupported local job state');
  if(job.request.session_id&&job.request.model_id!==job.currentModelId)state='blocked';
  const observations=object(job.request.parameters.observations)?job.request.parameters.observations.observations:null;
  const inputIds=Array.isArray(observations)?observations.filter(row=>object(row)&&row.split==='calibration'&&typeof row.id==='string').map(row=>(row as {id:string}).id):[];
  return checked({schemaVersion:'1.0.0',kind:'job',id:job.row.id,createdAt:new Date(job.row.created*1000).toISOString(),
    provenance:{kind:'engine-generated',producer:'singing-physics/local-job-kit',producerVersion:'0.1.0',sourceIds:[job.row.id],sourceHashes:[job.row.request_hash,...(job.row.manifest_hash?[job.row.manifest_hash]:[])]},
    operation:job.request.operation,state,idempotencyKey:job.row.key,modelId:job.request.model_id??null,
    inputIds:object(job.result)&&Array.isArray(job.result.calibration_ids)?job.result.calibration_ids as string[]:inputIds,
    outputIds:state==='completed'?[`${job.row.id}:result`]:[],missingReason:state==='blocked'||state==='failed'?'invalid':null});
}

export interface NativeHandoff {candidate:CandidateAnatomy;observation:ObservationBundle;measurements:AudioMeasurement[];manifest:Record<string,unknown>;directory:string;}
/** Reuse B's importer; it validates native bytes and owns OBJ/WAV parsing/extraction. */
export async function importNativeForward(root:string,source:string,capabilities:string,output:string):Promise<NativeHandoff>{
  execFileSync(process.execPath,['--experimental-strip-types',resolve(root,'scripts/import-science-forward.ts'),resolve(source),resolve(capabilities),resolve(output)],{cwd:root,stdio:'pipe'});
  const candidate=checked(await readJson(resolve(output,'candidate.json'))) as CandidateAnatomy;
  const observation=checked(await readJson(resolve(output,'observation.json'))) as ObservationBundle;
  const measurements=(await readJson(resolve(output,'measurements.json'))).map(checked) as AudioMeasurement[];
  for(const item of measurements){
    const artifact=observation.artifacts.find(a=>a.id===item.artifactId);
    if(!artifact||item.observationId!==observation.id||!item.provenance.sourceHashes.includes(artifact.sha256))throw Error('PCM observation lineage mismatch');
    if(hash(await readFile(resolve(output,artifact.uri)))!==artifact.sha256)throw Error('PCM artifact integrity failure');
  }
  return {candidate,observation,measurements,manifest:await readJson(resolve(output,'native-manifest.json')),directory:resolve(output)};
}

function nativeBinding(native:NativeHandoff):string {
  if(!object(native.manifest.provenance)||typeof native.manifest.provenance.geometry_basis!=='string'||!native.manifest.provenance.geometry_basis)throw Error('Native geometry basis is undeclared');
  return hash(canonicalJson(native.manifest.provenance));
}
function fittedCandidate(job:LocalJob,native:NativeHandoff,expectedModelId:string,fit:{anatomy:Record<string,unknown>;provenance:unknown;evidenceIds:string[];bounds:Record<string,unknown>;solver:string;interpretation:string;uncertainty:string}):CandidateAnatomy {
  if(jobRecord(job).state!=='completed'||job.request.model_id!==expectedModelId)throw Error('Fitted model is unavailable or stale');
  if(canonicalJson(fit.provenance)!==canonicalJson(native.manifest.provenance))throw Error('Fit/forward native provenance mismatch');
  const binding=nativeBinding(native),inferred=new Set(Object.keys(fit.bounds));
  if(!fit.evidenceIds.length||fit.evidenceIds.some(id=>typeof id!=='string'||!id))throw Error('Fitted evidence lineage is missing');
  const known=new Set(native.candidate.parameters.map(p=>p.name));
  if(Object.keys(fit.anatomy).some(name=>!known.has(name))||[...inferred].some(name=>!known.has(name)))throw Error('Unknown fitted anatomy mapping');
  const parameters=native.candidate.parameters.map(parameter=>{
    const value=fit.anatomy[parameter.name];
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value-parameter.value)>1e-7)throw Error('Forward geometry does not match fitted anatomy');
    const bounds=fit.bounds[parameter.name];
    if(inferred.has(parameter.name)&&(!Array.isArray(bounds)||bounds.length!==2||bounds.some(v=>typeof v!=='number'||!Number.isFinite(v))))throw Error('Invalid fitted search bounds');
    return {...parameter,bounds:inferred.has(parameter.name)?bounds as [number,number]:parameter.bounds,status:inferred.has(parameter.name)?'inferred' as const:'fixed' as const,
      interpretation:inferred.has(parameter.name)?fit.interpretation:'Fixed physical geometry outside the varied candidate parameter set'};
  });
  return checked({...native.candidate,id:expectedModelId,modelVersion:`${native.candidate.modelVersion}:${job.row.manifest_hash?.slice(0,12)}`,
    provenance:{kind:'engine-generated',producer:'singing-physics/fitted-anatomy-kit',producerVersion:'0.2.0',
      sourceIds:[job.row.id,...fit.evidenceIds,`native-provenance:${binding}`],sourceHashes:[job.row.request_hash,job.row.manifest_hash!,binding,...native.candidate.provenance.sourceHashes]},
    evidenceIds:[...fit.evidenceIds],parameters,solver:{name:fit.solver,version:'0.1.0',configSha256:job.row.request_hash},
    uncertaintyMethod:fit.uncertainty,mismatch:false});
}

export function candidateFromJointFit(job:LocalJob,native:NativeHandoff,expectedModelId:string):CandidateAnatomy{
  if(jobRecord(job).state!=='completed'||job.request.model_id!==expectedModelId)throw Error('Fitted model is unavailable or stale');
  const fit=job.result;
  if(!fit||fit.kind!=='synthetic_joint_fit'||job.request.operation!=='fit_joint'||!object(fit.joint)||!object(fit.joint.best)||!object(fit.joint.best.anatomy)||!object(fit.anatomy_bounds)||!Array.isArray(fit.calibration_ids))throw Error('Unsupported fitted anatomy result');
  return fittedCandidate(job,native,expectedModelId,{anatomy:fit.joint.best.anatomy,provenance:fit.provenance,
    evidenceIds:fit.calibration_ids as string[],bounds:fit.anatomy_bounds,solver:'VocalTractLab joint anatomy/articulation fit',
    interpretation:'Jointly inferred from synthetic direct-transfer calibration; anatomical identifiability not established',
    uncertainty:'Uncalibrated bounded optimization candidate; fixed nuisance/source assumptions; no human anatomical truth claim'});
}

/** Selected finite PCM hypothesis, not identified anatomy or verified source audio. */
export function candidateFromPcmFit(job:LocalJob,native:NativeHandoff,expectedModelId:string):CandidateAnatomy {
  const fit=job.result;
  if(!fit||job.request.operation!=='fit_pcm'||fit.kind!=='conditional_pcm_candidate_fit'||!object(fit.joint)||!object(fit.joint.best)||!object(fit.joint.best.anatomy)||!Array.isArray(fit.joint.candidates)||!Array.isArray(fit.evidence_ids))throw Error('No selected PCM physical hypothesis');
  const best=fit.joint.best,candidates=fit.joint.candidates;
  if(best.status!=='scored'||!candidates.some(row=>object(row)&&canonicalJson(row)===canonicalJson(best)))throw Error('PCM selection is not a scored retained candidate');
  const bounds:Record<string,[number,number]>={};
  for(const parameter of native.candidate.parameters){
    const values=candidates.map(row=>{
      if(!object(row)||!object(row.anatomy)||typeof row.anatomy[parameter.name]!=='number'||!Number.isFinite(row.anatomy[parameter.name]))throw Error('Incomplete PCM candidate geometry');
      return row.anatomy[parameter.name] as number;
    });
    if(!values.length)throw Error('Empty PCM candidate grid');
    const low=Math.min(...values),high=Math.max(...values);
    if(low!==high)bounds[parameter.name]=[low,high];
  }
  return fittedCandidate(job,native,expectedModelId,{anatomy:best.anatomy as Record<string,unknown>,provenance:fit.native_provenance,
    evidenceIds:fit.evidence_ids as string[],bounds,solver:'VocalTractLab finite PCM hypothesis selection',
    interpretation:'Selected among varied physical hypotheses using coarse PCM descriptors; not identified physiology',
    uncertainty:`Uncalibrated finite-grid conditional selection; explicit native source/JA/F0/scalar gain assumptions; source artifact bytes verified by fitter: ${fit.source_artifact_bytes_verified===true?'yes':'no'}; no human validation`});
}

const PCM_UNITS:Record<string,string>={pitchHz:'Hz',centroidHz:'Hz',flatness:'ratio',dbfs:'dBFS'};
export function forecastFromPcm(candidate:CandidateAnatomy,native:NativeHandoff,options:{id:string;experimentId:string;intervention:string;createdAt:string;solverCalls:number}):Forecast{
  checked(candidate);
  const binding=nativeBinding(native);
  const declared=candidate.provenance.sourceIds.filter(id=>id.startsWith('native-provenance:'));
  if(declared.length!==1||declared[0]!==`native-provenance:${binding}`||!candidate.provenance.sourceHashes.includes(binding))throw Error('Candidate/native provenance or geometry basis mismatch');
  if(candidate.availability!=='available')throw Error('Candidate is unavailable');
  if(!Number.isInteger(options.solverCalls)||options.solverCalls<1)throw Error('Declare actual prospective synthesis calls');
  const audio=native.measurements[0];if(!audio)throw Error('No canonical PCM window');
  checked(audio);
  if(new Set(audio.measurements.map(m=>m.name)).size!==audio.measurements.length)throw Error('Duplicate PCM feature names');
  if(audio.provenance.kind!=='derived-measurement'||native.observation.provenance.kind!=='engine-generated'||audio.observationId!==native.observation.id||!audio.provenance.sourceIds.includes(audio.artifactId))throw Error('Expected engine-generated PCM lineage');
  const stream=native.observation.streams.find(s=>s.modality==='audio');
  const artifact=native.observation.artifacts.find(a=>a.id===audio.artifactId);
  const rate=native.manifest.sample_rate_hz;
  if(typeof rate!=='number'||rate<=0||!stream||stream.settings.sampleRate!==rate||!artifact||
    !audio.provenance.sourceHashes.includes(artifact.sha256)||!stream.samples.some(s=>s.artifactId===artifact.id)||
    canonicalJson(audio.timebase)!==canonicalJson(stream.timebase)||audio.method!==`pcm-blackman-power-yin/${AUDIO_EXTRACTOR_VERSION}`||
    audio.window.startMs!==0||Math.abs(audio.window.endMs-audioFrameSize(rate)/rate*1000)>1e-9)throw Error('Canonical PCM window, rate or artifact lineage mismatch');
  const geometry=object(native.manifest.anatomy)?native.manifest.anatomy:{};
  if(candidate.parameters.some(p=>geometry[p.name]!==p.value))throw Error('PCM source does not use fitted candidate anatomy');
  const outcomes=Object.entries(PCM_UNITS).map(([name,unit])=>{
    const item=audio.measurements.find(m=>m.name===name&&m.unit===unit);
    if(!item)throw Error(`Canonical PCM feature missing: ${name}:${unit}`);
    return {...item};
  });
  return checked({schemaVersion:'1.0.0',kind:'forecast',id:options.id,createdAt:options.createdAt,
    provenance:{kind:'engine-generated',producer:'singing-physics/pcm-kit-forecast',producerVersion:'0.1.0',
      sourceIds:[candidate.id,...candidate.evidenceIds,native.observation.id,audio.id],
      sourceHashes:[...candidate.provenance.sourceHashes,...audio.provenance.sourceHashes]},
    modelId:candidate.id,modelVersion:candidate.modelVersion,evidenceIds:[...candidate.evidenceIds,native.observation.id],
    experimentId:options.experimentId,intervention:options.intervention,availability:'available',missingReason:null,outcomes,
    scoringRule:'absolute-error-v1',evaluationMode:'synthetic-held-out',budget:{unit:'solver-calls',limit:options.solverCalls}});
}
