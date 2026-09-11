import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type {Landmark, TongueDiagnostic, TongueObservation, TongueTipObservation} from '../types';
import {sha256} from '../contracts';
import {observationInFrame, resultCurrent, type Crop} from './tongueTracking';

ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths={wasm:wasmUrl};
const mean=[.485,.456,.406],std=[.229,.224,.225];
export type NeuralTip={x:number;y:number;depth:number;visibility:number;peak:number};
/** Spatial keypoint head + a separately supervised depth head. No color mask,
 * nearest-template lookup, optical flow, or conversion of vertical motion to depth. */
export async function loadTongueNetwork(signal?:AbortSignal){
 const [meta,weights]=await Promise.all([fetch('/api/tongue-neural/manifest',{cache:'no-store',signal}),fetch('/api/tongue-neural/model',{cache:'no-store',signal})]);
 // The manifest decides: 404 (or a dev server's HTML page) means none is installed; 403 means the server keeps it for its own
 // computer, so another device such as a phone gets the public region detector. The cause stays visible in the diagnostic.
 const fallback=meta.status===403?'personal tip model is served only to the computer running the app':meta.status===404||(meta.ok&&meta.headers.get('content-type')?.includes('text/html'))?'no personal tip model installed':undefined;
 if(fallback)return {...await (await import('./tongueBaseline')).loadTongueBaseline(signal),fallback};
 if(!meta.ok)throw Error(`Personal tongue model unavailable (HTTP ${meta.status})`);
 if(!weights.ok)throw Error(`Personal tongue model is incomplete: weights unavailable (HTTP ${weights.status})`);
 const manifest=await meta.json();if(manifest.schema!=='personal-tongue-neural/v1')throw Error('Unknown tongue network format');
 const buffer=await weights.arrayBuffer();
 if(await sha256(new Uint8Array(buffer))!==manifest.modelSha256)throw Error('Tongue model verification failed');
 const session=await ort.InferenceSession.create(buffer,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 const source=document.createElement('canvas');const sc=source.getContext('2d')!;
 return {kind:'tip' as const,async infer(pixels:Uint8ClampedArray,w:number,h:number):Promise<NeuralTip>{
  source.width=w;source.height=h;sc.putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);ctx.drawImage(source,0,0,128,128);const rgba=ctx.getImageData(0,0,128,128).data;
  const data=new Float32Array(3*128*128);for(let i=0;i<128*128;i++)for(let c=0;c<3;c++)data[c*128*128+i]=(rgba[i*4+c]/255-mean[c])/std[c];
  const input=new ort.Tensor('float32',data,[1,3,128,128]);let result:ort.InferenceSession.OnnxValueMapType|undefined;
  try{result=await session.run({image:input});const heat=result.heatmap.data as Float32Array;let best=0;for(let i=1;i<heat.length;i++)if(heat[i]>heat[best])best=i;
   // Local weighted centroid gives sub-cell motion without averaging separate peaks.
   const bx=best%32,by=Math.floor(best/32);let sx=0,sy=0,sum=0;
   for(let y=Math.max(0,by-1);y<=Math.min(31,by+1);y++)for(let x=Math.max(0,bx-1);x<=Math.min(31,bx+1);x++){const v=Math.max(0,heat[y*32+x]);sx+=x*v;sy+=y*v;sum+=v;}
   return {x:sx/Math.max(sum,1e-8)/32,y:sy/Math.max(sum,1e-8)/32,depth:Number(result.depth.data[0]),visibility:Number(result.visibility.data[0]),peak:heat[best]};
  }finally{input.dispose();if(result)Object.values(result).forEach(t=>t.dispose());}
 },close:()=>session.release(),manifest,fallback:undefined};
}

export function neuralTipObservation(tip:NeuralTip,face:Landmark[],width:number,height:number,timestamp:number):TongueTipObservation|undefined{
 if(!face[78]||!face[308]||!face[14]||tip.visibility<.55||tip.peak<.2||![tip.x,tip.y,tip.depth,tip.visibility,tip.peak].every(Number.isFinite))return;
 const [left,right]=[face[78],face[308]].sort((a,b)=>a.x-b.x);const dx=(right.x-left.x)*width,dy=(right.y-left.y)*height,span=Math.max(1,Math.hypot(dx,dy)),ux=dx/span,uy=dy/span;
 const tx=(tip.x-(left.x+right.x)/2)*width,ty=(tip.y-(left.y+right.y)/2)*height;
 const x=(tx*ux+ty*uy)/span,y=(tx*uy-ty*ux)/span,z=tip.depth;
 return {trackingMode:'tip',x:tip.x,y:tip.y,tip:{x:tip.x,y:tip.y},lateral:Math.max(-1,Math.min(1,x)),elevation:Math.max(-1,Math.min(1,y)),extension:Math.max(-1,Math.min(1,z)),lift:0,visibleFraction:0,observedAt:timestamp,tip3D:{x,y,z,depthSource:'learned'},confidence:tip.visibility};
}

