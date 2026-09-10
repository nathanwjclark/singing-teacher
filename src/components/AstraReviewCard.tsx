import { useEffect, useRef, useState } from 'react';
import './AstraReviewCard.css';
type Review={status:string;message?:string;text?:string;captureId?:string;captureKey?:string;runId?:string;model?:string;canReview?:boolean};
export function AstraReviewCard(){
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
  if(!review)return null;
  return <aside className="astra-review-card" aria-label="Astra model review" data-status={review.status}>
    <header><strong>ASTRA · MODEL REVIEW</strong><span>{review.status==='complete'?'SAVED':review.status==='running'?'REVIEWING':review.status==='error'?'RETRY NEEDED':'WAITING'}</span></header>
    {review.text?<details><summary>{review.text.split('\n').find(line=>line.trim())}</summary><p>{review.text}</p><small>gpt-6-astra · {review.captureId?.slice(0,8)} · {review.runId}<br/>Model hypotheses; stays until the next phone capture.</small></details>:<p>{review.message||'Reviewing model geometry and predicted voice effects…'}</p>}
    {review.status==='error'&&review.canReview&&<button type="button" disabled={retrying} onClick={()=>void retry()}>{retrying?'Starting…':'Retry review'}</button>}
  </aside>;
}
