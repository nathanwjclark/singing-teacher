import {useEffect,useRef,useState} from 'react';
import {indexVisualFrames,parseVisualCamera,readVisualStatus,visualRequest} from './visualClient';
import type {VisualAnnotation,VisualFrameIndex,VisualPixel,VisualStatus,VisualFrame} from './visualClient';
import {VisualFramePicker} from './VisualFramePicker';
import './VisualLikelihoodPanel.css';

export function VisualLikelihoodPanel(){
 const [status,setStatus]=useState<VisualStatus|null>(null),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selectedCapture,setSelectedCapture]=useState(''),[frames,setFrames]=useState<VisualFrameIndex|null>(null),[calibrationIndex,setCalibrationIndex]=useState(0),[targetIndex,setTargetIndex]=useState(1);
 const [upper,setUpper]=useState<VisualPixel|null>(null),[lower,setLower]=useState<VisualPixel|null>(null),[visibility,setVisibility]=useState<VisualAnnotation['visibility']>('visible');
 const [targetUpper,setTargetUpper]=useState<VisualPixel|null>(null),[targetLower,setTargetLower]=useState<VisualPixel|null>(null),[targetVisibility,setTargetVisibility]=useState<VisualAnnotation['visibility']>('visible');
 const [pose,setPose]=useState('a'),[jaw,setJaw]=useState('-3'),[tolerance,setTolerance]=useState(''),[declared,setDeclared]=useState(false),[scoreDeclared,setScoreDeclared]=useState(false);
 const [cameras,setCameras]=useState([{id:'camera-1',rotation:'1 0 0\n0 1 0\n0 0 1',scale:''}]);
 const [selectedForecast,setSelectedForecast]=useState('');
 const [targetFrame,setTargetFrame]=useState<{forecastId:string;captureId:string;frame:VisualFrame}|null>(null);
 const scoreIdentity=useRef<{key:string;id:string}|null>(null);
 const identity=useRef<{key:string;requestId:string;forecastId:string}|null>(null);
 const captureId=selectedCapture||status?.captures[0]?.captureId||'',index=frames?.captureId===captureId?frames:null;
 const forecastId=selectedForecast||status?.latestResult?.forecastId||Object.keys(status?.visualForecasts??{}).at(-1)||'';
 const forecast=status?.visualForecasts?.[forecastId],working=busy||!!status?.busy;
 useEffect(()=>{const controller=new AbortController();let active=true,timer:ReturnType<typeof setTimeout>;
  async function load(){try{const value=await readVisualStatus(controller.signal);if(active){setStatus(value);if(value.busy)timer=setTimeout(()=>void load(),2000)}}catch(reason){if(active)setError(String(reason))}}
  void load();return()=>{active=false;controller.abort();clearTimeout(timer)};
 },[refresh]);
 async function loadFrames(){setBusy(true);setError('');try{const value=await indexVisualFrames(captureId);setFrames(value);setCalibrationIndex(value.frames[0]?.frameIndex??0);setTargetIndex(value.frames[1]?.frameIndex??1);setUpper(null);setLower(null);setTargetUpper(null);setTargetLower(null);setDeclared(false);setScoreDeclared(false)}catch(reason){setError(String(reason))}finally{setBusy(false)}}
 function calibration():VisualAnnotation{
  const assumedJA=Number(jaw);if(!jaw.trim()||!Number.isFinite(assumedJA))throw Error('Declare a finite assumed jaw angle');
  if(visibility==='visible'&&(!upper||!lower))throw Error('Annotate both visible outer-lip points');
  return {frameIndex:calibrationIndex,pose,assumedJA,visibility,upperPixel:visibility==='visible'?upper:null,lowerPixel:visibility==='visible'?lower:null};
 }
 async function freeze(){
  if(!index||!declared)return;setBusy(true);setError('');
  try{
   const row=calibration(),calibrationTolerancePx=Number(tolerance);
   if(!tolerance.trim()||!Number.isFinite(calibrationTolerancePx)||calibrationTolerancePx<=0)throw Error('Declare positive calibration tolerance in pixels');
   if(targetIndex<=calibrationIndex||!index.frames.some(item=>item.frameIndex===targetIndex))throw Error('Choose an indexed target frame later than the calibration frame');
   const latest=await readVisualStatus();setStatus(latest);if(!latest.currentModelId)throw Error('Complete a voice model first');
   const body={expectedModelId:latest.currentModelId,captureId,cameraCandidates:cameras.map(item=>parseVisualCamera(item.id,item.rotation,item.scale)),calibrationFrames:[row],targets:[{frameIndex:targetIndex,pose,assumedJA:row.assumedJA}],calibrationTolerancePx,experimentalDeclaration:true};
   const key=JSON.stringify(body);if(identity.current?.key!==key)identity.current={key,requestId:crypto.randomUUID(),forecastId:'visual-'+crypto.randomUUID()};
   await visualRequest('freeze',{...body,requestId:identity.current.requestId,forecastId:identity.current.forecastId});setSelectedForecast(identity.current.forecastId);setRefresh(value=>value+1);setScoreDeclared(false);
  }catch(reason){setError(String(reason))}finally{setBusy(false)}
 }
 async function openTarget(){
  const target=forecast?.artifact.artifact.targets[0];if(!target||!forecast)return;
  setBusy(true);setError('');
  try{
   const capture=status?.captures.find(item=>item.mediaSha256===target.media_sha256);if(!capture)throw Error('Original target recording is unavailable');
   const indexed=await indexVisualFrames(capture.captureId),frame=indexed.frames.find(item=>item.frameIndex===target.video_frame_index);if(!frame)throw Error('Original target frame is unavailable');
   setTargetFrame({forecastId,captureId:capture.captureId,frame});setTargetUpper(null);setTargetLower(null);setTargetVisibility('visible');setScoreDeclared(false);
  }catch(reason){setError(String(reason))}finally{setBusy(false)}
 }
 async function score(){
  const target=forecast?.artifact.artifact.targets[0];if(!target||!targetFrame||targetFrame.forecastId!==forecastId||!scoreDeclared)return;
  setBusy(true);setError('');
  try{
   if(targetVisibility==='visible'&&(!targetUpper||!targetLower))throw Error('Annotate both visible target points or mark the frame missing/occluded');
   const body={forecastId,captureId:targetFrame.captureId,annotations:[{frameIndex:target.video_frame_index,pose:target.pose,assumedJA:target.assumed_JA,visibility:targetVisibility,upperPixel:targetVisibility==='visible'?targetUpper:null,lowerPixel:targetVisibility==='visible'?targetLower:null}],experimentalDeclaration:true};
   const key=JSON.stringify(body);if(scoreIdentity.current?.key!==key)scoreIdentity.current={key,id:crypto.randomUUID()};
   await visualRequest('score',{...body,requestId:scoreIdentity.current.id});setRefresh(value=>value+1);setScoreDeclared(false);
  }catch(reason){setError(String(reason))}finally{setBusy(false)}
 }
 return <section className="visual-likelihood" aria-label="Conditional visual likelihood"><h3>Conditional visual likelihood</h3>
  <p>Compare declared outer-lip correspondences in original recorded frames with a fixed voice model. Camera scale, rotation and jaw angle are explicit hypotheses; no eye-span scale or hidden anatomy is measured.</p>
  <div className="visual-likelihood-actions"><button disabled={working} onClick={()=>setRefresh(value=>value+1)}>Refresh visual status</button></div>
  {!status&&<p>Loading optional visual capability…</p>}{status?.enabled===false&&<p>Visual likelihood is disabled. Ordinary recording and voice modeling remain available.</p>}{working&&<p role="status">Processing visual evidence…</p>}{error&&<p role="alert">{error}</p>}{status?.error&&<p role="alert">{status.error}</p>}
  <fieldset disabled={working||status?.enabled!==true}><legend>Choose original recorded motion</legend><label>Saved motion capture<select value={captureId} onChange={event=>{setSelectedCapture(event.target.value);setFrames(null)}}>{status?.captures.map(item=><option key={item.captureId} value={item.captureId}>{item.observationId} · {item.captureId}</option>)}</select></label><button disabled={!captureId} onClick={()=>void loadFrames()}>Index original video frames</button></fieldset>
  {index&&<fieldset disabled={working||status?.enabled!==true}><legend>Calibration and frozen target</legend>
   <label>Calibration frame<select value={calibrationIndex} onChange={event=>{setCalibrationIndex(Number(event.target.value));setUpper(null);setLower(null);setDeclared(false)}}>{index.frames.map(item=><option key={item.frameIndex} value={item.frameIndex}>Frame {item.frameIndex} · {item.ptsSeconds.toFixed(3)} s · {item.width}×{item.height}</option>)}</select></label>
   {index.frames.find(item=>item.frameIndex===calibrationIndex)&&<VisualFramePicker key={captureId+':'+calibrationIndex} captureId={captureId} frame={index.frames.find(item=>item.frameIndex===calibrationIndex)!} upper={upper} lower={lower} onChange={(point,pixel)=>{if(point==='upper')setUpper(pixel);else setLower(pixel);setDeclared(false)}}/>}
   <label>Calibration visibility<select value={visibility} onChange={event=>setVisibility(event.target.value as VisualAnnotation['visibility'])}><option value="visible">Both correspondences visible</option><option value="occluded">Occluded</option><option value="missing">Missing / cannot identify</option></select></label>
   <label>Later target frame (image withheld until forecast is frozen)<select value={targetIndex} onChange={event=>setTargetIndex(Number(event.target.value))}>{index.frames.filter(item=>item.frameIndex>calibrationIndex).map(item=><option key={item.frameIndex} value={item.frameIndex}>Frame {item.frameIndex} · {item.ptsSeconds.toFixed(3)} s</option>)}</select></label>
   <div className="visual-likelihood-fields"><label>Declared held vowel<select value={pose} onChange={event=>setPose(event.target.value)}>{['a','e','i','o','u'].map(value=><option key={value}>{value}</option>)}</select></label><label>Assumed jaw angle (degrees)<input value={jaw} onChange={event=>setJaw(event.target.value)}/></label><label>Calibration tolerance (pixels)<input value={tolerance} onChange={event=>setTolerance(event.target.value)} type="number" min="0" step="any"/></label></div>
   {cameras.map((camera,i)=><div key={camera.id} className="visual-likelihood-fields"><label>{camera.id}: declared rotation (nine values)<textarea rows={3} value={camera.rotation} onChange={event=>setCameras(values=>values.map((item,j)=>j===i?{...item,rotation:event.target.value}:item))}/></label><label>Declared scale (pixels per meter)<input value={camera.scale} onChange={event=>setCameras(values=>values.map((item,j)=>j===i?{...item,scale:event.target.value}:item))}/></label>{cameras.length>1&&<button onClick={()=>setCameras(values=>values.filter((_,j)=>j!==i))}>Remove camera candidate</button>}</div>)}
   <button onClick={()=>setCameras(values=>[...values,{id:'camera-'+crypto.randomUUID(),rotation:'1 0 0\n0 1 0\n0 0 1',scale:''}])}>Add declared camera candidate</button>
   <p>The identity rotation shown initially is an editable assumption, not a recovered camera pose. Camera candidates stay fixed after freezing.</p><label><input type="checkbox" checked={declared} onChange={event=>setDeclared(event.target.checked)}/> I declare these experimental correspondences and camera/jaw assumptions.</label><button disabled={!declared} onClick={()=>void freeze()}>Calibrate and freeze visual forecast</button>
  </fieldset>}
  {Object.keys(status?.visualForecasts??{}).length>0&&<label>Saved visual forecast<select value={forecastId} onChange={event=>setSelectedForecast(event.target.value)}>{Object.keys(status?.visualForecasts??{}).map(id=><option key={id}>{id}</option>)}</select></label>}
  {forecast&&<div><h4>Recorded visual forecast</h4><p>{forecastId} · {forecast.status} · baseline {forecast.baseline_model_id}. {forecast.baseline_model_id!==status?.currentModelId?'Historical baseline; current-model compatibility must be checked before scoring.':''}</p>
   <p>Calibration: {forecast.artifact.artifact.calibration_status}. Retained {forecast.artifact.artifact.pairs.filter(pair=>pair.retained).length} joint anatomy/camera candidates. Retaining multiple candidates is ambiguity, not a unique recovered camera or anatomy.</p>
   <table><thead><tr><th>Hypothesis</th><th>Declared camera</th><th>Calibration RMS (pixels)</th><th>Retained</th></tr></thead><tbody>{forecast.artifact.artifact.pairs.map(pair=><tr key={pair.hypothesis_id+':'+pair.camera_id}><td>{pair.hypothesis_id}</td><td>{pair.camera_id}</td><td>{pair.calibration_rms_px?.toFixed(3)??'Unavailable'}</td><td>{pair.retained?'Yes':'No'}</td></tr>)}</tbody></table>
   {forecast.artifact.artifact.targets.length!==1&&<p>This saved forecast contains multiple targets. This panel creates and scores single-target forecasts; its complete evidence remains available below.</p>}
   <button disabled={working||forecast.artifact.artifact.calibration_status!=='scored'||forecast.status==='stale'||forecast.artifact.artifact.targets.length!==1} onClick={()=>void openTarget()}>Open frozen target frame</button>
   {targetFrame?.forecastId===forecastId&&<fieldset disabled={working||forecast.status==='scored'||forecast.status==='stale'||forecast.baseline_model_id!==status?.currentModelId}><legend>Later target annotation</legend><p>Use the frozen vowel {forecast.artifact.artifact.targets[0]?.pose} and assumed jaw {forecast.artifact.artifact.targets[0]?.assumed_JA}°. These are declared model controls.</p><VisualFramePicker key={targetFrame.captureId+':'+targetFrame.frame.frameIndex+':'+forecastId} captureId={targetFrame.captureId} frame={targetFrame.frame} upper={targetUpper} lower={targetLower} onChange={(point,pixel)=>{if(point==='upper')setTargetUpper(pixel);else setTargetLower(pixel);setScoreDeclared(false)}}/>
    <label>Target visibility<select value={targetVisibility} onChange={event=>setTargetVisibility(event.target.value as VisualAnnotation['visibility'])}><option value="visible">Both correspondences visible</option><option value="occluded">Occluded</option><option value="missing">Missing / cannot identify</option></select></label><label><input type="checkbox" checked={scoreDeclared} onChange={event=>setScoreDeclared(event.target.checked)}/> These are my later annotations of the declared outer-lip correspondences.</label><button disabled={!scoreDeclared} onClick={()=>void score()}>Score frozen visual forecast</button>
   </fieldset>}
   {forecast.score_result&&<><p>Held-out visual result: {forecast.score_result.artifact.status}. Baseline model unchanged.</p>{forecast.score_result.artifact.missing_frame_ids.length>0&&<p>Missing or unscorable frames: {forecast.score_result.artifact.missing_frame_ids.join(', ')}</p>}<table><thead><tr><th>Hypothesis</th><th>Declared camera</th><th>Held-out RMS (pixels)</th></tr></thead><tbody>{forecast.score_result.artifact.scores.map(row=><tr key={row.hypothesis_id+':'+row.camera_id}><td>{row.hypothesis_id}</td><td>{row.camera_id}</td><td>{row.heldout_rms_px?.toFixed(3)??'Unavailable'}</td></tr>)}</tbody></table></>}
   <details><summary>Exact frozen evidence and conditional results</summary><pre>{JSON.stringify({forecast:forecast.artifact,score:forecast.score_result},null,2)}</pre></details></div>}
 </section>;
}
