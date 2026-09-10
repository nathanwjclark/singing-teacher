import {useEffect,useState,useSyncExternalStore} from 'react';
export interface NativeCaptureReceipt {name:string;bytes:number;receivedAt:string;reused:boolean;verification:string;message:string;sha256?:string;captureId?:string;frames?:number;audioChunks?:number}
type Progress={stage:'preparing'|'fitting'|'scoring'|'geometry';label:string}|null;
let progress:Progress=null;
const listeners=new Set<()=>void>();
export function setCaptureProgress(value:Progress){progress=value;for(const listener of listeners)listener()}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export const useCaptureProgress=()=>useSyncExternalStore(subscribe,()=>progress,()=>null);
export function useLatestNativeCapture(){
 const [receipt,setReceipt]=useState<NativeCaptureReceipt|null>(null);
 useEffect(()=>{let active=true;
  const receive=(event:Event)=>{const value=(event as CustomEvent<NativeCaptureReceipt>).detail;if(active&&value?.name)setReceipt(value)};
  window.addEventListener('singing:native-capture',receive);
  void fetch('/api/native-captures/latest',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(active&&value?.receipt)setReceipt(current=>current??value.receipt)}).catch(()=>{});
  return()=>{active=false;window.removeEventListener('singing:native-capture',receive)};
 },[]);return receipt;
}
export function notifyScienceResult(kind:'fit'|'outcome',runId:string,resultId:string,result:unknown,sourceCaptureId?:string|null){
 window.dispatchEvent(new CustomEvent('singing:science-result',{detail:{kind,runId,resultId,result,sourceCaptureId}}));
}
