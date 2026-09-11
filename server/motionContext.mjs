import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function bytes(path,limit){const file=await open(path,'r');try{const st=await file.stat();if(!st.isFile()||st.size>limit)throw Error('Bound exceeded');const data=await file.readFile();if(data.length!==st.size)throw Error('Evidence changed');return data;}finally{await file.close();}}
export async function readMotionContext({dataRoot,sessionId,modelId}){
 const unavailable={status:'unavailable',modelUpdated:false,reason:'No verified current motion audio analysis'};
 try{
  const latest=await bytes(join(dataRoot,'motion-latest.json'),2048),id=JSON.parse(latest).id;
  if(!/^[a-f0-9]{64}$/.test(id))return unavailable;
  const stateBytes=await bytes(join(dataRoot,'motion-analyses',id,'current.json'),8192),state=JSON.parse(stateBytes);
  if(state.status!=='succeeded'||state.captureId!==id||state.expectedModelId!==modelId||!/^[A-Za-z0-9_-]{1,100}$/.test(state.analysisId))return unavailable;
  const resultBytes=await bytes(join(dataRoot,'motion-analyses',id,state.analysisId,'summary.json'),4*1024*1024),r=JSON.parse(resultBytes);
  if(r.kind!=='motion-pcm-fit-1'||r.sessionId!==sessionId||r.modelId!==modelId||r.captureId!==id||r.pose!==state.pose||r.modelUpdated!==false)return unavailable;
  const base=join(dataRoot,'motion-captures',id);
  const [receiptBytes,recordBytes,media]=await Promise.all([bytes(join(base,'summary.json'),1048576),bytes(join(base,'record.json'),4*1024*1024),bytes(join(base,'media'),64*1024*1024)]);
  const receipt=JSON.parse(receiptBytes),rh=hash(recordBytes),mh=hash(media);
  if(receipt.id!==id||hash(rh+mh)!==id||receipt.recordSha256!==rh||receipt.mediaSha256!==mh||receipt.mediaByteLength!==media.length||r.sourceHashes?.receipt!==hash(receiptBytes)||r.sourceHashes?.record!==rh||r.sourceHashes?.media!==mh)return unavailable;
  if(!latest.equals(await bytes(join(dataRoot,'motion-latest.json'),2048))||!stateBytes.equals(await bytes(join(dataRoot,'motion-analyses',id,'current.json'),8192)))return unavailable;
  return boundedMotionEvidence(r,{sessionId,modelId,captureId:id,analysisId:state.analysisId,receiptSha256:hash(resultBytes)})??
   {...unavailable,reason:`Verified motion audio analysis exceeds the ${MOTION_CONTEXT_LIMIT}-character Astra context limit even at the smallest sample size`};
 }catch{return unavailable;}
}

