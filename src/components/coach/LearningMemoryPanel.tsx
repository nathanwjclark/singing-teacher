import {useEffect,useRef,useState} from 'react';
import {readLearningMemory,saveLearningSensation} from './learningMemoryClient';
import type {LearningMemory} from './learningMemoryClient';
import './LearningMemoryPanel.css';

export default function LearningMemoryPanel(){
 const [memory,setMemory]=useState<LearningMemory|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [text,setText]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const generation=useRef(0);
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function load(){
   const version=generation.current;
   try{const result=await readLearningMemory(controller.signal);if(active&&generation.current===version){setMemory(result);setError('')}}
   catch(reason){if(active&&generation.current===version){setMemory(null);setError(String(reason))}}
   finally{if(active){setLoading(false);timer=setTimeout(()=>void load(),5000)}}
  }
  void load();return()=>{active=false;controller.abort();clearTimeout(timer)};
 },[refresh]);
 async function save(){
  if(!text.trim()||saving)return;
  generation.current++;setSaving(true);setNotice('');
  try{const result=await saveLearningSensation(text.trim());setMemory(result);setError('');setText('');setNotice('Saved to the latest completed recording attempt. Your report remains subjective.')}
  catch(reason){setNotice(String(reason))}
  finally{generation.current++;setSaving(false);setRefresh(value=>value+1)}
 }
 return <section className="learning-memory" aria-label="Personal cue memory">
  <h3>Personal cue memory</h3>
  <p>After a recording has been scored, describe what you felt and the words that may help you remember it. Reports attach to the latest completed recorded outcome in this session.</p>
  <p>These are your subjective sensations, not measurements of anatomy or evidence that a cue works.</p>
  {loading&&<p role="status">Loading personal memory…</p>}
  {error&&<div role="status"><p>Memory is not ready. Complete a model run and score a recording first.</p><p>{error}</p><button type="button" onClick={()=>setRefresh(value=>value+1)}>Refresh memory</button></div>}
  <form onSubmit={event=>{event.preventDefault();void save()}}>
   <label htmlFor="learning-memory-sensation">Your sensation or reminder, in your own words</label>
   <textarea id="learning-memory-sensation" maxLength={2000} rows={3} value={text} disabled={saving} onChange={event=>setText(event.target.value)}/>
   <div className="learning-memory-actions"><button type="submit" disabled={!memory||loading||saving||!text.trim()}>{saving?'Saving report…':'Save sensation for latest outcome'}</button><span>{text.length}/2000</span></div>
  </form>
  {notice&&<p role="status">{notice}</p>}
  {memory&&<><p>{memory.entries.length} saved reports in this session.</p>
   {memory.entries.length===0?<p>No sensations saved yet.</p>:<ol>{[...memory.entries].reverse().map(entry=><li key={entry.id}>
    <p className="learning-memory-report">{entry.text}</p>
    <p>Subjective report · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></p>
    <p>{entry.cue?<>Associated Astra cue: {entry.cue}</>:'No matching Astra cue was recorded for this attempt.'}</p>
    <details><summary>Linked recording and model</summary><dl>
     <dt>Attempt</dt><dd>{entry.attemptId}</dd><dt>Model</dt><dd>{entry.modelId}</dd>
     <dt>Run</dt><dd>{entry.runId}</dd><dt>Design</dt><dd>{entry.designId}</dd>
     <dt>Astra decision</dt><dd>{entry.decisionId||'None linked'}</dd>
    </dl></details>
   </li>)}</ol>}
  </>}
 </section>;
}
