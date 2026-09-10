import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {validateRecord,verifyPredictionCommit} from '../../src/contracts/index.ts';
import {candidateFromJointFit,forecastFromPcm,importNativeForward,jobRecord,readJson,readLocalJob} from './kit_science.ts';
import type {LocalJob,NativeHandoff} from './kit_science.ts';
import {replayKitScience} from './replay_kit_science.ts';

const root=process.cwd(),python=process.env.SINGING_PYTHON??resolve(root,'science/.venv/bin/python');
let temporary:string,output:string,job:LocalJob,native:NativeHandoff;
before(async()=>{
  temporary=await mkdtemp(resolve(tmpdir(),'kit-science-'));output=resolve(temporary,'replay');
  await replayKitScience(root,output,python);
  const summary=await readJson(resolve(output,'summary.json'));
  job=await readLocalJob(python,resolve(output,'a-source/jobs'),summary.localFitJobId);
  native={candidate:await readJson(resolve(output,'forecast-kit/candidate.json')),
    observation:await readJson(resolve(output,'forecast-kit/observation.json')),
    measurements:await readJson(resolve(output,'forecast-kit/measurements.json')),
    manifest:await readJson(resolve(output,'forecast-kit/native-manifest.json')),directory:resolve(output,'forecast-kit')};
});
after(async()=>{if(temporary)await rm(temporary,{recursive:true,force:true});});

test('actual fitted KIT candidate distinguishes inferred variables from fixed geometry',async()=>{
  const candidate=await readJson(resolve(output,'candidate.json'));
  assert.equal(validateRecord(candidate).valid,true);
  assert.deepEqual(candidate.parameters.filter((p:{status:string})=>p.status==='inferred').map((p:{name:string})=>p.name).sort(),['hard_palate_length','pharynx_length']);
  assert.equal(candidate.parameters.filter((p:{status:string})=>p.status==='fixed').length,11);
  assert.equal(candidate.solver.configSha256,job.row.request_hash);
  assert.ok(candidate.evidenceIds.includes('calibration-a'));
  assert.equal(jobRecord(job).state,'completed');
});

test('real PCM is committed before later target and independently scored with native units',async()=>{
  const commit=await readJson(resolve(output,'commit.json')),capture=await readJson(resolve(output,'capture-receipt.json'));
  assert.equal(await verifyPredictionCommit(commit),true);
  assert.ok(Date.parse(capture.captureStartedAt)>Date.parse(commit.committedAt));
  const evaluation=await readJson(resolve(output,'evaluation.json'));
  assert.equal(evaluation.outcome,'scored');
  assert.deepEqual(commit.forecast.outcomes.map((m:{name:string,unit:string})=>`${m.name}:${m.unit}`),['pitchHz:Hz','centroidHz:Hz','flatness:ratio','dbfs:dBFS']);
  assert.equal((await readJson(resolve(output,'lineage-failure-evaluation.json'))).outcome,'failed');
  assert.equal((await readJson(resolve(output,'missing-audio-evaluation.json'))).outcome,'excluded');
});

test('stale and failed jobs cannot publish fitted anatomy',()=>{
  const stale={...job,currentModelId:'later-model'};
  assert.equal(jobRecord(stale).state,'blocked');
  assert.throws(()=>candidateFromJointFit(stale,native,job.request.model_id!),/stale/);
  const failed={...job,row:{...job.row,status:'failed',error:'native failure'},result:null,manifest:null};
  assert.equal(jobRecord(failed).state,'failed');
  assert.equal(jobRecord(failed).missingReason,'invalid');
  assert.throws(()=>candidateFromJointFit(failed,native,job.request.model_id!),/unavailable/);
});

test('fitted/forward mismatch, wrong PCM units and changed lineage are rejected',()=>{
  const candidate=candidateFromJointFit(job,native,job.request.model_id!);
  const changed=structuredClone(native);changed.candidate.parameters[0].value+=.01;
  assert.throws(()=>candidateFromJointFit(job,changed,job.request.model_id!),/match/);
  const wrongUnits=structuredClone(native);wrongUnits.measurements[0].measurements.find(m=>m.name==='dbfs')!.unit='Hz';
  const options={id:'test',experimentId:'test',intervention:'native test',createdAt:new Date().toISOString(),solverCalls:1};
  assert.throws(()=>forecastFromPcm(candidate,wrongUnits,options),/missing/);
  const wrongLineage=structuredClone(native);wrongLineage.measurements[0].observationId='other';
  assert.throws(()=>forecastFromPcm(candidate,wrongLineage,options),/lineage/);
  for(const field of ['window','hash','clock']){
    const altered=structuredClone(native);
    if(field==='window')altered.measurements[0].window.startMs=1;
    if(field==='hash')altered.measurements[0].provenance.sourceHashes=[];
    if(field==='clock')altered.measurements[0].timebase.syncUncertaintyMs=null;
    assert.throws(()=>forecastFromPcm(candidate,altered,options),/lineage/);
  }
});

test('native and local job artifact tampering fails integrity checks',async()=>{
  const path=resolve(job.outputRoot,'result.json'),original=await readFile(path);
  try{await writeFile(path,Buffer.concat([original,Buffer.from(' ')]));
    await assert.rejects(readLocalJob(python,resolve(output,'a-source/jobs'),job.row.id),/integrity/);
  }finally{await writeFile(path,original);}
  const wav=resolve(output,'forecast-native/audio.wav'),bytes=await readFile(wav);
  try{await writeFile(wav,Buffer.concat([bytes,Buffer.from(' ')]));
    await assert.rejects(importNativeForward(root,resolve(output,'forecast-native'),resolve(output,'a-source/capabilities.json'),resolve(temporary,'bad-import')),/digest mismatch/);
  }finally{await writeFile(wav,bytes);}
});

test('replay output cannot be overwritten',async()=>{
  await assert.rejects(replayKitScience(root,output,python),/EEXIST/);
});
