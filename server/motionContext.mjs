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
  const compact=compactMotionEvidence(r,{sessionId,modelId,captureId:id,analysisId:state.analysisId,receiptSha256:hash(resultBytes)});
  return JSON.stringify(compact).length<=24000?compact:unavailable;
 }catch{return unavailable;}
}

const finite=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
function sample(values,limit){
 if(values.length<=limit)return values;
 return Array.from({length:limit},(_,i)=>values[Math.round(i*(values.length-1)/(limit-1))]);
}
/** Representative time samples; counts and full receipt hash preserve the omitted evidence boundary. */
export function compactMotionEvidence(r,identity){
 const all=r.windows??[],temporal=r.temporalAnalysis;
 const windows=sample(all,12).map(w=>({index:w.index,status:w.status,reason:w.reason??null,
  seconds:w.sampleRateHz>0?finite(w.sourceStartSample/w.sampleRateHz):null,
  pitchAnchorHz:finite(w.pitchAnchorHz),pitchDistanceCents:finite(w.pitchDistanceCents),
  candidateCount:w.fit?.joint?.candidates?.length??0,
  candidates:(w.fit?.joint?.candidates??[]).slice(0,3).map(c=>({id:c.candidate_id,status:c.status,discrepancy:finite(c.weighted_mean_square_discrepancy)}))}));
 return {...identity,status:r.status,sourceHashes:r.sourceHashes,pose:r.pose,windows,
  timeline:{totalWindows:all.length,scoredWindows:all.filter(w=>w.status==='scored').length,missingWindows:all.filter(w=>w.status!=='scored').length,
   returnedWindows:windows.length,sampling:'At most 12 evenly spaced windows including both endpoints; candidate rows truncated to first three retained entries'},
  analysisPolicy:r.analysisPolicy??'legacy-three-window',trajectoryBank:r.trajectoryBank?{kind:r.trajectoryBank.kind,pitchAnchorsHz:r.trajectoryBank.pitchAnchorsHz,maxPitchDistanceCents:r.trajectoryBank.maxPitchDistanceCents,synthesisRequests:r.trajectoryBank.synthesisRequests}:null,
  assumptions:r.assumptions,sourceConditions:r.sourceConditions,hypothesisSubset:r.hypothesisSubset,modelUpdated:false,visualSync:'unknown',
  interpretation:'Conditional audio hypotheses only. Temporal objective gaps are not probabilities or measured movement. No calibrated visual alignment or new action types.',
  temporal:temporal?{status:temporal.status,reason:temporal.reason??null,settings:temporal.settings,segmentCount:temporal.segments?.length??0,excludedWindowCount:temporal.excludedWindows?.length??0,
   sensitivity:(temporal.sensitivity??[]).slice(0,3).map(s=>({lambda:s.lambda,tiedBestAnatomyHashes:s.tiedBestAnatomyHashes,alternativeCount:s.alternatives?.length??0,
    alternatives:(s.alternatives??[]).slice(0,4).map(a=>({anatomySha256:a.anatomySha256,dataCost:a.dataCost,transitionCost:a.weightedTransitionCost,unweightedTransitionCost:a.unweightedTransitionCost,objective:a.objective,pathLength:a.path?.length??0,
     path:sample(a.path??[],12).map(p=>({position:p.position,candidateId:p.candidateId,JA:p.JA,gain:p.gain}))}))}))}:null};
}
