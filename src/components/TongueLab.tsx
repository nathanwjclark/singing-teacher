import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TrackingFrame } from '../types';
import {reviewPrediction} from '../lib/tongueReview';
import type {ReviewPrediction} from '../lib/tongueReview';
import './TongueLab.css';

type Point={x:number;y:number};
type Sample=ReviewPrediction & {image:string;time:number;motion:string;status:string;diagnostic:TrackingFrame['tongueDiagnostic'];label?:Point|null;surface?:Point[]|null;crop:{x:number;y:number;width:number;height:number}};
type Props={video:RefObject<HTMLVideoElement|null>;frame:RefObject<TrackingFrame|undefined>;close:()=>void};
const W=480,H=384;
export default function TongueLab({video,frame,close}:Props){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [samples,setSamples]=useState<Sample[]>([]);
  const [sessionId]=useState(()=>crypto.randomUUID());
  const [labelMode,setLabelMode]=useState<'tip'|'surface'>('tip');
  const [vertices,setVertices]=useState<Point[]>([]);
  const [recording,setRecording]=useState(false);
  const [canFreeze,setCanFreeze]=useState(false);
  const [index,setIndexState]=useState<number|null>(null);
  const setIndex=(value:number|null)=>{setIndexState(value);setVertices([])};
  const [motion,setMotion]=useState('up');
  const [status,setStatus]=useState('Waiting for a mouth crop');
  const [tip3D,setTip3D]=useState<TrackingFrame['tongue']>();
  const [diagnostic,setDiagnostic]=useState<TrackingFrame['tongueDiagnostic']>();
  const currentCrop=useRef<TrackingFrame['tongueSearch']>(undefined);
  const chosen=index===null?undefined:samples[index];
  const capture=useRef({recording,motion,count:samples.length});
  useEffect(()=>{capture.current={recording,motion,count:samples.length}},[recording,motion,samples.length]);
  useEffect(()=>{
    if(index!==null)return;
    let raf=0,last=0,lastFrame=-1;
    const tick=(now:number)=>{
      const v=video.current,f=frame.current,c=canvas.current,ctx=c?.getContext('2d');
      const crop=f?.tongueSearch;
      if(v&&v.readyState>=2&&ctx&&crop&&crop.width>0&&crop.height>0){
        currentCrop.current=crop;setCanFreeze(true);
        ctx.drawImage(v,crop.x*v.videoWidth,crop.y*v.videoHeight,crop.width*v.videoWidth,crop.height*v.videoHeight,0,0,W,H);
        const prediction=reviewPrediction(f,crop);
        const p=prediction.prediction;
        setStatus(f.tongueStatus??'No tip observation');setDiagnostic(f.tongueDiagnostic);setTip3D(f.tongue);
        // Save the raw crop before drawing predictions: labels must see original pixels.
        if(capture.current.recording&&now-last>=250&&f.timestamp!==lastFrame){last=now;lastFrame=f.timestamp;
          if(capture.current.count>=80){setRecording(false);}else{
            const sample:Sample={image:c!.toDataURL('image/jpeg',.88),time:f.timestamp,motion:capture.current.motion,status:f.tongueStatus??'',diagnostic:f.tongueDiagnostic,...prediction,crop:{...crop}};
            capture.current.count++;setSamples(old=>[...old,sample]);
          }
        }
        if(prediction.regionPrediction)regionBox(ctx,prediction.regionPrediction);
        ctx.fillStyle='#ff71aa';for(const o of f.tongue?.outline??[]){ctx.beginPath();ctx.arc((o.x-crop.x)/crop.width*W,(o.y-crop.y)/crop.height*H,2,0,Math.PI*2);ctx.fill();}
        if(p)cross(ctx,p,'#ff71aa');
      }else{setCanFreeze(false);currentCrop.current=undefined;setStatus('Waiting for a live mouth crop');setDiagnostic(undefined);setTip3D(undefined);ctx?.clearRect(0,0,W,H);}
      raf=requestAnimationFrame(tick);
    };raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  },[index,video,frame]);
  useEffect(()=>{if(!chosen)return;let cancelled=false;const img=new Image();img.onload=()=>{if(cancelled)return;const ctx=canvas.current?.getContext('2d');if(!ctx)return;ctx.drawImage(img,0,0,W,H);if(chosen.prediction)cross(ctx,chosen.prediction,'#ff71aa');if(chosen.regionPrediction)regionBox(ctx,chosen.regionPrediction);if(chosen.label)cross(ctx,chosen.label,'#7effb0');const points=vertices.length?vertices:chosen.surface;if(points?.length){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x*W,p.y*H):ctx.moveTo(p.x*W,p.y*H));ctx.closePath();ctx.fillStyle='#65dff433';ctx.fill();ctx.strokeStyle='#65dff4';ctx.lineWidth=2;ctx.stroke();}};img.src=chosen.image;return()=>{cancelled=true}},[chosen,vertices]);
  const freeze=()=>{
    const v=video.current,f=frame.current,crop=f?.tongueSearch;
    if(!v||v.readyState<2||!crop||crop.width<=0||crop.height<=0||samples.length>=80)return;
    const image=document.createElement('canvas');image.width=W;image.height=H;
    const ctx=image.getContext('2d');if(!ctx)return;
    ctx.drawImage(v,crop.x*v.videoWidth,crop.y*v.videoHeight,crop.width*v.videoWidth,crop.height*v.videoHeight,0,0,W,H);
    const prediction=reviewPrediction(f,crop);
    const sample:Sample={image:image.toDataURL('image/jpeg',.88),time:f.timestamp,motion,status:f.tongueStatus??'',diagnostic:f.tongueDiagnostic,...prediction,crop:{...crop}};
    setSamples(old=>[...old,sample]);setIndex(samples.length);
  };
  const label=(value:Point|null)=>{if(index===null)return;setSamples(old=>old.map((s,i)=>i===index?{...s,label:value}:s))};
  const click=(e:React.MouseEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();const p={x:1-(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};if(index!==null){if(labelMode==='surface')setVertices(old=>[...old,p]);else label(p);}};
  const saveSurface=(surface:Point[]|null)=>{if(index===null)return;setSamples(old=>old.map((s,i)=>i===index?{...s,surface}:s));setVertices([])};
  const labeled=samples.filter(s=>s.label!==undefined),visible=labeled.filter(s=>s.label!==null),matched=visible.filter(s=>s.prediction);
  const errors=matched.map(s=>Math.hypot((s.prediction!.x-s.label!.x)*W,(s.prediction!.y-s.label!.y)*H));
  const exportData=()=>{const blob=new Blob([JSON.stringify({schema:'tongue-tip-review/v1',sessionId,createdAt:new Date().toISOString(),coordinates:'unmirrored normalized mouth crop',cropPixels:{width:W,height:H},method:'recorded observations: visible region boxes and personal tip/depth estimates are separate capabilities',surfaceAnnotationVersion:1,samples},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='tongue-tip-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  const d=chosen?chosen.diagnostic:diagnostic;
  return <div className="tongue-lab-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="tongue-lab-title" className="tongue-lab" onKeyDown={e=>{if(e.key==='Escape')close()}}>
    <header><h2 id="tongue-lab-title">Tongue observation lab</h2><button autoFocus onClick={close}>Close</button></header>
    <p>Pink shows the model output: the pretrained baseline detects a tongue region box, not a surface contour, tip or depth. An installed personal tip model can provide a separate learned tip/depth estimate. Green appears only when you click the actual tip on a frozen frame—it is your manual label, not an automatic detection.</p>
    {index!==null&&<fieldset><legend>Independent visible-surface labels</legend><label>Label mode <select value={labelMode} onChange={e=>{setLabelMode(e.target.value as 'tip'|'surface');setVertices([])}}><option value="tip">Tongue tip</option><option value="surface">Visible tongue outline</option></select></label>{labelMode==='surface'&&<><p>Click around only the visible tongue, excluding teeth, lips and hidden tissue. Blue is a manual reference label, not model output. The surface may be visible even when the tip is hidden.</p><button disabled={vertices.length<3} onClick={()=>saveSurface(vertices)}>Save visible outline</button><button disabled={!vertices.length} onClick={()=>setVertices(old=>old.slice(0,-1))}>Undo vertex</button><button onClick={()=>saveSurface(null)}>No visible tongue surface</button><span>{chosen?.surface===null?'Surface marked absent':chosen?.surface?'Surface outline saved':'Surface not reviewed'}</span></>}</fieldset>}
    <div className="tongue-lab-grid"><div><canvas ref={canvas} width={W} height={H} onClick={click} aria-label={index===null?'Mirrored live mouth crop. Model observations.':labelMode==='surface'?'Captured mouth crop. Outline only the visible tongue.':'Captured mouth crop. Click the actual tip to label it.'}/><p>{index===null?'LIVE · Pink shows available model observations. Freeze a frame to add a manual comparison label.':`FRAME ${index+1} · ${chosen?.motion} · ${labelMode==='surface'?'Outline the visible tongue in blue.':'Click the actual tip to place a green label.'}`}</p></div>
    <div className="tongue-lab-controls"><strong role="status">{chosen?.status??status}</strong><span>Tracker: {d?.state??'unavailable'}</span><span>{d?.reason??'No tracker observation yet'}</span><span>Detection score: {d?.score===undefined?'—':d.score.toFixed(2)} (uncalibrated)</span><span>Tip heatmap peak: {d?.margin===undefined?'—':d.margin.toFixed(3)}</span>
    {index===null&&<output aria-label="Tongue tip XYZ">{tip3D?.tip3D?`X ${tip3D.tip3D.x.toFixed(3)} · Y ${tip3D.tip3D.y.toFixed(3)} · Z ${tip3D.tip3D.z.toFixed(3)} (depth estimated; mouth-width units)`:'XYZ unavailable · tip not detected'}</output>}
    {index===null?<><button disabled={!canFreeze||recording||samples.length>=80} onClick={freeze}>Freeze frame & label tip</button><small>1. Freeze a mouth image. 2. Click the tip on that image. A green marker appears where you click.</small></>:<strong role="status">{chosen?.label===null?'Tip marked hidden; no green marker for this frame.':chosen?.label?'Green marker = your label. Click again to move it.':'Frozen frame: click the visible tongue tip to add a green marker.'}</strong>}
    <label>Motion <select value={motion} disabled={recording} onChange={e=>setMotion(e.target.value)}>{['up','down','left','right','out','retract','head still / tongue still','head movement / tongue still'].map(m=><option key={m}>{m}</option>)}</select></label>
    <button disabled={index!==null||samples.length>=80} onClick={()=>setRecording(r=>!r)}>{recording?'Stop capture':'Start capture'}</button>
    <small>Explicit capture only: 4 mouth images/second, up to 80 frames. No audio. Kept in memory until you export; closing discards them.</small>
    <button disabled={!samples.length||recording} onClick={()=>setIndex(index===null?0:null)}>{index===null?'Review captured frames':'Return to live'}</button>
    {index!==null&&<><div className="tongue-lab-row"><button disabled={index===0} onClick={()=>setIndex(index-1)}>Previous</button><button disabled={index===samples.length-1} onClick={()=>setIndex(index+1)}>Next</button></div><input aria-label="Review frame" type="range" min="0" max={samples.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/><button onClick={()=>label(null)}>Mark tip hidden / not identifiable</button><span>Label: {chosen?.label===null?'hidden':chosen?.label?'visible tip marked':'not reviewed'}</span></>}
    <strong>{samples.length} captured · {labeled.length} reviewed</strong><span>Tip found on {matched.length}/{visible.length} labeled visible frames</span><span>Mean error: {errors.length?`${(errors.reduce((a,b)=>a+b,0)/errors.length).toFixed(1)} crop pixels`:'—'}</span><span>Predictions on hidden frames: {labeled.filter(s=>s.label===null&&s.prediction).length}</span>
    <button disabled={!samples.length||recording} onClick={exportData}>Export images + labels + predictions</button><button disabled={recording||!samples.length} onClick={()=>{setIndex(null);setSamples([])}}>Clear captures</button>
    </div></div>
  </section></div>;
}
function cross(ctx:CanvasRenderingContext2D,p:Point,color:string){const x=p.x*W,y=p.y*H;const radius=color==='#7effb0'?12:7;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.moveTo(x-16,y);ctx.lineTo(x+16,y);ctx.moveTo(x,y-16);ctx.lineTo(x,y+16);ctx.strokeStyle='#071014';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.stroke()}

function regionBox(ctx:CanvasRenderingContext2D,box:[number,number,number,number]){ctx.strokeStyle='#ff71aa';ctx.lineWidth=2;ctx.strokeRect(box[0]*W,box[1]*H,(box[2]-box[0])*W,(box[3]-box[1])*H)}
