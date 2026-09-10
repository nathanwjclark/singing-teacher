import {useEffect,useState} from 'react';
export interface ScientificResult {
 geometryModelId?:string;decisionId?:string;designId?:string;
 schemaVersion:string;runId:string;sessionId?:string;modelId?:string;sourceCaptureId:string|null;createdAt:string;nativeCalls:number;calibrationWindows:number;eligibleWindows:number;candidateId:string;
 anatomy:Record<string,number>;referenceAnatomy:Record<string,number>;fitDiscrepancy:number;baselineDiscrepancy:number|null;interpretation:string;geometryRole:string;forecastRole:string;
 files:Record<string,{sha256:string;byteLength:number}>;
 forecast:{selected_experiment_id:string|null;target_observation_id:string;rankings:Array<{experiment:{pose:string;experiment_id:string};predictions:Array<{hypothesis_id:string;canonical?:{measurement:{measurements:Array<{name:string;value:number|null;unit:string}>}}}>}>};
 jobs:Array<{id:string;operation:string;status:string}>;
}
export interface ScienceStatus {status:string;runId?:string;error?:string;result?:ScientificResult}
export interface OutcomeStatus {
 status:string;runId?:string;outcomeId?:string;error?:string;
 result?:{sourceCaptureId?:string;sourceManifestSha256?:string;status:string;scientificStatus:string|null;modelUpdated:boolean;modelId?:string;sessionId?:string;jobId?:string;workerStatus?:string;scores?:Array<{hypothesis_id:string;standardized_rms:number}>;missingReason?:string|null;retainedHypotheses?:number|null;previousHypotheses?:number|null;reasons?:string[];error?:string;source?:string;anatomyValidated:false};
}
export async function scienceAction(path:string,body?:unknown){
 const response=await fetch('/api/science/'+path,{method:'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Scientific action failed');
 return data;
}
export const scienceAsset=(run:string,name:string)=>`/api/science/asset?run=${encodeURIComponent(run)}&name=${encodeURIComponent(name)}`;
export function useScienceStatus(refreshKey=0){
 const [state,setState]=useState<ScienceStatus>({status:'loading'});
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const r=await fetch('/api/science/status',{cache:'no-store'});if(!r.ok)throw Error('Local scientific service unavailable');const s=await r.json();if(active)setState(previous=>JSON.stringify(previous)===JSON.stringify(s)?previous:s)}catch{if(active)setState({status:'unavailable'})}finally{if(active)timer=setTimeout(()=>void refresh(),3000)}};void refresh();return()=>{active=false;clearTimeout(timer)}},[refreshKey]);
 return state;
}
export function useScienceOutcome(runId:string|undefined,refreshKey=0){
 const [entry,setEntry]=useState<{runId?:string;state:OutcomeStatus}>({state:{status:'not-run'}});
 useEffect(()=>{
  if(!runId)return;
  let active=true;let timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{try{
   const response=await fetch('/api/science/outcome',{cache:'no-store'}),data=await response.json();
   if(!response.ok)throw Error(data.error||'Outcome service unavailable');
   if(data.runId&&data.runId!==runId){if(active)setEntry({runId,state:{status:'not-run'}});return;}
   if(active)setEntry(previous=>previous.runId===runId&&JSON.stringify(previous.state)===JSON.stringify(data)?previous:{runId,state:data});
  }catch(error){if(active)setEntry({runId,state:{status:'unavailable',error:String(error)}})}finally{if(active)timer=setTimeout(()=>void refresh(),3000)}};
  void refresh();return()=>{active=false;clearTimeout(timer)};
 },[runId,refreshKey]);
 return runId&&entry.runId===runId?entry.state:{status:runId?'loading':'not-run'} as OutcomeStatus;
}
export async function verifiedScienceAsset(result:ScientificResult,name:string){
 const expected=result.files[name];if(!expected)throw Error('No bound model artifact');
 const response=await fetch(scienceAsset(result.runId,name),{cache:'no-store'});if(!response.ok)throw Error('Model artifact unavailable');
 const bytes=await response.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==expected.byteLength||hash!==expected.sha256)throw Error('Model artifact hash/size mismatch');return bytes;
}
