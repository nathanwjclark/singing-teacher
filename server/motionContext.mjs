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
  const finite=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
  const windows=(r.windows??[]).slice(0,3).map(w=>({index:w.index,status:w.status,reason:w.reason??null,candidates:(w.fit?.joint?.candidates??[]).slice(0,18).map(c=>({id:c.candidate_id,status:c.status,discrepancy:finite(c.weighted_mean_square_discrepancy)}))}));
  const temporal=r.temporalAnalysis;
  const compact={status:r.status,sessionId,modelId,captureId:id,analysisId:state.analysisId,receiptSha256:hash(resultBytes),sourceHashes:r.sourceHashes,pose:r.pose,windows,
   assumptions:r.assumptions,sourceConditions:r.sourceConditions,hypothesisSubset:r.hypothesisSubset,modelUpdated:false,visualSync:'unknown',
   interpretation:'Conditional audio hypotheses only. No measured JA, calibrated visual fitting, probabilities or new action types.',
   temporal:temporal?{status:temporal.status,reason:temporal.reason??null,settings:temporal.settings,segments:temporal.segments,excludedWindows:temporal.excludedWindows,
    sensitivity:(temporal.sensitivity??[]).slice(0,3).map(s=>({lambda:s.lambda,tiedBestAnatomyHashes:s.tiedBestAnatomyHashes,alternatives:s.alternatives.map(a=>({anatomySha256:a.anatomySha256,dataCost:a.dataCost,transitionCost:a.weightedTransitionCost,unweightedTransitionCost:a.unweightedTransitionCost,objective:a.objective,path:a.path.map(p=>({position:p.position,candidateId:p.candidateId,JA:p.JA,gain:p.gain}))}))}))}:null};
  return JSON.stringify(compact).length<=24000?compact:unavailable;
 }catch{return unavailable;}
}
