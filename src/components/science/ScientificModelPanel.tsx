import {useEffect,useRef,useState} from 'react';
import {scienceAction,scienceAsset,useScienceOutcome,useScienceStatus,verifiedScienceAsset} from './scienceClient';
import './ScientificModel.css';
import {parseSpaceDiff,setModelAdjustments} from './modelAdjustments';
import {notifyScienceResult,setCaptureProgress,useLatestNativeCapture} from './captureFlow';
import {LoaderCircle} from 'lucide-react';
export function ScientificModelPanel({onPreview}:{onPreview:()=>void}){
 const [refresh,setRefresh]=useState(0),[notice,setNotice]=useState(''),[starting,setStarting]=useState(false);
 const [voiceOnly,setVoiceOnly]=useState(false),[outcomeConfirmed,setOutcomeConfirmed]=useState(false);
 const receipt=useLatestNativeCapture();
 const requested=useRef<{kind:'fit'|'outcome';id:string}|null>(null),completed=useRef(new Set<string>());
 const [geometryStatus,setGeometryStatus]=useState(''),[geometryRetry,setGeometryRetry]=useState(0);
 const [processingLabel,setProcessingLabel]=useState('');
 const state=useScienceStatus(refresh),r=state.result;
 const outcome=useScienceOutcome(state.status==='succeeded'?state.runId:undefined,refresh);
 const selected=r?.forecast.rankings.find(rank=>rank.experiment.experiment_id===r.forecast.selected_experiment_id)?.experiment;
 const recordingAllowed=r?.recordingAllowed!==false&&!r?.restDecision;
 const busy=starting||state.status==='running'||outcome.status==='running';
 async function run(purpose:'calibration'|'outcome'){
  if(busy)return;
  if(purpose==='outcome'&&!recordingAllowed){setNotice(r?.recordingMessage||'Astra selected rest. Request a new recording decision before scoring.');return;}
  setStarting(true);setNotice('');setProcessingLabel('Verifying iPhone capture…');setCaptureProgress({stage:'preparing',label:'Verifying capture…'});
  try{
   await scienceAction('use-latest-capture',{purpose,pose:purpose==='calibration'?'a':selected?.pose,contains_external_excitation:false});
   const launched=await scienceAction(purpose==='calibration'?'run':'outcome');
   if(purpose==='outcome'&&launched.status==='succeeded'){requested.current=null;setCaptureProgress(null);setProcessingLabel('');setRefresh(value=>value+1);setNotice('This recording was already scored. Showing its retained outcome.');setOutcomeConfirmed(false);window.dispatchEvent(new Event('singing:show-science'));return}
   requested.current={kind:purpose==='calibration'?'fit':'outcome',id:purpose==='calibration'?launched.runId:launched.outcomeId};
   const label=purpose==='calibration'?'Fitting vocal-tract model…':'Scoring new recording…';setProcessingLabel(label);setCaptureProgress({stage:purpose==='calibration'?'fitting':'scoring',label});
   setRefresh(value=>value+1);
   setNotice(purpose==='calibration'?'Voice fitting started. The app will retrieve the result automatically.':'Later recording submitted. The app will retrieve the scientific result automatically.');
   setVoiceOnly(false);setOutcomeConfirmed(false);
  }catch(error){setNotice(String(error));setCaptureProgress(null);setProcessingLabel('');window.dispatchEvent(new Event('singing:show-science'))}finally{setStarting(false)}
 }
 useEffect(()=>{
  const process=(event:Event)=>{const detail=(event as CustomEvent<{purpose:string;pose:string}>).detail;if(detail?.purpose==='calibration'&&detail.pose==='a')void run('calibration');else if(detail?.purpose==='outcome'&&detail.pose===selected?.pose)void run('outcome')};
  window.addEventListener('singing:process-capture',process);return()=>window.removeEventListener('singing:process-capture',process);
 });
 useEffect(()=>{const clear=()=>{setVoiceOnly(false);setOutcomeConfirmed(false)};window.addEventListener('singing:native-capture',clear);return()=>window.removeEventListener('singing:native-capture',clear)},[]);
 useEffect(()=>{
  const job=requested.current;
  if(job&&((job.kind==='fit'&&state.runId===job.id&&['failed','interrupted'].includes(state.status))||(job.kind==='outcome'&&outcome.outcomeId===job.id&&['failed','interrupted'].includes(outcome.status)))){requested.current=null;setCaptureProgress(null);setProcessingLabel('');window.dispatchEvent(new Event('singing:show-science'))}
 },[state.status,state.runId,outcome.status,outcome.outcomeId]);
 useEffect(()=>{
  if(state.status!=='succeeded'||!r)return;
  const key='fit:'+r.runId+':'+geometryRetry;if(completed.current.has(key))return;
  let active=true;
  void (async()=>{
   try{
    if(r.files['space-diff.json']){
     setGeometryStatus('Verifying model geometry…');setCaptureProgress({stage:'geometry',label:'Preparing model changes…'});
     const diff=parseSpaceDiff(await verifiedScienceAsset(r,'space-diff.json'));if(!active)return;
     setModelAdjustments({runId:r.runId,diff,showDiff:true,jawPreview:false});setGeometryStatus('Model comparison applied to the live movement map and inside view.');
    }else setGeometryStatus('This result has no bound geometry comparison; no overlay was applied.');
    completed.current.add(key);
    notifyScienceResult('fit',r.runId,r.modelId??r.candidateId,r,r.sourceCaptureId);
    if(requested.current?.kind==='fit'&&requested.current.id===r.runId){requested.current=null;window.dispatchEvent(new Event('singing:show-model'))}
   }catch(error){if(active){setGeometryStatus('Could not apply model geometry: '+String(error));completed.current.add(key);window.dispatchEvent(new Event('singing:show-science'))}}
   finally{if(active){setCaptureProgress(null);setProcessingLabel('')}}
  })();return()=>{active=false};
 },[r,state.status,geometryRetry]);
 useEffect(()=>{
  if(outcome.status!=='succeeded'||!outcome.result||!state.runId)return;
  const key='outcome:'+outcome.outcomeId;if(completed.current.has(key))return;completed.current.add(key);
  notifyScienceResult('outcome',state.runId,outcome.outcomeId??outcome.result.modelId??state.runId,outcome.result,outcome.result.sourceCaptureId);
  if(requested.current?.kind==='outcome'){requested.current=null;setCaptureProgress(null);setProcessingLabel('');window.dispatchEvent(new Event('singing:show-science'))}
 },[outcome,state.runId]);
 return <section className="scientific-model" aria-busy={busy}><h3>Scientific model</h3><p>Local voice fitting → frozen acoustic predictions → native vocal-tract geometry.</p><p>Record a comfortable sustained ah vowel with the iPhone app, then use <strong>Pull iPhone</strong> to transfer it here.</p>
 {receipt&&<p className="science-capture-receipt"><strong>On this Mac:</strong> {receipt.name} · {receipt.verification} · {receipt.audioChunks??'unknown'} audio chunks. {receipt.captureId===r?.sourceCaptureId?'This is the capture used for the current fit.':'New capture available for review.'}</p>}
 {(busy||processingLabel)&&<p className="science-progress" role="status"><LoaderCircle className="capture-spinner" size={17}/>{processingLabel||(outcome.status==='running'?'Scoring recorded evidence…':'Running model jobs…')} Results appear automatically; keep this local server running.</p>}
 {geometryStatus&&<p role="status">{geometryStatus} {geometryStatus.startsWith('Could not')&&<button onClick={()=>setGeometryRetry(v=>v+1)}>Retry geometry download</button>}</p>}
 <div className="scientific-inputs"><span>Calibration vowel: <strong>a (ah)</strong>. This fitting protocol uses that vowel.</span>
 <label><input type="checkbox" checked={voiceOnly} onChange={event=>setVoiceOnly(event.target.checked)} disabled={busy}/> This latest recording contains only my sustained a (ah) vowel, with no played probe or external excitation.</label></div>
 <div className="scientific-actions"><button onClick={()=>void run('calibration')} disabled={busy||!voiceOnly||state.status==='loading'||state.status==='unavailable'}>{state.status==='running'?'Model jobs running…':'Fit latest iPhone capture'}</button>{r&&<button onClick={onPreview}>Preview predicted geometry</button>}<span>Model: {state.status}</span></div>
 <p role="status">{notice||state.error}</p>
 {r?.geometryModelId&&<p>Displayed geometry: original fitted model {r.geometryModelId}. Current experiment model: {r.modelId}. The current forecast reflects the selected experiment; the original geometry is historical.</p>}
 {r&&<section className="scientific-outcome" aria-label="Next recording experiment"><h4>Test the frozen prediction</h4>
 {!recordingAllowed&&<p role="status">{r.recordingMessage||'Astra selected rest. Request a new recording decision before another capture.'}</p>}
 {selected?<><p>Record a new sustained <strong>{selected.pose}</strong> vowel on the iPhone, then use <strong>Pull iPhone</strong> again. Keep your setup consistent. The app compares this later recording with predictions made before hearing it.</p>
 <p>The forecast assumes jaw −3°, source pitch 180 Hz and digital gain 4. These are model settings; the app does not measure that you reproduced them.</p>
 <label><input type="checkbox" checked={outcomeConfirmed} onChange={event=>setOutcomeConfirmed(event.target.checked)} disabled={busy||!recordingAllowed}/> The latest capture is a new {selected.pose} vowel recording, without played probes or external excitation.</label>
 <div className="scientific-actions"><button onClick={()=>void run('outcome')} disabled={busy||!recordingAllowed||!outcomeConfirmed||state.status!=='succeeded'}>{outcome.status==='running'?'Scoring latest recording…':outcome.status==='failed'||outcome.status==='interrupted'?'Retry latest iPhone capture':'Score latest iPhone capture'}</button><span>Outcome processing: {outcome.status}</span></div></>:<p>No separating experiment was selected. There is no committed next recording to score.</p>}
 {outcome.error&&<p role="alert">{outcome.error}</p>}
 {outcome.result&&<div role="status"><p>Scientific result: <strong>{outcome.result.scientificStatus||outcome.result.status}</strong>. {outcome.result.modelUpdated?'The session model was updated from the recorded evidence.':'No model update was applied.'} This does not validate the inferred anatomy.</p>{outcome.result.modelUpdated&&<p>The retained candidate set was updated. The displayed geometry remains the original fitted/reference pair until a newly exported geometry artifact is available.</p>}
 {outcome.result.reasons?.length? <p>Recording could not be used: {outcome.result.reasons.join('; ')}</p>:null}
 {outcome.result.error&&<p>{outcome.result.error}</p>}
 {outcome.result.missingReason&&<p>Unavailable measurement: {outcome.result.missingReason}</p>}
 {outcome.result.scores?.length?<table><thead><tr><th>Hypothesis</th><th>Standardized prediction error</th></tr></thead><tbody>{outcome.result.scores.map(score=><tr key={score.hypothesis_id}><td>{score.hypothesis_id}</td><td>{score.standardized_rms.toFixed(3)}</td></tr>)}</tbody></table>:null}
 {outcome.result.retainedHypotheses!=null&&<p>Retained hypotheses: {outcome.result.previousHypotheses??'unknown'} → {outcome.result.retainedHypotheses}.</p>}
 <p>Model lineage: {r.modelId||r.candidateId} → {outcome.result.modelId||'unchanged'}. Session: {outcome.result.sessionId||r.sessionId||'unavailable'}.</p></div>}
 </section>}
 {r&&<><p><strong>Actual native run:</strong> {r.nativeCalls} calls · {r.calibrationWindows} voice windows · {r.jobs.map(j=>j.operation).join(' → ')}. Source capture {r.sourceCaptureId?.slice(0,8)||'retained in import receipt'}.</p><p>Candidate discrepancy {r.fitDiscrepancy.toFixed(3)}; fixed-anatomy comparison {r.baselineDiscrepancy==null?'Unavailable':r.baselineDiscrepancy.toFixed(3)}. Lower discrepancy here does not establish correct anatomy.</p><table><thead><tr><th>Predicted vowel</th><th>Hypothesis</th><th>Pitch</th><th>Brightness (centroid)</th><th>Loudness</th></tr></thead><tbody>{r.forecast.rankings.flatMap(rank=>rank.predictions.map((p,i)=>{const m=p.canonical?.measurement.measurements??[];const value=(name:string)=>{const x=m.find(v=>v.name===name);return x?.value==null?'Unavailable':`${x.value.toFixed(1)} ${x.unit}`};return <tr key={`${rank.experiment.pose}-${i}`}><td>{rank.experiment.pose}</td><td>{p.hypothesis_id}</td><td>{value('pitchHz')}</td><td>{value('centroidHz')}</td><td>{value('dbfs')}</td></tr>}))}</tbody></table><p>{r.forecastRole} Conditions: jaw −3°, source pitch 180 Hz, digital gain 4. {r.forecast.selected_experiment_id?`Selected experiment: ${r.forecast.selected_experiment_id}.`:'No separating next experiment found.'}</p><details><summary>Geometry parameters and retained evidence</summary><table><thead><tr><th>Parameter</th><th>Candidate</th><th>Reference</th></tr></thead><tbody>{Object.entries(r.anatomy).map(([k,v])=><tr key={k}><td>{k}</td><td>{v.toFixed(3)}</td><td>{r.referenceAnatomy[k]?.toFixed(3)}</td></tr>)}</tbody></table><p>{r.interpretation} These parameters describe the vocal-tract model; they do not measure shoulder muscles, muscle tension or hidden tissue.</p><a href={scienceAsset(r.runId,'fit.json')} target="_blank" rel="noreferrer">Full fit</a> · <a href={scienceAsset(r.runId,'forecast.json')} target="_blank" rel="noreferrer">Frozen forecasts</a></details></>}</section>
}
