import {useEffect,useRef,useState} from 'react';
import {depthPixelAt,fitLidarCapture,importLidarCapture,lidarFrameUrl,parseDepthMapping,parseNumbers,readLidarFrame,readLidarStatus,verifiedLidarGeometry} from './lidarClient';
import type {LidarAnnotation,LidarFrame,LidarStatus,Pixel} from './lidarClient';
import {parseSpaceDiff,setModelAdjustments} from '../science/modelAdjustments';
import './LidarFusionPanel.css';

function DepthSelection({frame,upper,lower,onSelect}:{frame:LidarFrame;upper:Pixel|null;lower:Pixel|null;onSelect:(pixel:Pixel)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const context=canvas.current?.getContext('2d');if(!context)return;
  const finite=frame.depthM.filter((value):value is number=>value!=null&&Number.isFinite(value)&&value>0);
  let low=Infinity,high=-Infinity;for(const value of finite){low=Math.min(low,value);high=Math.max(high,value)}
  const image=context.createImageData(frame.width,frame.height);
  frame.depthM.forEach((value,index)=>{const valid=value!=null&&Number.isFinite(value)&&value>0;const gray=valid?Math.round(50+205*(1-(value-low)/(high-low||1))):0;image.data.set([gray,gray,gray,255],index*4)});
  context.putImageData(image,0,0);
  for(const [pixel,color] of [[upper,'#fa91bd'],[lower,'#8cffce']] as const){if(!pixel)continue;context.strokeStyle=color;context.lineWidth=1;context.beginPath();context.arc(pixel[0]+.5,pixel[1]+.5,3,0,Math.PI*2);context.stroke()}
 },[frame,upper,lower]);
 return <canvas ref={canvas} width={frame.width} height={frame.height} aria-label="Original depth pixel selection" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();onSelect(depthPixelAt(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height,frame.width,frame.height))}}/>;
}

