import {useState} from 'react';
import {useScienceStatus,verifiedScienceAsset} from './scienceClient';
import {parseSpaceDiff,setModelAdjustments,useModelAdjustments} from './modelAdjustments';
import './ScientificModel.css';
export function ModelAdjustmentControls(){
 const {result}=useScienceStatus(),applied=useModelAdjustments();
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function apply(){if(!result)return;setBusy(true);setError('');try{
  const diff=parseSpaceDiff(await verifiedScienceAsset(result,'space-diff.json'));
  setModelAdjustments({runId:result.runId,diff,showDiff:true,jawPreview:false});
 }catch(e){setError(String(e))}finally{setBusy(false)}}
 const changes=applied?Object.entries(applied.diff.anatomy).filter(([k,v])=>Math.abs(v-applied.diff.referenceAnatomy[k])>1e-6):[];
 return <details className="model-adjustment-controls"><summary>{applied?'Model applied':'Model adjustments'}</summary><div>
  <strong>Native geometry → live overlay</strong>
  <p>Apply the fitted vocal-tract hypothesis to the blue cast. Head and tongue motion stay live.</p>
  <button onClick={()=>void apply()} disabled={busy||!result?.files['space-diff.json']}>{busy?'Verifying…':applied?'Apply latest model':'Apply model geometry'}</button>
  {!result?.files['space-diff.json']&&<p>Run the model in Experiments to create its reference comparison.</p>}
  {applied&&<><button onClick={()=>setModelAdjustments(null)}>Clear model</button><label><input type="checkbox" checked={applied.showDiff} onChange={e=>setModelAdjustments({...applied,showDiff:e.target.checked})}/>Green added / red removed space</label>
  <label><input type="checkbox" checked={applied.jawPreview} onChange={e=>setModelAdjustments({...applied,jawPreview:e.target.checked})}/>Preview declared jaw pose ({applied.diff.articulation.JA.applied}°)</label>
  <p>Jaw preview moves the jaw and attached muscles in both views. This angle was fixed during fitting; it was not estimated from your voice.</p>
  <p>{changes.map(([k,v])=>`${k.replaceAll('_',' ')}: ${applied.diff.referenceAnatomy[k].toFixed(2)} → ${v.toFixed(2)}`).join('; ')||'No fitted anatomy difference.'}</p>
  <p>Colors compare this native model with its own reference at the same pose. They indicate geometric change, not good/bad technique. Head/neck placement is illustrative; posture and muscle tension are not inferred.</p></>}
  {error&&<p role="alert">{error}</p>}
 </div></details>
}