export const MOTION_CONTEXT_LIMIT=24000;
const finite=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
function sample(values,limit){
 if(values.length<=limit)return values;
 return Array.from({length:limit},(_,i)=>values[Math.round(i*(values.length-1)/(limit-1))]);
}
const counted=(values,limit)=>({count:values.length,sample:sample(values,limit)});
const text=(value,limit=400)=>typeof value==='string'?value.slice(0,limit):null;
/** Counts per distinct reason: the first eight reasons, with the total number of distinct reasons. */
function reasonGroups(rows){
 const groups=Object.entries(Object.groupBy(rows,row=>row.reason));
 return {distinctReasonCount:groups.length,reasons:groups.slice(0,8).map(([reason,members])=>({reason:text(reason),count:members.length}))};
}
/** Rows with more than one admissible value, falling back to all rows; counts keep the omitted boundary explicit. */
function ambiguity(rows,limit,ambiguous){
 const set=rows.filter(ambiguous);
 return {count:rows.length,ambiguousCount:set.length,sample:sample(set.length?set:rows,limit)};
}
/** Largest even sample (12, 8, 4, then 2 per list) whose context fits the limit; null when none does. */
export function boundedMotionEvidence(r,identity){
 for(const size of [12,8,4,2]){const compact=compactMotionEvidence(r,identity,size);if(JSON.stringify(compact).length<=MOTION_CONTEXT_LIMIT)return compact;}
 return null;
}
/** Representative time samples; counts and full receipt hash preserve the omitted evidence boundary. */
export function compactMotionEvidence(r,identity,size=12){
 const all=r.windows??[],temporal=r.temporalAnalysis;
 const windows=sample(all,size).map(w=>({index:w.index,status:w.status,reason:w.reason??null,
  seconds:w.sampleRateHz>0?finite(w.sourceStartSample/w.sampleRateHz):null,
  pitchAnchorHz:finite(w.pitchAnchorHz),pitchDistanceCents:finite(w.pitchDistanceCents),
  candidateCount:w.fit?.joint?.candidates?.length??0,
  candidates:(w.fit?.joint?.candidates??[]).filter(c=>finite(c.weighted_mean_square_discrepancy)!==null)
   .sort((a,b)=>a.weighted_mean_square_discrepancy-b.weighted_mean_square_discrepancy).slice(0,3)
   .map(c=>({id:c.candidate_id,status:c.status,discrepancy:c.weighted_mean_square_discrepancy}))}));
 const subset=r.hypothesisSubset;
 return {...identity,status:r.status,sourceHashes:r.sourceHashes,pose:r.pose,windows,
  timeline:{totalWindows:all.length,scoredWindows:all.filter(w=>w.status==='scored').length,missingWindows:all.filter(w=>w.status!=='scored').length,
   returnedWindows:windows.length,sampleSize:size,sampling:`At most ${size} evenly spaced entries per list including both endpoints; candidate rows are the three lowest discrepancies; ambiguity samples prefer windows and transitions with more than one admissible value`},
  analysisPolicy:r.analysisPolicy??'legacy-three-window',trajectoryBank:r.trajectoryBank?{kind:r.trajectoryBank.kind,pitchAnchorsHz:r.trajectoryBank.pitchAnchorsHz,maxPitchDistanceCents:r.trajectoryBank.maxPitchDistanceCents,synthesisRequests:r.trajectoryBank.synthesisRequests,objective:r.trajectoryBank.objective??null}:null,
  objective:r.objective??null,warnings:r.warnings??[],
  // The native source parameter table and provenance stay in the receipt; their code hashes identify them here.
  assumptions:r.assumptions,sourceConditions:r.sourceConditions&&{fixedPressurePa:r.sourceConditions.fixedPressurePa,pressureRampSeconds:r.sourceConditions.pressureRampSeconds,F0:r.sourceConditions.F0,
   otherControls:r.sourceConditions.otherControls,engineSha256:r.sourceConditions.engineSha256,fitterSha256:r.sourceConditions.fitterSha256},
  hypothesisSubset:subset?{selectedIds:subset.selectedIds,totalRetained:subset.totalRetained,selection:subset.selection,rankingBasis:subset.rankingBasis??null}:null,modelUpdated:false,visualSync:'unknown',
  interpretation:'Conditional audio hypotheses only. Temporal objective gaps are not probabilities or measured movement. No calibrated visual alignment or new action types.',
  temporal:temporal?{status:temporal.status,reason:temporal.reason??null,informationOverConstant:temporal.informationOverConstant??null,
   settings:temporal.settings&&{penalties:temporal.settings.penalties,maxLinkGapSeconds:temporal.settings.maxLinkGapSeconds,objectiveGapTolerance:temporal.settings.objectiveGapTolerance,
    constantTolerancePerWindow:temporal.settings.constantTolerancePerWindow??null,constantComparison:text(temporal.settings.constantComparison),pitchBankSwitches:text(temporal.settings.pitchBankSwitches),
    transitionInterpretation:temporal.settings.transitionInterpretation,uncertaintyInterpretation:temporal.settings.uncertaintyInterpretation},
   // What the constant-path result cannot show travels with it.
   limitations:(temporal.limitations??[]).slice(0,6).map(value=>text(value)),
   segments:counted((temporal.segments??[]).map(s=>({firstPosition:s.positions[0],lastPosition:s.positions.at(-1),startSeconds:s.startSeconds,endSeconds:s.endSeconds,windowCount:s.positions.length})),size),
   excludedWindows:{...counted((temporal.excludedWindows??[]).map(e=>({position:e.position,startSeconds:finite(e.startSeconds),reason:e.reason})),size),
    ...reasonGroups(temporal.excludedWindows??[])},
   sensitivityCount:temporal.sensitivity?.length??0,
   sensitivity:(temporal.sensitivity??[]).slice(0,3).map(s=>({lambda:s.lambda,tiedBestAnatomyHashes:s.tiedBestAnatomyHashes,constantComparison:s.constantComparison??null,alternativeCount:s.alternatives?.length??0,
    pathChangesAtPitchBankSwitch:counted(s.pathChangesAtPitchBankSwitch??[],size),
    // Only the minimum-objective path is sampled in time; other anatomies keep their costs.
    alternatives:(s.alternatives??[]).slice(0,3).map((a,i)=>({anatomySha256:a.anatomySha256,dataCost:a.dataCost,transitionCost:a.weightedTransitionCost,timeScaledTransitionCost:a.timeScaledTransitionCost,objective:a.objective,pathLength:a.path?.length??0,
     ...(i===0?{path:sample(a.path??[],size).map(p=>({position:p.position,candidateId:p.candidateId,JA:p.JA,gain:p.gain}))}:{})})),
    uncertainty:ambiguity((s.uncertainty??[]).map(u=>({position:u.position,startSeconds:u.startSeconds,JASet:u.JASet,gainSet:u.gainSet,anatomyCount:u.anatomyCount})),size,u=>u.JASet.length>1||u.gainSet.length>1||u.anatomyCount>1),
    transitionUncertainty:ambiguity((s.transitionUncertainty??[]).map(t=>({fromPosition:t.fromPosition,toPosition:t.toPosition,JAChangeSet:t.JAChangeSet,gainRatioSet:t.gainRatioSet})),size,t=>t.JAChangeSet.length>1||t.gainRatioSet.length>1)}))}:null};
}
