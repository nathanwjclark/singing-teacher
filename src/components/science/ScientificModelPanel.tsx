import {useState} from 'react';
import {scienceAction,scienceAsset,useScienceOutcome,useScienceStatus} from './scienceClient';
import './ScientificModel.css';
export function ScientificModelPanel({onPreview}:{onPreview:()=>void}){
 const [refresh,setRefresh]=useState(0),[notice,setNotice]=useState(''),[starting,setStarting]=useState(false);
 const [voiceOnly,setVoiceOnly]=useState(false),[outcomeConfirmed,setOutcomeConfirmed]=useState(false);
 const state=useScienceStatus(refresh),r=state.result;
 const outcome=useScienceOutcome(state.status==='succeeded'?state.runId:undefined,refresh);
 const selected=r?.forecast.rankings.find(rank=>rank.experiment.experiment_id===r.forecast.selected_experiment_id)?.experiment;
 const busy=starting||state.status==='running'||outcome.status==='running';
 async function run(purpose:'calibration'|'outcome'){
  setStarting(true);setNotice('');
  try{
   await scienceAction('use-latest-capture',{purpose,pose:purpose==='calibration'?'a':selected?.pose,contains_external_excitation:false});
   await scienceAction(purpose==='calibration'?'run':'outcome');
   setRefresh(value=>value+1);
   setNotice(purpose==='calibration'?'Voice fitting started. The app will retrieve the result automatically.':'Later recording submitted. The app will retrieve the scientific result automatically.');
   setVoiceOnly(false);setOutcomeConfirmed(false);
  }catch(error){setNotice(String(error))}finally{setStarting(false)}
 }
 return <section className="scientific-model"><h3>Scientific model</h3><p>Local voice fitting → frozen acoustic predictions → native vocal-tract geometry.</p><p>Record a comfortable sustained ah vowel with the iPhone app, then use <strong>Pull iPhone</strong> to transfer it here.</p>
 <div className="scientific-inputs"><span>Calibration vowel: <strong>a (ah)</strong>. This fitting protocol uses that vowel.</span>
 <label><input type="checkbox" checked={voiceOnly} onChange={event=>setVoiceOnly(event.target.checked)} disabled={busy}/> This latest recording contains only my sustained a (ah) vowel, with no played probe or external excitation.</label></div>
 <div className="scientific-actions"><button onClick={()=>void run('calibration')} disabled={busy||!voiceOnly||state.status==='loading'||state.status==='unavailable'}>{state.status==='running'?'Model jobs running…':'Fit latest iPhone capture'}</button>{r&&<button onClick={onPreview}>Preview predicted geometry</button>}<span>Model: {state.status}</span></div>
 <p role="status">{notice||state.error}</p>
 {r&&<section className="scientific-outcome" aria-label="Next recording experiment"><h4>Test the frozen prediction</h4>
 {selected?<><p>Record a new sustained <strong>{selected.pose}</strong> vowel on the iPhone, then use <strong>Pull iPhone</strong> again. Keep your setup consistent. The app compares this later recording with predictions made before hearing it.</p>
 <p>The forecast assumes jaw −3°, source pitch 180 Hz and digital gain 4. These are model settings; the app does not measure that you reproduced them.</p>
 <label><input type="checkbox" checked={outcomeConfirmed} onChange={event=>setOutcomeConfirmed(event.target.checked)} disabled={busy}/> The latest capture is a new {selected.pose} vowel recording, without played probes or external excitation.</label>
 <div className="scientific-actions"><button onClick={()=>void run('outcome')} disabled={busy||!outcomeConfirmed||state.status!=='succeeded'}>{outcome.status==='running'?'Scoring latest recording…':outcome.status==='failed'||outcome.status==='interrupted'?'Retry latest iPhone capture':'Score latest iPhone capture'}</button><span>Outcome processing: {outcome.status}</span></div></>:<p>No separating experiment was selected. There is no committed next recording to score.</p>}
 {outcome.error&&<p role="alert">{outcome.error}</p>}
 {outcome.result&&<div role="status"><p>Scientific result: <strong>{outcome.result.scientificStatus||outcome.result.status}</strong>. {outcome.result.modelUpdated?'The session model was updated from the recorded evidence.':'No model update was applied.'} This does not validate the inferred anatomy.</p>
 {outcome.result.reasons?.length? <p>Recording could not be used: {outcome.result.reasons.join('; ')}</p>:null}
 {outcome.result.error&&<p>{outcome.result.error}</p>}
 {outcome.result.missingReason&&<p>Unavailable measurement: {outcome.result.missingReason}</p>}
 {outcome.result.scores?.length?<table><thead><tr><th>Hypothesis</th><th>Standardized prediction error</th></tr></thead><tbody>{outcome.result.scores.map(score=><tr key={score.hypothesis_id}><td>{score.hypothesis_id}</td><td>{score.standardized_rms.toFixed(3)}</td></tr>)}</tbody></table>:null}
 {outcome.result.retainedHypotheses!=null&&<p>Retained hypotheses: {outcome.result.previousHypotheses??'unknown'} → {outcome.result.retainedHypotheses}.</p>}
 <p>Model lineage: {r.modelId||r.candidateId} → {outcome.result.modelId||'unchanged'}. Session: {outcome.result.sessionId||r.sessionId||'unavailable'}.</p></div>}
 </section>}
 {r&&<><p><strong>Actual native run:</strong> {r.nativeCalls} calls · {r.calibrationWindows} voice windows · {r.jobs.map(j=>j.operation).join(' → ')}. Source capture {r.sourceCaptureId?.slice(0,8)||'retained in import receipt'}.</p><p>Candidate discrepancy {r.fitDiscrepancy.toFixed(3)}; fixed-anatomy comparison {r.baselineDiscrepancy==null?'Unavailable':r.baselineDiscrepancy.toFixed(3)}. Lower discrepancy here does not establish correct anatomy.</p><table><thead><tr><th>Predicted vowel</th><th>Hypothesis</th><th>Pitch</th><th>Brightness (centroid)</th><th>Loudness</th></tr></thead><tbody>{r.forecast.rankings.flatMap(rank=>rank.predictions.map((p,i)=>{const m=p.canonical?.measurement.measurements??[];const value=(name:string)=>{const x=m.find(v=>v.name===name);return x?.value==null?'Unavailable':`${x.value.toFixed(1)} ${x.unit}`};return <tr key={`${rank.experiment.pose}-${i}`}><td>{rank.experiment.pose}</td><td>{p.hypothesis_id}</td><td>{value('pitchHz')}</td><td>{value('centroidHz')}</td><td>{value('dbfs')}</td></tr>}))}</tbody></table><p>{r.forecastRole} Conditions: jaw −3°, source pitch 180 Hz, digital gain 4. {r.forecast.selected_experiment_id?`Largest useful candidate separation: ${r.forecast.selected_experiment_id}.`:'No separating next experiment found.'}</p><details><summary>Geometry parameters and retained evidence</summary><table><thead><tr><th>Parameter</th><th>Candidate</th><th>Reference</th></tr></thead><tbody>{Object.entries(r.anatomy).map(([k,v])=><tr key={k}><td>{k}</td><td>{v.toFixed(3)}</td><td>{r.referenceAnatomy[k]?.toFixed(3)}</td></tr>)}</tbody></table><p>{r.interpretation} These parameters describe the vocal-tract model; they do not measure shoulder muscles, muscle tension or hidden tissue.</p><a href={scienceAsset(r.runId,'fit.json')} target="_blank" rel="noreferrer">Full fit</a> · <a href={scienceAsset(r.runId,'forecast.json')} target="_blank" rel="noreferrer">Frozen forecasts</a></details></>}</section>
}
