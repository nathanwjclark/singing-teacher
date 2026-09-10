import type { Review } from '../lib/useAstraReview';
import './AstraReviewCard.css';
export function AstraReviewCard({review,selected,onSelect}:{review:Review;selected:boolean;onSelect:()=>void}){
  return <li className={`coaching-tip coaching-tip--good astra-review-card ${selected?'coaching-tip--selected':''}`} aria-label="Astra model review" data-status={review.status}>
    <div className="coaching-tip-topline"><span className="coaching-tip-number">✦</span><span className="coaching-tip-region">MODEL REVIEW</span></div>
    <h3><button className="coaching-select" type="button" onClick={onSelect} aria-pressed={selected} aria-describedby={selected?'selected-cue-detail':undefined}>Your model review</button></h3>
    <div className="recent-cue-time"><span className={review.status==='complete'?'cue-present':''}>{review.status==='complete'?'Saved':review.status==='running'?'Reviewing':review.status==='error'?'Retry needed':'Waiting'}</span><span>ASTRA</span></div>
  </li>;
}
export function AstraReviewDetail({review,retry,retrying}:{review:Review;retry:()=>Promise<void>;retrying:boolean}){
  return <div className="selected-cue-detail astra-review-detail" id="selected-cue-detail" tabIndex={0} role="region" aria-label="Full Astra model review">
    <p>{review.text||review.message||'Reviewing model geometry and predicted voice effects…'}</p>
    {review.text&&<span>gpt-6-astra · {review.captureId?.slice(0,8)} · Model hypotheses<br/>Saved until the next phone recording.</span>}
    {review.status==='error'&&review.canReview&&<button type="button" disabled={retrying} onClick={()=>void retry()}>{retrying?'Starting…':'Retry review'}</button>}
  </div>;
}