export function LidarFusionPanel(){
 const [status,setStatus]=useState<LidarStatus|null>(null),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [sequence,setSequence]=useState<number|null>(null),[frameEntry,setFrameEntry]=useState<{captureId:string;frame:LidarFrame}|null>(null),[point,setPoint]=useState<'upper'|'lower'>('upper'),[upper,setUpper]=useState<Pixel|null>(null),[lower,setLower]=useState<Pixel|null>(null);
 const [sourceKind,setSourceKind]=useState<'human-observation'|'development-fixture'>('human-observation');
 const [mapping,setMapping]=useState(''),[mappingWhy,setMappingWhy]=useState(''),[pose,setPose]=useState('a'),[jaw,setJaw]=useState('-3'),[weights,setWeights]=useState('1'),[measurementSigma,setMeasurementSigma]=useState(''),[modelSigma,setModelSigma]=useState(''),[uncertainty,setUncertainty]=useState(''),[correspondence,setCorrespondence]=useState(''),[registration,setRegistration]=useState(''),[declared,setDeclared]=useState(false);
 const notified=useRef(new Set<string>());
 const requestIdentity=useRef<{key:string;id:string}|null>(null),captureId=status?.capture?.captureId,frameInfo=status?.capture?.frames.find(item=>item.sequence===sequence);
 const selectedSequence=sequence??status?.capture?.frames[0]?.sequence;
 const frame=frameEntry&&frameEntry.captureId===captureId&&frameEntry.frame.sequence===selectedSequence?frameEntry.frame:null;
 useEffect(()=>{
  const controller=new AbortController();let active=true,timer:ReturnType<typeof setTimeout>;
  async function load(){try{const value=await readLidarStatus(controller.signal);if(active){setStatus(value);if(value.result?.adoption?.model_updated&&!notified.current.has(value.result.fitId)){notified.current.add(value.result.fitId);window.dispatchEvent(new CustomEvent('singing:model-updated',{detail:{modelId:value.result.modelId,source:'lidar',fitId:value.result.fitId}}))}if(value.busy)timer=setTimeout(()=>void load(),2000)}}catch(reason){if(active)setError(String(reason))}}
  void load();return()=>{active=false;controller.abort();clearTimeout(timer)};
 },[refresh]);
 useEffect(()=>{
  if(!captureId||selectedSequence==null)return;
  const controller=new AbortController();let active=true;
  void readLidarFrame(captureId,selectedSequence,controller.signal).then(value=>{if(active){setFrameEntry({captureId,frame:value});setUpper(null);setLower(null);setDeclared(false)}}).catch(reason=>{if(active){setFrameEntry(null);setError(String(reason))}});
  return()=>{active=false;controller.abort()};
 },[captureId,selectedSequence]);
 async function importCapture(){setBusy(true);setError('');try{await importLidarCapture();setSequence(null);setRefresh(value=>value+1)}catch(reason){setError(String(reason))}finally{setBusy(false)}}
 async function fit(){
  if(!captureId||!frame||!upper||!lower||!declared)return;
  setBusy(true);setError('');
  try{
   const jawValues=parseNumbers(jaw,'Jaw angles'),jawWeights=parseNumbers(weights,'Jaw weights');
   if(jawValues.length!==jawWeights.length||jawWeights.some(value=>value<0)||!jawWeights.some(value=>value>0))throw Error('Supply one nonnegative weight per jaw angle, with at least one positive weight');
   const measurementSigmaM=Number(measurementSigma),modelSigmaM=Number(modelSigma);
   if(!(measurementSigmaM>0)||!(modelSigmaM>0)||!Number.isFinite(measurementSigmaM+modelSigmaM))throw Error('Both uncertainty values must be positive finite meters');
   if([mappingWhy,uncertainty,correspondence,registration].some(value=>!value.trim()))throw Error('Explain the mapping, uncertainty, correspondence and registration assumptions');
   const latest=await readLidarStatus();setStatus(latest);
   if(latest.capture?.captureId!==captureId)throw Error('The selected scan changed. Review the new frame before fitting');
   if(!latest.currentModelId)throw Error('Complete a voice model before comparing LiDAR evidence');
   const annotation:LidarAnnotation={sourceKind,frameSequence:frame.sequence,upperPixel:upper,lowerPixel:lower,depthToReference:parseDepthMapping(mapping),referenceMappingExplanation:mappingWhy.trim(),pose,jawValues,jawWeights,measurementSigmaM,modelSigmaM,uncertaintyExplanation:uncertainty.trim(),correspondenceExplanation:correspondence.trim(),registrationExplanation:registration.trim(),experimentalDeclaration:true};
   const key=JSON.stringify([captureId,latest.currentModelId,annotation]);if(requestIdentity.current?.key!==key)requestIdentity.current={key,id:crypto.randomUUID()};
   await fitLidarCapture(captureId,latest.currentModelId,annotation,requestIdentity.current.id);setRefresh(value=>value+1);
  }catch(reason){setError(String(reason))}finally{setBusy(false)}
 }
 async function applyPreview(){
  const receipt=status?.result;if(!receipt?.geometry)return;
  setBusy(true);setError('');
  try{
   const latest=await readLidarStatus();setStatus(latest);
   if(latest.currentModelId!==receipt.geometry.modelId)throw Error('This geometry is historical. It cannot replace the current model preview');
   const diff=parseSpaceDiff(await verifiedLidarGeometry(receipt));
   const current=await readLidarStatus();setStatus(current);
   if(current.currentModelId!==receipt.geometry.modelId)throw Error('The model changed while loading geometry; refresh before applying');
   setModelAdjustments({runId:'lidar-'+receipt.fitId,diff,showDiff:true,jawPreview:false});window.dispatchEvent(new Event('singing:show-model'));
  }catch(reason){setError(String(reason))}finally{setBusy(false)}
 }
 const working=busy||!!status?.busy;
 return <section className="lidar-fusion" aria-label="Experimental rear LiDAR comparison"><h3>Experimental rear LiDAR comparison</h3>
  <p>Pull an original rear scan from the iPhone, then compare its declared outer-lip distance with the current voice hypotheses. A separate scan is not synchronized with singing. These experimental correspondences and uncertainties do not establish anatomical accuracy.</p>
  <div className="lidar-fusion-actions"><button disabled={working||status?.enabled===false} onClick={()=>void importCapture()}>Use latest rear LiDAR scan</button><button disabled={working} onClick={()=>setRefresh(value=>value+1)}>Refresh LiDAR status</button></div>
  {!status&&<p>LiDAR status unavailable or loading.</p>}{status?.enabled===false&&<p>Optional LiDAR fusion is disabled. Ordinary voice experiments remain available.</p>}{working&&<p role="status">Processing LiDAR evidence…</p>}{error&&<p role="alert">{error}</p>}{status?.error&&<p role="alert">{status.error}</p>}
  {status?.capture&&<><label>Original rear depth frame <select value={selectedSequence??''} disabled={working} onChange={event=>{setFrameEntry(null);setSequence(Number(event.target.value))}}>{status.capture.frames.map(item=><option key={item.sequence} value={item.sequence}>Frame {item.sequence} · {item.width}×{item.height} · {item.validPixels} valid pixels</option>)}</select></label>
   {(frameInfo??status.capture.frames[0])?.rgbAvailable&&<figure><img src={lidarFrameUrl(status.capture.captureId,selectedSequence!,'rgb')} alt="Original rear RGB reference, not a depth pixel map"/><figcaption>Original RGB reference only. Do not assume RGB pixels align with depth pixels.</figcaption></figure>}
   {frame&&<><p>Select upper or lower outer-lip correspondence, then click the original depth grid. Black pixels have missing depth. Markers do not identify anatomy automatically.</p><label>Point to mark <select value={point} onChange={event=>setPoint(event.target.value as 'upper'|'lower')}><option value="upper">Upper outer lip (surface 4, vertex 89)</option><option value="lower">Lower outer lip (surface 5, vertex 89)</option></select></label><DepthSelection frame={frame} upper={upper} lower={lower} onSelect={pixel=>{if(point==='upper')setUpper(pixel);else setLower(pixel);setDeclared(false)}}/><p>Upper depth pixel: {upper?.join(', ')??'unselected'} · Lower depth pixel: {lower?.join(', ')??'unselected'}. These are outer surfaces, not the inner lip aperture.</p><details><summary>Original frame calibration metadata</summary><pre>{JSON.stringify(frame.calibration,null,2)}</pre></details></>}
   <fieldset disabled={working}><legend>Declare the experimental mapping and comparison</legend><label>Declared evidence source<select value={sourceKind} onChange={event=>setSourceKind(event.target.value as typeof sourceKind)}><option value="human-observation">Human observation</option><option value="development-fixture">Development fixture (synthetic test)</option></select></label>
    <label>Depth-to-calibration-reference matrix (nine numbers, rows in order)<textarea value={mapping} onChange={event=>setMapping(event.target.value)} rows={3}/></label>
    <label>Evidence for that pixel mapping<textarea value={mappingWhy} onChange={event=>setMappingWhy(event.target.value)}/></label>
    <div className="lidar-fusion-fields"><label>Declared held vowel<select value={pose} onChange={event=>setPose(event.target.value)}>{['a','e','i','o','u'].map(value=><option key={value}>{value}</option>)}</select></label><label>Jaw angles (degrees)<input value={jaw} onChange={event=>setJaw(event.target.value)}/></label><label>Corresponding jaw weights<input value={weights} onChange={event=>setWeights(event.target.value)}/></label><label>Measurement uncertainty (meters)<input type="number" min="0" step="any" value={measurementSigma} onChange={event=>setMeasurementSigma(event.target.value)}/></label><label>Model discrepancy uncertainty (meters)<input type="number" min="0" step="any" value={modelSigma} onChange={event=>setModelSigma(event.target.value)}/></label></div>
    <label>Evidence and assumptions behind these uncertainties<textarea value={uncertainty} onChange={event=>setUncertainty(event.target.value)}/></label>
    <label>Why these visible points correspond to native outer-lip surfaces 4 and 5, vertex 89<textarea value={correspondence} onChange={event=>setCorrespondence(event.target.value)}/></label>
    <label>Why a same-frame rigid-distance comparison is applicable<textarea value={registration} onChange={event=>setRegistration(event.target.value)}/></label>
    <label><input type="checkbox" checked={declared} onChange={event=>setDeclared(event.target.checked)}/> I declare these experimental assumptions; they are not calibrated confidence or verified internal anatomy.</label>
    <button disabled={!frame||!upper||!lower||!declared||!status.currentModelId||status.enabled===false} onClick={()=>void fit()}>Compare with and without LiDAR</button>
   </fieldset>
  </>}
  {status?.result&&<div><h4>Recorded LiDAR contribution</h4>
   <p>Numerical result: {status.result.result.status}. {status.result.result.reason}</p>
   <p>{status.result.adoption?.model_updated?'The depth-ranked successor was adopted by the session.':'No successor model was adopted.'} {status.result.includedInFit?'Depth evidence participated in this conditional fit.':'Depth evidence was not included in the fit.'} This does not validate anatomy.</p>
   <p>Model lineage: {status.result.parentModelId} → {status.result.modelId}. {status.currentModelId!==status.result.modelId?'Historical result: the current model has since changed.':''}</p>
   {status.result.result.observed_distance_m!=null&&<p>Declared outer-lip distance: {status.result.result.observed_distance_m.toFixed(6)} m · {status.result.result.actual_geometry_calls??0} native geometry calls.</p>}
   <p>Without depth: {status.result.result.without_depth_order?.join(' → ')||'Unavailable'}</p><p>With depth: {status.result.result.with_depth_order?.join(' → ')||'Unavailable'}</p>
   {status.result.result.rankings?.length?<table><thead><tr><th>Hypothesis</th><th>Depth discrepancy</th></tr></thead><tbody>{status.result.result.rankings.map(row=><tr key={row.hypothesis_id}><td>{row.hypothesis_id}</td><td>{row.depth_discrepancy==null?'Unavailable':row.depth_discrepancy.toFixed(4)}</td></tr>)}</tbody></table>:null}
   <details><summary>Exact comparison and retained prediction evidence</summary><pre>{JSON.stringify({comparison:status.result.result.comparison,rankings:status.result.result.rankings},null,2)}</pre></details>
   {status.result.geometry&&<><p>Geometry uses hypothesis {status.result.geometry.hypothesisId}, vowel {status.result.geometry.pose}, declared jaw {status.result.geometry.JA}°. It is a model surface, not a measured scan.</p><button disabled={working||status.currentModelId!==status.result.geometry.modelId} onClick={()=>void applyPreview()}>Apply depth-ranked model preview</button></>}
  </div>}
 </section>;
}