export function createNeuralTongueTracker(){
 let network:Awaited<ReturnType<typeof loadTongueNetwork>>|undefined,closed=false,busy=false,generation=0,failures=0;
 type Result={observation?:TongueObservation;observedAt:number};
 // arrived: delivered by inference, not yet seen by a frame. current: stamped with the frame clock on arrival.
 let arrived:Result|undefined,current:(Result&{arrivedAt:number})|undefined;
 let diagnostic:TongueDiagnostic={state:'unselected',reason:'Loading tongue model'};
 const abort=new AbortController();
 void loadTongueNetwork(abort.signal).then(n=>{if(closed){void n.close();return;}network=n;note=n.fallback?` (${n.fallback})`:'';diagnostic={state:'selected',capability:n.kind,reason:n.kind==='region'?'Tongue region detector ready · no tip or depth'+note:'Neural model ready · show the tongue tip'};}).catch(e=>{if(!closed)diagnostic={state:'lost',reason:e instanceof Error?e.message:'Tongue network unavailable'};});
 let reference:{x:number;y:number;z:number}|undefined,note='';
 /** crop: where these pixels sit in the frame. A result is mapped with the crop of the frame it was computed from, not a later one. */
 const track=(pixels:Uint8ClampedArray,width:number,height:number,face:Landmark[],timestamp:number,crop:Crop={x:0,y:0,width:1,height:1})=>{
  if(!face.length){if(current||arrived||busy)generation++;current=arrived=undefined;return;}
  if(arrived){current={...arrived,arrivedAt:timestamp};arrived=undefined;}
  if(network&&!busy&&!closed){busy=true;const epoch=generation,capability=network.kind;
   void network.infer(pixels,width,height).then(prediction=>{
    if(closed||epoch!==generation)return;
    failures=0;
    // A result whose crop lies outside the image is not an observation, and not an abstention either.
    const outside=()=>{current=arrived=undefined;diagnostic={state:'lost',capability,reason:'Tongue result lies outside the camera image · not used'+(capability==='region'?note:'')};};
    let observation:TongueObservation|undefined;
    if('box' in prediction){
     if(prediction.box&&!(observation=observationInFrame({trackingMode:'region',box:prediction.box,observedAt:timestamp,confidence:prediction.score},crop)))return outside();
     diagnostic={state:observation?'tracking':'lost',capability,reason:(observation?'Visible tongue region found · no tip or depth':'No visible tongue region found')+note,score:prediction.score};
    }else{
     const tip=neuralTipObservation(prediction,face,width,height,timestamp);
     if(tip&&reference){tip.lateral-=reference.x;tip.elevation=(tip.elevation??0)-reference.y;tip.extension=(tip.extension??0)-reference.z;}
     if(tip&&!(observation=observationInFrame(tip,crop)))return outside();
     diagnostic={state:tip?'tracking':'lost',capability,reason:tip?'Neural tip detected · depth is a learned estimate':'Neural model cannot identify a visible tip',score:prediction.visibility,margin:prediction.peak};
    }
    arrived={observation,observedAt:timestamp};
   }).catch(e=>{if(!closed&&epoch===generation){current=arrived=undefined;failures++;diagnostic={state:'lost',capability,reason:`${capability==='region'?'Tongue region detection':'Tongue tip model'} failed: ${e instanceof Error?e.message:String(e)}`};if(failures>=3){void network?.close();network=undefined;diagnostic.reason='Tongue inference paused after repeated failures · restart camera to retry';}}}).finally(()=>{busy=false;if(closed)void network?.close();});
  }
  if(current&&!resultCurrent(current,timestamp,network?.kind==='region'?800:300))current=undefined;
  return current?.observation;
 };
 return Object.assign(track,{diagnostics:():TongueDiagnostic=>({...diagnostic,abstained:!!current&&!current.observation}),resetMotionReference(){
  // The current tip is already relative to any earlier reference; add it back so the new reference stays in model units.
  const last=current?.observation;reference=last&&last.trackingMode!=='region'?{x:last.lateral+(reference?.x??0),y:(last.elevation??0)+(reference?.y??0),z:(last.extension??0)+(reference?.z??0)}:undefined;current=arrived=undefined;generation++;},close(){closed=true;generation++;abort.abort();if(!busy)void network?.close();}});
}
