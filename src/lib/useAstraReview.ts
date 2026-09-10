import { useEffect, useRef, useState } from 'react';
export type Review={status:string;message?:string;text?:string;captureId?:string;captureKey?:string;runId?:string;model?:string;canReview?:boolean};
export function useAstraReview(){
  const [review,setReview]=useState<Review|null>(null);
  const revision=useRef(0);
  const attempted=useRef(new Set<string>());
  const [retrying,setRetrying]=useState(false);
  useEffect(()=>{
    let disposed=false,busy=false;
    const refresh=async()=>{
      if(busy)return;busy=true;const started=revision.current;
      try{
        const response=await fetch('/api/astra-review');if(!response.ok)return;
        const next:Review=await response.json();if(disposed||started!==revision.current)return;setReview(next.status==='dismissed'?null:next);
        const key=`${next.captureKey}:${next.runId}`;
        if(next.status==='ready'&&next.canReview&&!attempted.current.has(key)){
          attempted.current.add(key);const response=await fetch('/api/astra-review',{method:'POST'});
          if(response.ok){const next:Review=await response.json();if(!disposed&&started===revision.current)setReview(next.status==='dismissed'?null:next);}
        }
      }catch{/* Keep the saved review visible through a transient local disconnect. */}finally{busy=false}
    };
    void refresh();const interval=setInterval(()=>void refresh(),4000);
    const reset=()=>{revision.current++;setReview(null);void refresh()};window.addEventListener('singing:astra-reset',reset);
    const changed=()=>void refresh();window.addEventListener('singing:native-capture',changed);window.addEventListener('singing:science-result',changed);
    return()=>{disposed=true;clearInterval(interval);window.removeEventListener('singing:astra-reset',reset);window.removeEventListener('singing:native-capture',changed);window.removeEventListener('singing:science-result',changed)};
  },[]);
  const retry=async()=>{const started=revision.current;setRetrying(true);try{const response=await fetch('/api/astra-review',{method:'POST'});const next:Review=await response.json();if(started===revision.current)setReview(next.status==='dismissed'?null:next)}catch{if(started===revision.current)setReview(previous=>({...previous,status:'error',message:'Cannot reach the local review server.'}))}finally{setRetrying(false)}};
  return {review,retry,retrying};
}
