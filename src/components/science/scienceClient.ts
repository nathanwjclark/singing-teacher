import {useEffect,useState} from 'react';
export interface ScientificResult {
 schemaVersion:string;runId:string;sourceCaptureId:string|null;createdAt:string;nativeCalls:number;calibrationWindows:number;eligibleWindows:number;candidateId:string;
 anatomy:Record<string,number>;referenceAnatomy:Record<string,number>;fitDiscrepancy:number;baselineDiscrepancy:number|null;interpretation:string;geometryRole:string;forecastRole:string;
 files:Record<string,{sha256:string;byteLength:number}>;
 forecast:{selected_experiment_id:string|null;target_observation_id:string;rankings:Array<{experiment:{pose:string;experiment_id:string};predictions:Array<{hypothesis_id:string;canonical?:{measurement:{measurements:Array<{name:string;value:number|null;unit:string}>}}}>}>};
 jobs:Array<{id:string;operation:string;status:string}>;
}
export interface ScienceStatus {status:string;runId?:string;error?:string;result?:ScientificResult}
export const scienceAsset=(run:string,name:string)=>`/api/science/asset?run=${encodeURIComponent(run)}&name=${encodeURIComponent(name)}`;
export function useScienceStatus(){
 const [state,setState]=useState<ScienceStatus>({status:'loading'});
 useEffect(()=>{let active=true;const refresh=async()=>{try{const r=await fetch('/api/science/status',{cache:'no-store'});if(!r.ok)throw Error('Local scientific service unavailable');const s=await r.json();if(active)setState(previous=>previous.status===s.status&&previous.runId===s.runId&&previous.error===s.error?previous:s)}catch{if(active)setState({status:'unavailable'})}};void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{active=false;clearInterval(timer)}},[]);
 return state;
}
export async function verifiedScienceAsset(result:ScientificResult,name:string){
 const expected=result.files[name];if(!expected)throw Error('No bound model artifact');
 const response=await fetch(scienceAsset(result.runId,name),{cache:'no-store'});if(!response.ok)throw Error('Model artifact unavailable');
 const bytes=await response.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==expected.byteLength||hash!==expected.sha256)throw Error('Model artifact hash/size mismatch');return bytes;
}
