import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compactMotionEvidence,boundedMotionEvidence,readMotionContext,MOTION_CONTEXT_LIMIT} from './motionContext.mjs';

const windows=Array.from({length:120},(_,index)=>({index,sourceStartSample:index*12000,sampleRateHz:48000,status:index%3?'scored':'unavailable',fit:{joint:{candidates:Array.from({length:18},(_,j)=>({candidate_id:'c'+j,status:'scored',weighted_mean_square_discrepancy:(j*7)%18}))}}}));
const limitations=['Discrete observed frames only.','Source F0 uses the declared pitch bank.','Scores are not probabilities.','Source changes the fixed-source bank cannot represent can appear as JA/gain changes; a path that beats the constant path is not evidence of articulation change on its own.','Measurement noise and pitch-bank switches can also make a time-varying path improve on a constant control.'];
const temporal=(overrides={})=>({status:'available',informationOverConstant:'exceeds-tolerance',limitations,settings:{penalties:[0,.1,1],maxLinkGapSeconds:.5,objectiveGapTolerance:.1,transitionInterpretation:'regularizer',uncertaintyInterpretation:'sensitivity sets',objective:'not copied',
  constantTolerancePerWindow:.01,constantComparison:'best constant JA/gain path against the best path; admissible when its summed improvement is within constantTolerancePerWindow times the included window count',pitchBankSwitches:'changes at pitch-bank switches may reflect source pitch'},
 segments:Array.from({length:40},(_,i)=>({positions:[3*i+1,3*i+2],startSeconds:i*.75+.35,endSeconds:i*.75+.69})),
 excludedWindows:Array.from({length:40},(_,i)=>({position:3*i,startSeconds:i*.75+.1,reason:i<20?'Unvoiced or invalid canonical window':'Measured pitch outside the one-semitone bank support'})),
 sensitivity:[0,.1,1,10].map(lambda=>({lambda,tiedBestAnatomyHashes:['a'.repeat(64)],constantComparison:{anatomySha256:'a'.repeat(64),JA:-3,gain:1,objective:2,improvement:lambda?0:.5,admissible:lambda>0},
  pathChangesAtPitchBankSwitch:[{fromPosition:9,toPosition:10}],
  alternatives:Array.from({length:5},(_,k)=>({anatomySha256:String(k).repeat(64),objective:k,dataCost:k,weightedTransitionCost:0,timeScaledTransitionCost:0,path:Array.from({length:80},(_,i)=>({position:i,candidateId:'c'+(i%18),JA:-3,gain:1,dataCost:0}))})),
  uncertainty:Array.from({length:80},(_,i)=>({position:i,startSeconds:i*.25,endSeconds:i*.25+.09,JASet:i%10===0?[-4,-3]:[-3],gainSet:[1],anatomyCount:1,candidateObjectiveGaps:Array(18).fill(0)})),
  transitionUncertainty:Array.from({length:79},(_,i)=>({fromPosition:i,toPosition:i+1,JAChangeSet:i%20===0?[-1,0]:[0],gainRatioSet:[1],admissiblePairCount:1}))})),...overrides});

test('long motion context retains timeline endpoints and explicitly counts omitted or missing evidence',()=>{
 const result=compactMotionEvidence({windows,modelUpdated:false,analysisPolicy:'motion-forward-bank-4'},{});
 assert.equal(result.windows.length,12);assert.equal(result.windows[0].index,0);assert.equal(result.windows.at(-1).index,119);assert.equal(result.windows.at(-1).seconds,29.75);
 assert.equal(result.timeline.missingWindows,40);assert.equal(result.timeline.scoredWindows,80);assert.equal(result.windows[0].candidateCount,18);
 // The three lowest discrepancies, not the first three list entries.
 assert.deepEqual(result.windows[0].candidates.map(c=>c.discrepancy),[0,1,2]);assert.ok(JSON.stringify(result).length<MOTION_CONTEXT_LIMIT);
});

