/** Actual joint-fit -> native PCM -> KIT commit -> later native target -> B score. */
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPredictionCommit, verifyPredictionCommit} from '../../src/contracts/index.ts';
import {evaluatePrediction} from '../../src/evaluation/index.ts';
import {candidateFromJointFit, forecastFromPcm, hash, importNativeForward, jobRecord, readJson, readLocalJob} from './kit_science.ts';

export async function replayKitScience(root:string,output:string,python:string){
  root=resolve(root);output=resolve(output);await mkdir(dirname(output),{recursive:true});await mkdir(output,{recursive:false});
  const write=async(name:string,value:unknown)=>writeFile(resolve(output,name),JSON.stringify(value,null,2),{flag:'wx'});
  const run=(args:string[])=>execFileSync(python,args,{cwd:root,env:{...process.env,PYTHONPATH:`${root}:${root}/science/src`},stdio:'pipe'});
  await write('protocol.json',{kind:'synthetic-fitted-anatomy-pcm-protocol',evaluation:'first canonical PCM window',
    source:'VocalTractLab geometric glottis, F0=160 Hz, pose a, template articulation',forecastDurationS:.4,targetDurationS:.5,
    targetSource:'Separate calibration-generator anatomy; target waveform generated after commit',
    forecastFeatures:['pitchHz:Hz','centroidHz:Hz','flatness:ratio','dbfs:dBFS'],
    budgetMeaning:'One prospective native forward synthesis; fitting residual and spectrum counts reported separately',
    humanEvidence:false});
  run(['science/scripts/replay_science.py',resolve(output,'a-source'),'--budget','20']);
  const sourceSummary=await readJson(resolve(output,'a-source/summary.json'));
  const job=await readLocalJob(python,resolve(output,'a-source/jobs'),sourceSummary.fit_job_id);
  await write('local-fit-job.json',job);
  await write('job.json',jobRecord(job));
  const result=job.result as {joint:{best:{anatomy:Record<string,number>}},residual_calls:number,spectrum_calls:number};
  await write('fitted-anatomy.json',result.joint.best.anatomy);
  const capabilities=resolve(output,'a-source/capabilities.json');
  run(['-m','singing_physics.cli','forward','--output',resolve(output,'forecast-native'),'--anatomy',resolve(output,'fitted-anatomy.json'),'--pose','a','--f0','160','--duration','.4']);
  const predicted=await importNativeForward(root,resolve(output,'forecast-native'),capabilities,resolve(output,'forecast-kit'));
  const candidate=candidateFromJointFit(job,predicted,sourceSummary.model_id);
  await write('candidate.json',{...candidate,geometry:candidate.geometry?{...candidate.geometry,uri:`forecast-kit/${candidate.geometry.uri}`}:null});
  const forecast=forecastFromPcm(candidate,predicted,{id:'fitted-native-pcm-forecast',experimentId:'kit-scientific-replay',
    intervention:'Native pose a, F0 160 Hz, template articulation; first canonical window of later 0.5-second synthesis',
    createdAt:new Date().toISOString(),solverCalls:1});
  const commit=await createPredictionCommit(forecast,{id:'fitted-native-pcm-commit',committedAt:new Date().toISOString(),
    provenance:{kind:'derived-measurement',producer:'singing-physics/offline-kit-coordinator',producerVersion:'0.1.0',
      sourceIds:[forecast.id,job.row.id],sourceHashes:forecast.provenance.sourceHashes}});
  await write('commit.json',commit);
  while(Date.now()<=Date.parse(commit.committedAt))await new Promise(resolve=>setTimeout(resolve,1));
  const captureStartedAt=new Date().toISOString();
  await write('capture-receipt.json',{kind:'synthetic-generation-start',captureStartedAt,predictionId:commit.id});
  // Target waveform is newly synthesized only after the public KIT commit is persisted.
  const truth=await readJson(resolve(output,'a-source/generation-truth.json'));
  await write('target-anatomy.json',truth.anatomy);
  run(['-m','singing_physics.cli','forward','--output',resolve(output,'target-native'),'--anatomy',resolve(output,'target-anatomy.json'),'--pose','a','--f0','160','--duration','.5']);
  const target=await importNativeForward(root,resolve(output,'target-native'),capabilities,resolve(output,'target-kit'));
  const observation={...target.observation,predictionId:commit.id,artifacts:target.observation.artifacts.map(a=>({...a,uri:`target-kit/${a.uri}`}))};
  const audio=target.measurements[0];
  const input={commit,observation,audio,captureStartedAt,heldOut:{observationIds:[observation.id],
    fitArtifactHashes:predicted.observation.artifacts.map(a=>a.sha256)},solverCallsUsed:1,articulationParameterCount:0};
  const evaluation=await evaluatePrediction(input);
  await write('observation.json',observation);await write('audio.json',audio);await write('evaluation.json',evaluation);
  // Retain independent evaluator rejection paths as records, never reinterpret as scores.
  const failed=await evaluatePrediction({...input,observation:{...observation,predictionId:'wrong-prediction'}});
  const missing=await evaluatePrediction({...input,audio:{...audio,quality:{...audio.quality,missingReason:'not-captured'}}});
  await write('lineage-failure-evaluation.json',failed);await write('missing-audio-evaluation.json',missing);
  if(evaluation.outcome!=='scored'||failed.outcome!=='failed'||missing.outcome!=='excluded')throw Error('Unexpected independent evaluation outcomes');
  if(!await verifyPredictionCommit(await readJson(resolve(output,'commit.json'))))throw Error('Prediction commit changed');
  const summary={kind:'joint-fit-canonical-pcm-kit-replay',outcome:evaluation.outcome,errors:evaluation.errors,
    localFitJobId:job.row.id,modelId:candidate.id,modelVersion:candidate.modelVersion,
    inferredParameters:candidate.parameters.filter(p=>p.status==='inferred').map(p=>p.name),
    fitResidualCalls:result.residual_calls,fitSpectrumCalls:result.spectrum_calls,prospectiveSynthesisCalls:1,
    claim:'Actual synthetic joint-fit and canonical PCM forecast bridge; not human validation or comparative improvement',
    offlineLedger:'Public createPredictionCommit/verify primitives; live human-only ledger is intentionally not used'};
  await write('summary.json',summary);
  await write('bridge-manifest.json',{commitSha256:commit.sha256,
    sourceRequestSha256:job.row.request_hash,sourceManifestSha256:job.row.manifest_hash,
    pcmArtifactSha256:target.observation.artifacts[0].sha256,
    candidateFileSha256:hash(await readFile(resolve(output,'candidate.json')))});
  return summary;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.cwd(),output=process.argv[2];
  if(!output)throw Error('Usage: node --experimental-strip-types science/scripts/replay_kit_science.ts NEW_OUTPUT_DIR');
  console.log(JSON.stringify(await replayKitScience(root,output,process.env.SINGING_PYTHON??resolve(root,'science/.venv/bin/python')),null,2));
}
