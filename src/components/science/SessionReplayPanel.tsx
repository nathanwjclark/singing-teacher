import {useEffect,useState} from 'react';
import {readSessionReplay,sessionReplayJson} from './sessionReplayClient';
import type {SessionReplayExport} from './sessionReplayClient';
import './SessionReplayPanel.css';

export default function SessionReplayPanel(){
 const [record,setRecord]=useState<SessionReplayExport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  void readSessionReplay(controller.signal).then(value=>{if(active){setRecord(value);setError('')}}).catch(reason=>{if(active){setRecord(null);setError(String(reason))}}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false;controller.abort()};
 },[refresh]);
 function reload(){setLoading(true);setError('');setRefresh(value=>value+1)}
 function download(){
  if(!record)return;
  const url=URL.createObjectURL(new Blob([sessionReplayJson(record)],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='tractstar-session-replay.json';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="session-replay" aria-label="Scientific session replay">
  <h3>Scientific session replay</h3>
  <p>Inspect the current server session, its model history, recorded decisions and scored attempts. Download retains the returned evidence and explicitly lists missing sources.</p>
  <div className="session-replay-actions"><button type="button" onClick={reload} disabled={loading}>{loading?'Loading session…':'Refresh session replay'}</button><button type="button" onClick={download} disabled={loading||!record}>Download session replay JSON</button></div>
  {error&&<p role="alert">{error}</p>}
  {record&&<>
   <p role="status">Export: <strong>{record.status}</strong> · <time dateTime={record.exportedAt}>{new Date(record.exportedAt).toLocaleString()}</time>. Refresh after new experiments to update this snapshot.</p>
   <dl><dt>Session</dt><dd>{record.sessionId}</dd><dt>Run</dt><dd>{record.runId}</dd><dt>Current model</dt><dd>{record.summary.modelId||'Unavailable'}</dd><dt>Session version</dt><dd>{record.summary.sessionVersion??'Unavailable'}</dd></dl>
   <p>{record.summary.eventCount} session events · {record.summary.decisionCount} decisions · {record.summary.attemptCount} attempts · {record.summary.scoreCount} scores · {record.summary.probeFitCount} probe fits.</p>
   {!record.replay&&<p>The worker ledger is unavailable in this export. Available saved artifacts remain included.</p>}
   {record.missing.length>0&&<div><h4>Missing sources</h4><ul>{record.missing.map((item,index)=><li key={index}>{item.source}: {item.reason}</li>)}</ul></div>}
   <details><summary>Included evidence and export omissions</summary>
    {record.artifacts.length?<ul>{record.artifacts.map((artifact,index)=><li key={index}>{artifact.source} · {artifact.byteLength} bytes · SHA-256 {artifact.sha256}</li>)}</ul>:<p>No saved artifacts were available.</p>}
    {record.omissions.length>0&&<ul>{record.omissions.map((item,index)=><li key={index}>Omitted {item.path}: {item.reason}</li>)}</ul>}
    <p>Original worker ledger SHA-256: {record.workerLedgerSha256||'Unavailable'}.</p>
   </details>
  </>}
  <p>This inspection export excludes raw media and secret fields. Re-synthesis requires original media and the scientific environment. It does not validate anatomical accuracy.</p>
 </section>;
}
