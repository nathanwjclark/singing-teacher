/** Real simulator -> committed canonical PCM forecast -> later synthesis -> independent score.
 * Fixed-source synthetic integration only; no anatomy recovery or human evidence claim. */
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPredictionCommit,verifyPredictionCommit} from '../src/contracts/index.ts';
import {evaluatePrediction} from '../src/evaluation/index.ts';
import type {Forecast,AudioMeasurement,ObservationBundle} from '../src/contracts/index.ts';
const root=process.cwd(),output=resolve(process.argv[2]??'science/artifacts/native-kit-prospective');await mkdir(output,{recursive:false});
const python=resolve(root,'science/.venv/bin/python');
const run=(args:string[])=>execFileSync(python,args,{cwd:root,env:{...process.env,PYTHONPATH:`${root}:${root}/science/src`},stdio:'pipe'});
const json=async(name:string)=>JSON.parse(await readFile(resolve(output,name),'utf8'));
const write=async(name:string,value:unknown)=>writeFile(resolve(output,name),JSON.stringify(value,null,2),{flag:'wx'});
run(['-m','singing_physics.cli','capabilities','--output',resolve(output,'capabilities.json')]);
function produce(name:string,duration:string){
  run(['-m','singing_physics.cli','forward','--output',resolve(output,name),'--pose','a','--f0','160','--duration',duration]);
  execFileSync(process.execPath,['--experimental-strip-types','scripts/import-science-forward.ts',resolve(output,name),resolve(output,'capabilities.json'),resolve(output,`${name}-kit`)],{cwd:root,stdio:'pipe'});
}
produce('prediction-source','0.4');
const predicted:AudioMeasurement=(await json('prediction-source-kit/measurements.json'))[0];
const evidence:ObservationBundle=await json('prediction-source-kit/observation.json');
const candidate=await json('prediction-source-kit/candidate.json');
await write('candidate.json',{...candidate,geometry:{...candidate.geometry,uri:'prediction-source-kit/geometry.gltf'}});
const forecast:Forecast={schemaVersion:'1.0.0',kind:'forecast',id:'native-fixed-source-forecast',createdAt:new Date().toISOString(),provenance:evidence.provenance,modelId:candidate.id,modelVersion:candidate.modelVersion,evidenceIds:[evidence.id,...evidence.artifacts.map(a=>a.id)],experimentId:'native-kit-controlled-replay',intervention:'Fixed native pose a, F0 160 Hz; first canonical window of a fresh 0.5-second synthesis',availability:'available',missingReason:null,outcomes:predicted.measurements.filter(m=>['pitchHz','centroidHz','flatness','dbfs'].includes(m.name)),scoringRule:'absolute-error-v1',evaluationMode:'synthetic-held-out',budget:{unit:'solver-calls',limit:1}};
const commit=await createPredictionCommit(forecast,{id:'native-pcm-commit',committedAt:new Date().toISOString(),provenance:evidence.provenance});await write('commit.json',commit);
// Explicit generation receipt, after durable commit. Different planned duration gives a
// distinct artifact; matching initial PCM is expected for this deterministic source.
await new Promise(r=>setTimeout(r,2));const captureStartedAt=new Date().toISOString();await write('capture-receipt.json',{captureStartedAt,kind:'synthetic-generation-start',predictionId:commit.id});
produce('later-observation','0.5');
const observation:ObservationBundle=await json('later-observation-kit/observation.json');observation.predictionId=commit.id;observation.artifacts=observation.artifacts.map(a=>({...a,uri:`later-observation-kit/${a.uri}`}));
const audio:AudioMeasurement=(await json('later-observation-kit/measurements.json'))[0];
const evaluation=await evaluatePrediction({commit,observation,audio,captureStartedAt,heldOut:{observationIds:[observation.id],fitArtifactHashes:evidence.artifacts.map(a=>a.sha256)},solverCallsUsed:1,articulationParameterCount:0});
await write('observation.json',observation);await write('audio.json',audio);await write('evaluation.json',evaluation);
if(evaluation.outcome!=='scored')throw Error(JSON.stringify(evaluation.exclusions));
if(!await verifyPredictionCommit(await json('commit.json')))throw Error('Committed forecast changed');
await write('summary.json',{kind:'native-pcm-prospective-integration',result:evaluation.outcome,errors:evaluation.errors,claim:'Controlled deterministic synthetic chronology/extractor/evaluator integration. Not anatomy recovery, human G4, or comparative improvement.',baseline:'Not supplied; no improvement claim',records:['candidate.json','commit.json','observation.json','audio.json','evaluation.json']});
console.log(JSON.stringify({output,outcome:evaluation.outcome,errors:evaluation.errors},null,2));
