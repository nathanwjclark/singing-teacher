import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackingFrame } from '../../types'
import type { MotionObservation, MotionMarker } from '../../contracts/learning'
import { validateLearningRecord } from '../../contracts/learning'
import { motionSample, observedEnvelope, phaseAt, motionMediaBinding, verifyMotionMedia } from '../../capture/motion'
import {importMotionCapture,readMotionStatus,motionAssetUrl,readMotionAnalysis,analyzeMotionAudio,rankMotionCandidates} from './motionClient'
import type {SavedMotionStatus,MotionAnalysisStatus,MotionVowel} from './motionClient'
import './MotionCapturePanel.css'
const save=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function MotionCapturePanel({frame,videoStream,audioStream}:{frame:TrackingFrame|null;videoStream?:MediaStream|null;audioStream?:MediaStream|null}){
 const [finalizing,setFinalizing]=useState(false),[verifying,setVerifying]=useState(false),[active,setActive]=useState(false),[elapsed,setElapsed]=useState(0),[record,setRecord]=useState<MotionObservation|null>(null),[index,setIndex]=useState(0),[media,setMedia]=useState<Blob|null>(null),[mediaUrl,setMediaUrl]=useState(''),[error,setError]=useState(''),[gesture,setGesture]=useState('Comfortable ah, then relax'),[context,setContext]=useState('seated; comfortable effort'),[count,setCount]=useState(0)
 const [recordBytes,setRecordBytes]=useState<Blob|null>(null),[saving,setSaving]=useState(false),[saved,setSaved]=useState<SavedMotionStatus|null>(null),[saveNotice,setSaveNotice]=useState('')
 const [analysisPose,setAnalysisPose]=useState<MotionVowel>('a'),[confirmedAnalysis,setConfirmedAnalysis]=useState(''),[analysisStarting,setAnalysisStarting]=useState(false),[analysisRefresh,setAnalysisRefresh]=useState(0),[analysisError,setAnalysisError]=useState('');
 const [analysisEntry,setAnalysisEntry]=useState<{captureId:string;value:MotionAnalysisStatus}|null>(null);
 const mounted=useRef(true), stopping=useRef(false), removeTrackListeners=useRef<()=>void>(()=>{}), importGeneration=useRef(0)
 const analysisRequest=useRef<{key:string;id:string}|null>(null);
 const captureId=saved?.capture?.id,analysis=analysisEntry?.captureId===captureId?analysisEntry?.value:null;
 const analysisKey=captureId+':'+analysisPose,analysisBusy=analysisStarting||analysis?.status==='running';
 useEffect(()=>{
  if(!captureId)return;
  const controller=new AbortController();let current=true,timer:ReturnType<typeof setTimeout>;
  async function load(){try{const value=await readMotionAnalysis(captureId!,controller.signal);if(current){setAnalysisEntry({captureId:captureId!,value});setAnalysisError('');if(value.status==='running')timer=setTimeout(()=>void load(),2000)}}catch(cause){if(current)setAnalysisError(String(cause))}}
  void load();return()=>{current=false;controller.abort();clearTimeout(timer)};
 },[captureId,analysisRefresh]);
 async function analyze(){
  if(!captureId||analysisBusy||confirmedAnalysis!==analysisKey)return;
  const key=analysisKey;
  if(analysisRequest.current?.key!==key)analysisRequest.current={key,id:crypto.randomUUID()};
  setAnalysisStarting(true);setAnalysisError('');
  try{await analyzeMotionAudio(captureId,analysisPose,analysisRequest.current.id);if(mounted.current){setConfirmedAnalysis('');setAnalysisRefresh(value=>value+1)}}
  catch(cause){if(mounted.current)setAnalysisError(String(cause))}
  finally{if(mounted.current)setAnalysisStarting(false)}
 }
 const draft=useRef<MotionObservation|null>(null),recorder=useRef<MediaRecorder|null>(null),player=useRef<HTMLVideoElement|null>(null)
 useEffect(()=>{let current=true;void readMotionStatus().then(value=>{if(current)setSaved(value)}).catch(cause=>{if(current)setSaveNotice(String(cause))});return()=>{current=false}},[])
 const finish=useCallback((stopped=false,note?:string)=>{
  const current=draft.current;if(!current||stopping.current)return
  stopping.current=true
  const t=performance.now()-current.timebase.originMs,phase=phaseAt(t)
  current.markers.push({captureMs:t,repetition:phase.repetition,phase:phase.phase,type:stopped?'stop':'task-end',source:note?'protocol':stopped?'user':'protocol',note:note??(stopped?'Stopped early; retain incomplete attempt':'Capture ended')})
  current.observedEnvelope=observedEnvelope(current.samples)
  draft.current=null;setActive(false);setFinalizing(true);setIndex(0)
  if(recorder.current?.state==='recording')recorder.current.stop()
 },[])
 useEffect(()=>{if(!active)return;const timer=window.setInterval(()=>{const current=draft.current;if(!current)return;const lost=recorder.current?.stream.getTracks().find(track=>track.readyState==='ended'||track.muted);if(lost){finish(true,`${lost.kind} track ${lost.readyState==='ended'?'ended':'muted'}; incomplete attempt retained`);return}const t=performance.now()-current.timebase.originMs;setElapsed(t);const p=phaseAt(t);if(p.done){finish();return}const prior=current.markers.filter(m=>m.type==='phase').at(-1);if(!prior||prior.phase!==p.phase||prior.repetition!==p.repetition)current.markers.push({captureMs:t,repetition:p.repetition,phase:p.phase,type:'phase',source:'protocol',note:p.phase==='gesture'?gesture:p.phase==='return'?'Return comfortably':'Neutral baseline'})},50);return()=>clearInterval(timer)},[active,gesture,finish])
 useEffect(()=>{const current=draft.current;if(!current||!frame||frame.timestamp<current.timebase.originMs)return;const previous=current.samples.at(-1);if(previous&&frame.timestamp<=previous.sourceTimestampMs)return;const p=phaseAt(frame.timestamp-current.timebase.originMs);if(p.done)return;current.samples.push(motionSample(frame,current.timebase.originMs,p.repetition,p.phase,previous?.sourceTimestampMs));setCount(current.samples.length)},[frame])
 const releaseCapture=useCallback(()=>{
  mounted.current=false;importGeneration.current++;draft.current=null;removeTrackListeners.current()
  const capture=recorder.current;recorder.current=null
  if(capture?.state==='recording')capture.stop()
 },[])
 useEffect(()=>{mounted.current=true;return releaseCapture},[releaseCapture])
 useEffect(()=>()=>{if(mediaUrl)URL.revokeObjectURL(mediaUrl)},[mediaUrl])
 const start=()=>{
  if(recorder.current||verifying)return
  importGeneration.current++;stopping.current=false
  if(!videoStream?.getVideoTracks().some(t=>t.readyState==='live')){setError('Start the camera before capturing real motion. Demo frames are not captured.');return}
  setError('');setRecordBytes(null);setSaveNotice('');setMedia(null);setMediaUrl('');setRecord(null);setElapsed(0);setCount(0)
  const now=performance.now(),id=crypto.randomUUID()
  const next:MotionObservation={schemaVersion:'1.0.0',kind:'motion-observation',id,createdAt:new Date().toISOString(),provenance:{kind:'derived-measurement',producer:'browser-motion-capture',producerVersion:'1.0.0',sourceIds:[id+'-camera'],sourceHashes:[]},attemptId:id,cueId:'user-selected-visible-gesture',cueVersion:'1',context:{gesture,description:context},samples:[],markers:[{captureMs:0,repetition:1,phase:'neutral',type:'task-start',source:'protocol',note:'Three comfortable neutral → gesture → return repetitions'},{captureMs:0,repetition:1,phase:'neutral',type:'cue-delivery',source:'protocol',note:gesture}],coordinateFrame:'normalized-image-and-outer-eye-relative-2d',timebase:{clock:'browser-performance',originMs:now,syncUncertaintyMs:null},visibility:'Per-point visibility; absent callbacks appear as timing gaps. Hidden surfaces are unobserved.',uncertainty:'unquantified-image-estimates',observedEnvelope:[],media:null,missing:{depth:'not-supported',internalGeometry:'not-observed',calibratedHeadPose:'not-captured'},interpretation:'observed-visible-motion-not-anatomical-limits'}
  try{
   const tracks=[...videoStream.getVideoTracks(),...(audioStream?.getAudioTracks()??videoStream.getAudioTracks())].filter(t=>t.readyState==='live')
   if(tracks.some(track=>track.muted))throw new Error('A camera or microphone track is muted; reconnect it before capturing')
   const stream=new MediaStream([...new Set(tracks)]),mimeType=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type))
   const capture=new MediaRecorder(stream,mimeType?{mimeType}:undefined),chunks:BlobPart[]=[]
   capture.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
   capture.onstop=async()=>{
    if(recorder.current!==capture||!mounted.current)return
    if(!stopping.current)finish(true,'Recorder stopped unexpectedly; incomplete attempt retained')
    removeTrackListeners.current()
    const blob=new Blob(chunks,{type:capture.mimeType})
    try{
     const binding=await motionMediaBinding(blob)
     if(recorder.current!==capture||!mounted.current)return
     next.media={...next.media!,...binding};next.provenance.sourceHashes=[binding.sha256]
     setRecord(structuredClone(next));setRecordBytes(new Blob([JSON.stringify(next,null,2)],{type:'application/json'}));setMedia(blob);setMediaUrl(URL.createObjectURL(blob))
    }catch(cause){
     if(recorder.current!==capture||!mounted.current)return
     next.media=null;setRecord(structuredClone(next));setError(`Motion retained without valid media: ${String(cause)}`)
    }finally{if(recorder.current===capture&&mounted.current){recorder.current=null;setFinalizing(false)}}
   }
   capture.onerror=()=>{if(recorder.current===capture){setError('Media recording failed. Captured motion observations are retained.');finish(true,'MediaRecorder error; incomplete attempt retained')}}
   const ended=(event:Event)=>{if(recorder.current===capture)finish(true,`${(event.target as MediaStreamTrack).kind} track ${event.type}; incomplete attempt retained`)}
   tracks.forEach(track=>{track.addEventListener('ended',ended);track.addEventListener('mute',ended)})
   removeTrackListeners.current=()=>tracks.forEach(track=>{track.removeEventListener('ended',ended);track.removeEventListener('mute',ended)})
   next.media={filename:`motion-${id}.${capture.mimeType.includes('mp4')?'mp4':'webm'}`,mimeType:capture.mimeType||mimeType||'application/octet-stream',startedAtMs:performance.now()-now,syncUncertaintyMs:null}
   capture.start(250);recorder.current=capture
  }catch(e){removeTrackListeners.current();setError(`Could not start media recording: ${String(e)}`);return}
  draft.current=next;setActive(true)
 }
 const mark=(type:MotionMarker['type'],note:string)=>{const current=draft.current;if(!current)return;const t=performance.now()-current.timebase.originMs,p=phaseAt(t);current.markers.push({captureMs:t,repetition:p.repetition,phase:p.phase,type,source:'user',note});setCount(current.samples.length)}
 const selected=record?.samples[index],p=phaseAt(elapsed),busy=active||finalizing||verifying||saving
 const seek=(i:number)=>{setIndex(i);const ms=record?.samples[i]?.captureMs;if(player.current&&ms!==undefined)player.current.currentTime=Math.max(0,(ms-(record?.media?.startedAtMs??0))/1000)}
 async function saveToApp(){
  if(!record||!recordBytes||!media||busy)return
  setSaving(true);setSaveNotice('')
  try{await verifyMotionMedia(record.media,media);const receipt=await importMotionCapture(recordBytes,media,record.media!.filename);if(mounted.current){setSaved({busy:false,capture:receipt.capture,record});setSaveNotice('Motion and verified video saved locally. No anatomical fitting was performed.')}}
  catch(cause){if(mounted.current)setSaveNotice('Save failed; local replay and export are still available. '+String(cause))}
  finally{if(mounted.current)setSaving(false)}
 }
 const exportCapture=()=>{if(!record||busy)return;const checked=validateLearningRecord(record);if(!checked.valid){setError(checked.errors.join('; '));return}save(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),`motion-${record.id}.json`);if(media&&record.media)save(media,record.media.filename)}
 return <section className="motion-capture"><h3>Visible motion · neutral → gesture → return</h3><p>Record three comfortable repetitions (21 seconds). Keep your head comfortable and still. Stop for discomfort. This records camera and available microphone only when you press Start.</p><div className="motion-controls"><label>Gesture <select disabled={busy} value={gesture} onChange={e=>setGesture(e.target.value)}><option>Comfortable ah, then relax</option><option>Easy ee to oo, then relax</option><option>Comfortably expose tongue, then return</option></select></label><label>Context <input disabled={busy} value={context} onChange={e=>setContext(e.target.value)} /></label><button disabled={busy} onClick={start}>Start 3 repetitions</button><button disabled={!active||finalizing} onClick={()=>finish(true)}>Stop capture</button><label>Replay JSON <input disabled={busy} type="file" accept="application/json,.json" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const generation=++importGeneration.current;setVerifying(true);try{const loaded:unknown=JSON.parse(await file.text());if(!mounted.current||generation!==importGeneration.current)return;const checked=validateLearningRecord(loaded);if(!checked.valid||!loaded||typeof loaded!=='object'||!('kind' in loaded)||loaded.kind!=='motion-observation')throw new Error(checked.errors.join('; ')||'Choose a motion-observation export');setRecord(loaded as MotionObservation);setRecordBytes(file);setSaveNotice('');setIndex(0);setMedia(null);setMediaUrl('');setError('')}catch(err){if(mounted.current&&generation===importGeneration.current)setError(String(err))}finally{if(mounted.current&&generation===importGeneration.current)setVerifying(false)}}}/></label><label>Replay companion video <input disabled={busy} type="file" accept="video/*" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const generation=++importGeneration.current;setMedia(null);setMediaUrl('');setVerifying(true);try{await verifyMotionMedia(record?.media??null,file);if(!mounted.current||generation!==importGeneration.current)return;setMedia(file);setMediaUrl(URL.createObjectURL(file));setError('')}catch(cause){if(mounted.current&&generation===importGeneration.current)setError(String(cause))}finally{if(mounted.current&&generation===importGeneration.current)setVerifying(false)}}}/></label></div>{finalizing&&<p role="status">Finalizing video and verifying its bytes…</p>}{verifying&&<p role="status">Verifying companion video…</p>}{error&&<p role="alert">{error}</p>}
 {active&&<div aria-live="polite"><strong>Repetition {p.repetition}/3 · {p.phase.toUpperCase()} · {(elapsed/1000).toFixed(1)}s</strong><p>{p.phase==='gesture'?gesture:p.phase==='return'?'Return comfortably to neutral':'Rest at neutral'}</p><span>{count} measured frames</span><div className="motion-controls"><button onClick={()=>mark('observed-onset','Learner marked gesture onset')}>Mark actual onset</button><button onClick={()=>mark('observed-return','Learner marked return')}>Mark actual return</button><button onClick={()=>mark('unsuccessful','Learner reports unsuccessful attempt')}>Mark unsuccessful</button></div><small>Markers are your observations; timed prompts do not prove the movement happened.</small></div>}
 {record&&<div><button disabled={busy} onClick={exportCapture}>Export motion JSON + video</button><button disabled={busy||!media||!recordBytes} onClick={()=>void saveToApp()}>{saving?'Saving verified motion…':'Save motion to app'}</button><p>{record.samples.length} frames · {record.markers.filter(m=>m.type==='unsuccessful').length} reported unsuccessful attempts · {record.samples.filter(s=>s.gapBefore).length} timing gaps. Save to the app or export before leaving this page.</p>{record.media&&!record.media.sha256&&<p>Legacy motion JSON: video integrity was not recorded. Landmark replay is available; companion video cannot be verified.</p>}{mediaUrl&&<p>Companion video verified by SHA-256 and byte length.</p>}{mediaUrl&&<video ref={player} src={mediaUrl} controls playsInline onTimeUpdate={e=>{const t=e.currentTarget.currentTime*1000+(record.media?.startedAtMs??0);let i=record.samples.findIndex(s=>s.captureMs>=t);if(i<0)i=record.samples.length-1;if(i>=0)setIndex(i)}}/>}{record.samples.length>0&&<><label>Replay measured frame <input type="range" min="0" max={record.samples.length-1} value={index} onChange={e=>seek(Number(e.target.value))}/></label><p>{selected?.captureMs.toFixed(0)}ms · repetition {selected?.repetition} · {selected?.phase}{selected?.gapBefore?' · GAP BEFORE FRAME':''}</p><svg viewBox="-1 -1 2 2" role="img" aria-label="Head-relative visible landmark replay"><path d="M -1 0 H 1 M 0 -1 V 1" stroke="#425364" strokeWidth=".01"/>{selected?.points.filter(point=>point.headRelative).map(point=><g key={point.name}><circle cx={point.headRelative![0]} cy={point.headRelative![1]} r=".025" fill={point.name==='tongue_tip'?'#fb92ba':'#70e5d0'}/><text x={point.headRelative![0]+.03} y={point.headRelative![1]} fontSize=".055" fill="white">{point.name}</text></g>)}</svg><p>{selected?.points.map(point=>`${point.name}: ${point.reason??point.visibility}`).join(' · ')}</p></>}<details><summary>Timing and visibility markers</summary><ul>{record.markers.map((m,i)=><li key={i}>{(m.captureMs/1000).toFixed(2)}s · repeat {m.repetition} · {m.type} · {m.note} ({m.source})</li>)}</ul></details></div>}
 {saveNotice&&<p role="status">{saveNotice}</p>}
 {saved?.capture&&<div><h4>Latest motion saved in the app</h4><p>{saved.capture.sampleCount} frames · {saved.capture.timingGaps} timing gaps · {saved.capture.unsuccessfulMarkers} unsuccessful markers. Original JSON and media bytes verified.</p><p>Retained as visible 2D evidence; not included in a physical fit. Media synchronization uncertainty remains unknown.</p><a href={motionAssetUrl(saved.capture.id,'record')}>Download saved motion JSON</a> · <a href={motionAssetUrl(saved.capture.id,'media')}>Download saved video</a></div>}
 {saved?.capture&&<fieldset><legend>Motion audio analysis</legend>
 <p>Compare audio windows with the retained anatomy hypotheses using a declared vowel. This does not fit the visible 2D motion or infer synchronized depth, and does not change the baseline model.</p>
 <label>Vowel recorded throughout the analyzed audio <select disabled={analysisBusy} value={analysisPose} onChange={event=>setAnalysisPose(event.target.value as MotionVowel)}><option value="a">a (ah)</option><option value="e">e (eh)</option><option value="i">i (ee)</option><option value="o">o (oh)</option><option value="u">u (oo)</option></select></label>
 <label><input type="checkbox" checked={confirmedAnalysis===analysisKey} disabled={analysisBusy} onChange={event=>setConfirmedAnalysis(event.target.checked?analysisKey:'')}/> This saved audio contains my declared vowel with no external sound or played probe.</label>
 <button type="button" onClick={()=>void analyze()} disabled={analysisBusy||confirmedAnalysis!==analysisKey||analysis?.availability.available===false}>{analysisBusy?'Analyzing saved audio…':'Analyze saved audio once'}</button>
 <button type="button" disabled={analysisBusy} onClick={()=>setAnalysisRefresh(value=>value+1)}>Refresh audio analysis status</button>
 {analysis&&<p role="status">Analysis: {analysis.status}. {analysis.availability.available?'':analysis.availability.reason}</p>}
 {analysisError&&<p role="alert">{analysisError} Saved motion replay and downloads remain available.</p>}
 {analysis?.error&&<p role="alert">{analysis.error}</p>}
 {analysis?.result&&<div>{!analysis.resultCurrent&&<p><strong>Historical analysis:</strong> these results use an earlier model, not the current baseline {analysis.currentModelId||'(unavailable)'}.</p>}<p>Numerical result: {analysis.result.status} · declared vowel {analysis.result.pose} · {analysis.result.actualSynthesisCalls} synthesis calls. Baseline model unchanged; visual synchronization unknown.</p>
 <p>Used {analysis.result.hypothesisSubset.selectedIds.length} of {analysis.result.hypothesisSubset.totalRetained} retained anatomy hypotheses. Selection: {analysis.result.hypothesisSubset.selection}.</p>
 <details><summary>Model subset and fixed simulation assumptions</summary><p>Session: {analysis.result.sessionId} · Model: {analysis.result.modelId}</p><p>{analysis.result.hypothesisSubset.selectedIds.join(', ')}</p><ul>{analysis.result.assumptions.map((assumption,i)=><li key={i}>{assumption}</li>)}</ul></details>
 {analysis.result.windows.map(window=><details key={window.index}><summary>Window {window.index+1} · sample {window.startSample} · {window.status}</summary>{window.reason&&<p>{window.reason}</p>}{window.fit?.joint.candidates.length?<table><thead><tr><th>Ranked hypothesis</th><th>Weighted mean-square discrepancy</th></tr></thead><tbody>{rankMotionCandidates(window.fit.joint.candidates).map(candidate=><tr key={candidate.candidate_id}><td>{candidate.candidate_id}</td><td>{candidate.weighted_mean_square_discrepancy==null?`Unavailable: ${candidate.status}. ${candidate.missing_features?.map(m=>m.reason).join('; ')||''}`:candidate.weighted_mean_square_discrepancy.toFixed(3)}</td></tr>)}</tbody></table>:<p>No numerical hypothesis scores are available for this window.</p>}</details>)}
 </div>}
 </fieldset>}
 <small>Eye-relative 2D coordinates remove approximate image translation, scale and roll. Yaw, perspective and reference movement can remain. These are uncalibrated visible estimates, not millimeters, internal muscle motion or anatomical limits. Media alignment uncertainty is unknown; this export cannot enter calibrated depth fitting.</small></section>
}
