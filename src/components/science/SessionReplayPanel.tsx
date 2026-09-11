import {useEffect,useState} from 'react';
import {readSessionReplay,sessionReplayJson,readSessionRecomputation,startSessionRecomputation} from './sessionReplayClient';
import type {SessionReplayExport,SessionRecomputationStatus,SessionRecomputationOperation} from './sessionReplayClient';
import './SessionReplayPanel.css';

const outcomeLabel={matched:'Matched',failed:'Failed',unavailable:'Unavailable',unsupported:'Unsupported',skipped:'Skipped (budget)'};
const codeLabel={verified:'Pinned code matches',legacy_version_unverified:'No pin (legacy); not verified',unverified:'Not verified'};
const agreementLabel=(row:SessionRecomputationOperation)=>row.numericalAgreement===null?'Not compared':row.numericalAgreement?'Agrees':'Differs';

export default function SessionReplayPanel(){
 const [verification,setVerification]=useState<SessionRecomputationStatus|null>(null),[verificationError,setVerificationError]=useState(''),[starting,setStarting]=useState(false);
 const [record,setRecord]=useState<SessionReplayExport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  void readSessionReplay(controller.signal).then(value=>{if(active){setRecord(value);setError('')}}).catch(reason=>{if(active){setRecord(null);setError(String(reason))}}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false;controller.abort()};
 },[refresh]);
 useEffect(()=>{
  const controller=new AbortController();let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
  async function poll(){try{const value=await readSessionRecomputation(controller.signal);if(active){setVerification(value);setVerificationError('');if(value.status==='running')timer=setTimeout(poll,2000);}}catch(reason){if(active)setVerificationError(String(reason));}}
  void poll();return()=>{active=false;controller.abort();if(timer)clearTimeout(timer);};
 },[refresh]);
 async function verify(){
  setStarting(true);setVerificationError('');
  try{setVerification(await startSessionRecomputation('replay-'+crypto.randomUUID()));setRefresh(value=>value+1);}
  catch(reason){setVerificationError(String(reason));setRefresh(value=>value+1);}finally{setStarting(false);}
 }
 function downloadVerification(){
  if(!verification?.report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(verification.report,null,2)+'\n'],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='tractstar-score-verification.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
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
  <div className="session-recomputation" aria-label="Numerical score verification">
   <h4>Recompute retained scores</h4>
   <p>Check up to the latest 16 PCM, visual and source scoring operations against their recorded results. This uses retained inputs locally, makes no model updates, and performs no synthesis.</p>
   <div className="session-replay-actions"><button type="button" onClick={()=>void verify()} disabled={starting||verification?.status==='running'||!record}>{starting||verification?.status==='running'?'Recomputing scores…':'Recompute retained scores'}</button><button type="button" onClick={downloadVerification} disabled={!verification?.report}>Download verification report</button></div>
   {verificationError&&<p role="alert">{verificationError}</p>}
   {verification&&<p role="status">Numerical verification: <strong>{verification.status}</strong>{verification.reason?'. '+verification.reason:''}</p>}
   {verification?.report&&<>
    <p>Of {verification.report.counts.total} retained operations: {verification.report.counts.matched} matched · {verification.report.counts.failed} failed · {verification.report.counts.unavailable} unavailable · {verification.report.counts.unsupported} unsupported · {verification.report.counts.skipped} skipped by budget.</p>
    <p>Matched with pinned scoring code: {verification.report.counts.policyVerified}. Matched without a scoring-code pin (legacy, not verified): {verification.report.counts.legacyVersionUnverified}.</p>
    <p>Failed means the recomputed score differs or the retained evidence is inconsistent. Unavailable means the original score, frame or receipt is missing; nothing is reconstructed. Unsupported means the operation is not a score, or its frozen scoring code or runtime differs from this one.</p>
    <p>Results refer to the captured ledger {verification.report.workerLedgerSha256}. New experiments require another verification.</p>
    <div className="session-replay-table"><table><caption>Each retained operation and its verification outcome</caption><thead><tr><th>Operation</th><th>Outcome</th><th>Agreement</th><th>Scoring code</th></tr></thead><tbody>{verification.report.operations.map(row=><tr key={row.jobId}><td><details><summary>{row.operation}</summary>{row.jobId}<p>{row.status}: {row.reason||'Numerical comparison completed.'}</p></details></td><td>{outcomeLabel[row.outcome]}</td><td>{agreementLabel(row)}</td><td>{codeLabel[row.policyVerification]}</td></tr>)}</tbody></table></div>
    <p>{verification.report.budget.canonicalExtractions} canonical extractions · 0 synthesis calls · 0 geometry calls.</p>
    <ul>{verification.report.limitations.map(item=><li key={item}>{item}</li>)}</ul>
   </>}
  </div>
  <p>This inspection export excludes raw media and secret fields. Re-synthesis requires original media and the scientific environment. It does not validate anatomical accuracy.</p>
 </section>;
}