test('ambiguity sets, sampled segment boundaries and excluded-window reasons survive with explicit truncation',()=>{
 const result=boundedMotionEvidence({windows,temporalAnalysis:temporal(),warnings:[{code:'constant-within-tolerance',message:'constant'}],modelUpdated:false},{});
 assert.ok(JSON.stringify(result).length<=MOTION_CONTEXT_LIMIT);assert.equal(result.timeline.sampleSize,12);
 const t=result.temporal;assert.equal(t.informationOverConstant,'exceeds-tolerance');
 // The constant-path result travels with its definition and with what it cannot show.
 assert.deepEqual(t.limitations,limitations);assert.equal(t.settings.constantTolerancePerWindow,.01);assert.match(t.settings.constantComparison,/constantTolerancePerWindow times the included window count/);
 assert.ok(t.limitations.some(row=>row.includes('not evidence of articulation change')));
 assert.deepEqual(t.sensitivity[0].pathChangesAtPitchBankSwitch,{count:1,sample:[{fromPosition:9,toPosition:10}]});assert.equal(result.warnings[0].code,'constant-within-tolerance');
 assert.equal(t.settings.objective,undefined);assert.equal(t.settings.objectiveGapTolerance,.1);
 assert.equal(t.segments.count,40);assert.equal(t.segments.sample.length,12);assert.deepEqual(t.segments.sample[0],{firstPosition:1,lastPosition:2,startSeconds:.35,endSeconds:.69,windowCount:2});assert.equal(t.segments.sample.at(-1).lastPosition,119);
 assert.equal(t.excludedWindows.count,40);assert.equal(t.excludedWindows.sample.length,12);assert.ok(t.excludedWindows.sample.every(row=>row.reason&&row.startSeconds!==null));
 assert.deepEqual(t.excludedWindows.reasons,[{reason:'Unvoiced or invalid canonical window',count:20},{reason:'Measured pitch outside the one-semitone bank support',count:20}]);assert.equal(t.excludedWindows.distinctReasonCount,2);
 // Four sensitivity settings and five alternatives are truncated with their totals kept.
 assert.equal(t.sensitivityCount,4);assert.equal(t.sensitivity.length,3);assert.deepEqual(t.sensitivity.map(s=>s.lambda),[0,.1,1]);
 for(const s of t.sensitivity){
  assert.equal(s.alternativeCount,5);assert.equal(s.alternatives.length,3);assert.equal(s.alternatives[0].path.length,12);assert.equal(s.alternatives[1].path,undefined);assert.equal(s.alternatives[1].pathLength,80);
  assert.equal(s.uncertainty.count,80);assert.equal(s.uncertainty.ambiguousCount,8);assert.equal(s.uncertainty.sample.length,8);assert.ok(s.uncertainty.sample.every(u=>u.JASet.length===2));
  assert.equal(s.transitionUncertainty.ambiguousCount,4);assert.deepEqual(s.transitionUncertainty.sample.map(u=>u.fromPosition),[0,20,40,60]);
  assert.equal(s.constantComparison.admissible,s.lambda>0);
 }
 // Without ambiguous windows the sample spans all of them.
 const clear=temporal();clear.sensitivity[0].uncertainty.forEach(u=>{u.JASet=[-3];});
 const plain=compactMotionEvidence({windows,temporalAnalysis:clear},{}).temporal.sensitivity[0].uncertainty;
 assert.equal(plain.ambiguousCount,0);assert.equal(plain.sample.length,12);assert.equal(plain.sample.at(-1).position,79);
});

test('context over the 24,000-character limit shrinks its samples, then reports unavailable',()=>{
 const long=temporal();long.excludedWindows.forEach(row=>{row.reason='Recorded dropout '+'x'.repeat(1400)+row.position;});
 // Forty distinct reasons: eight are listed, each cut to 400 characters, and the distinct count is kept.
 const grouped=compactMotionEvidence({windows,temporalAnalysis:long},{},2).temporal.excludedWindows;
 assert.equal(grouped.distinctReasonCount,40);assert.equal(grouped.reasons.length,8);assert.ok(grouped.reasons.every(row=>row.reason.length===400));
 const wordy=temporal({limitations:['z'.repeat(5000),...limitations,'seventh','eighth']});
 const bounded=compactMotionEvidence({windows,temporalAnalysis:wordy},{}).temporal.limitations;
 assert.equal(bounded.length,6);assert.equal(bounded[0].length,400);
 const full=compactMotionEvidence({windows,temporalAnalysis:long},{});assert.ok(JSON.stringify(full).length>MOTION_CONTEXT_LIMIT);
 const reduced=boundedMotionEvidence({windows,temporalAnalysis:long},{});
 assert.ok(reduced.timeline.sampleSize<12);assert.ok(JSON.stringify(reduced).length<=MOTION_CONTEXT_LIMIT);assert.equal(reduced.temporal.excludedWindows.count,40);
 assert.equal(boundedMotionEvidence({windows,temporalAnalysis:temporal(),assumptions:['y'.repeat(MOTION_CONTEXT_LIMIT)]},{}),null);
});

test('readMotionContext reports unavailable instead of an oversized verified context',async t=>{
 const root=await mkdtemp(join(tmpdir(),'motion-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const hash=b=>createHash('sha256').update(b).digest('hex'),put=async(path,value)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
 const record=Buffer.from('{"kind":"motion-observation"}'),media=Buffer.from('encoded-fixture-bytes'),rh=hash(record),mh=hash(media),id=hash(rh+mh),receipt={id,recordSha256:rh,mediaSha256:mh,mediaByteLength:media.length};
 await put(`motion-captures/${id}/summary.json`,receipt);await put(`motion-captures/${id}/record.json`,record);await put(`motion-captures/${id}/media`,media);
 await put('motion-latest.json',{id});await put(`motion-analyses/${id}/current.json`,{status:'succeeded',captureId:id,expectedModelId:'model-one',analysisId:'analysis-one',pose:'a'});
 const summary=assumptions=>({kind:'motion-pcm-fit-1',status:'available',captureId:id,pose:'a',sessionId:'session-one',modelId:'model-one',modelUpdated:false,sourceHashes:{record:rh,media:mh,receipt:hash(JSON.stringify(receipt))},windows,temporalAnalysis:temporal(),assumptions});
 await put(`motion-analyses/${id}/analysis-one/summary.json`,summary(['fixed controls']));
 const available=await readMotionContext({dataRoot:root,sessionId:'session-one',modelId:'model-one'});
 assert.equal(available.status,'available');assert.equal(available.temporal.sensitivity[0].uncertainty.ambiguousCount,8);
 await put(`motion-analyses/${id}/analysis-one/summary.json`,summary(['y'.repeat(MOTION_CONTEXT_LIMIT)]));
 assert.deepEqual(await readMotionContext({dataRoot:root,sessionId:'session-one',modelId:'model-one'}),{status:'unavailable',modelUpdated:false,reason:`Verified motion audio analysis exceeds the ${MOTION_CONTEXT_LIMIT}-character Astra context limit even at the smallest sample size`});
});
