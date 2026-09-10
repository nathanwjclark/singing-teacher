import {useState} from 'react';
import {visualFrameUrl,visualPixelAt} from './visualClient';
import type {VisualFrame,VisualPixel} from './visualClient';

export function VisualFramePicker({captureId,frame,upper,lower,onChange}:{captureId:string;frame:VisualFrame;upper:VisualPixel|null;lower:VisualPixel|null;onChange:(point:'upper'|'lower',pixel:VisualPixel)=>void}){
 const [point,setPoint]=useState<'upper'|'lower'>('upper'),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 return <div><p>Original coded frame {frame.frameIndex} · {frame.width}×{frame.height} pixels · {frame.ptsSeconds.toFixed(3)} s. No automatic rotation, crop or mirror correction.</p>
  <label>Outer lip to annotate<select value={point} onChange={event=>setPoint(event.target.value as 'upper'|'lower')}><option value="upper">Upper outer lip · surface 4, vertex 89</option><option value="lower">Lower outer lip · surface 5, vertex 89</option></select></label>
  <figure><img src={visualFrameUrl(captureId,frame.frameIndex)} alt="Original decoded motion frame" onLoad={event=>{const image=event.currentTarget;if(image.naturalWidth!==frame.width||image.naturalHeight!==frame.height){setError('Decoded image dimensions do not match the frame index');setLoaded(false)}else{setLoaded(true);setError('')}}} onError={()=>{setError('Original decoded frame unavailable');setLoaded(false)}}/>
   {loaded&&<svg viewBox={`0 0 ${frame.width} ${frame.height}`} aria-label="Annotate original outer-lip pixels" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();onChange(point,visualPixelAt(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height,frame.width,frame.height))}}>{upper&&<circle cx={upper[0]+.5} cy={upper[1]+.5} r={Math.max(2,frame.width/120)} fill="none" stroke="#fa91bd" strokeWidth={Math.max(1,frame.width/300)}/>} {lower&&<circle cx={lower[0]+.5} cy={lower[1]+.5} r={Math.max(2,frame.width/120)} fill="none" stroke="#8cffce" strokeWidth={Math.max(1,frame.width/300)}/>}</svg>}
  </figure>
  {error&&<p role="alert">{error}</p>}<p>Upper original pixel: {upper?.join(', ')??'not annotated'} · Lower: {lower?.join(', ')??'not annotated'}. Do not substitute MediaPipe points 13/14 or an inner-lip aperture.</p>
 </div>;
}
