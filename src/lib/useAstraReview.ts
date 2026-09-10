import { useEffect, useRef, useState } from 'react';
export type Review={status:string;message?:string;text?:string;captureId?:string;captureKey?:string;runId?:string;model?:string;canReview?:boolean};
export function useAstraReview(){
  const [review,setReview]=useState<Review|null>(null);
  const attempted=useRef(new Set<string>());
  const [retrying,setRetrying]=useState(false);
  useEffect(()=>{
    let disposed=false,busy=false;
    const refresh=async()=>{
      if(busy)return;busy=true;
      try{
        const response=await fetch('/api/astra-review');if(!response.ok)return;
        const next:Review=await response.json();if(disposed)return;setReview(next);
        const key=`${next.captureKey}:${next.runId}`;
        if(next.status==='ready'&&next.canReview&&!attempted.current.has(key)){
          attempted.current.add(key);const response=await fetch('/api/astra-review',{method:'POST'});
          if(response.ok&&!disposed)setReview(await response.json());
        }
      }catch{/* Keep the saved review visible through a transient local disconnect. */}finally{busy=false}
    };
    void refresh();const interval=setInterval(()=>void refresh(),4000);
    const changed=()=>void refresh();window.addEventListener('singing:native-capture',changed);window.addEventListener('singing:science-result',changed);
    return()=>{disposed=true;clearInterval(interval);window.removeEventListener('singing:native-capture',changed);window.removeEventListener('singing:science-result',changed)};
  },[]);
  const retry=async()=>{setRetrying(true);try{const response=await fetch('/api/astra-review',{method:'POST'});setReview(await response.json())}catch{setReview(previous=>({...previous,status:'error',message:'Cannot reach the local review server.'}))}finally{setRetrying(false)}};
  return {review,retry,retrying};
}
