import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type {Landmark, TongueDiagnostic, TongueObservation} from '../types';

ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths={wasm:wasmUrl};
const mean=[.485,.456,.406],std=[.229,.224,.225];
export type NeuralTip={x:number;y:number;depth:number;visibility:number;peak:number};
/** Spatial keypoint head + a separately supervised depth head. No color mask,
 * nearest-template lookup, optical flow, or conversion of vertical motion to depth. */
export async function loadTongueNetwork(signal?:AbortSignal){
 const [meta,weights]=await Promise.all([fetch('/api/tongue-neural/manifest',{cache:'no-store',signal}),fetch('/api/tongue-neural/model',{cache:'no-store',signal})]);
 if(!meta.ok||!weights.ok)throw Error('Personal tongue network is not installed on this Mac');
 const manifest=await meta.json();if(manifest.schema!=='personal-tongue-neural/v1')throw Error('Unknown tongue network format');
 const buffer=await weights.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==manifest.modelSha256)throw Error('Tongue model verification failed');
 const session=await ort.InferenceSession.create(buffer,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 const source=document.createElement('canvas');const sc=source.getContext('2d')!;
 return {async infer(pixels:Uint8ClampedArray,w:number,h:number):Promise<NeuralTip>{
  source.width=w;source.height=h;sc.putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);ctx.drawImage(source,0,0,128,128);const rgba=ctx.getImageData(0,0,128,128).data;
  const data=new Float32Array(3*128*128);for(let i=0;i<128*128;i++)for(let c=0;c<3;c++)data[c*128*128+i]=(rgba[i*4+c]/255-mean[c])/std[c];
  const input=new ort.Tensor('float32',data,[1,3,128,128]);let result:ort.InferenceSession.OnnxValueMapType|undefined;
  try{result=await session.run({image:input});const heat=result.heatmap.data as Float32Array;let best=0;for(let i=1;i<heat.length;i++)if(heat[i]>heat[best])best=i;
   // Local weighted centroid gives sub-cell motion without averaging separate peaks.
   const bx=best%32,by=Math.floor(best/32);let sx=0,sy=0,sum=0;
   for(let y=Math.max(0,by-1);y<=Math.min(31,by+1);y++)for(let x=Math.max(0,bx-1);x<=Math.min(31,bx+1);x++){const v=Math.max(0,heat[y*32+x]);sx+=x*v;sy+=y*v;sum+=v;}
   return {x:sx/Math.max(sum,1e-8)/32,y:sy/Math.max(sum,1e-8)/32,depth:Number(result.depth.data[0]),visibility:Number(result.visibility.data[0]),peak:heat[best]};
  }finally{input.dispose();if(result)Object.values(result).forEach(t=>t.dispose());}
 },close:()=>session.release(),manifest};
}

export function neuralTipObservation(tip:NeuralTip,face:Landmark[],width:number,height:number,timestamp:number):TongueObservation|undefined{
 if(!face[308]||!face[14]||tip.visibility<.55||tip.peak<.2||![tip.x,tip.y,tip.depth].every(Number.isFinite))return;
 const [left,right]=[face[78],face[308]].sort((a,b)=>a.x-b.x);const dx=(right.x-left.x)*width,dy=(right.y-left.y)*height,span=Math.max(1,Math.hypot(dx,dy)),ux=dx/span,uy=dy/span;
 const tx=(tip.x-(left.x+right.x)/2)*width,ty=(tip.y-(left.y+right.y)/2)*height;
 const x=(tx*ux+ty*uy)/span,y=(tx*uy-ty*ux)/span,z=tip.depth;
 return {trackingMode:'tip',x:tip.x,y:tip.y,tip:{x:tip.x,y:tip.y},lateral:Math.max(-1,Math.min(1,x*3)),elevation:Math.max(-1,Math.min(1,y*3)),extension:Math.max(-1,Math.min(1,z)),lift:0,visibleFraction:0,observedAt:timestamp,tip3D:{x,y,z,depthSource:'learned'},confidence:tip.visibility};
}

export function createNeuralTongueTracker(){
 let network:Awaited<ReturnType<typeof loadTongueNetwork>>|undefined,closed=false,busy=false,generation=0,last:TongueObservation|undefined;
 let diagnostic:TongueDiagnostic={state:'unselected',reason:'Loading personal neural tongue model'};
 const abort=new AbortController();
 void loadTongueNetwork(abort.signal).then(n=>{if(closed){void n.close();return;}network=n;diagnostic={state:'selected',reason:'Neural model ready · show the tongue tip'};}).catch(e=>{if(!closed)diagnostic={state:'lost',reason:e instanceof Error?e.message:'Tongue network unavailable'};});
 let reference:{x:number;y:number;z:number}|undefined;
 const track=(pixels:Uint8ClampedArray,width:number,height:number,face:Landmark[],timestamp:number)=>{
  if(!face.length){if(last||busy)generation++;last=undefined;return;}
  if(network&&!busy&&!closed){busy=true;const epoch=generation;
   void network.infer(pixels,width,height).then(prediction=>{
    if(closed||epoch!==generation)return;
    const observation=neuralTipObservation(prediction,face,width,height,timestamp);
    diagnostic={state:observation?'tracking':'lost',reason:observation?'Neural tip detected · depth is a learned estimate':'Neural model cannot identify a visible tip',score:prediction.visibility,margin:prediction.peak};
    if(observation&&reference){observation.lateral-=reference.x;observation.elevation=(observation.elevation??0)-reference.y;observation.extension=(observation.extension??0)-reference.z;}
    last=observation;
   }).catch(e=>{if(!closed&&epoch===generation){last=undefined;diagnostic={state:'lost',reason:`Neural inference failed: ${String(e)}`};}}).finally(()=>{busy=false;if(closed)void network?.close();});
  }
  return last&&timestamp-(last.observedAt??0)<300?last:undefined;
 };
 return Object.assign(track,{diagnostics:()=>({...diagnostic}),resetMotionReference(){reference=last?{x:last.lateral,y:last.elevation??0,z:last.extension??0}:undefined;last=undefined;generation++;},close(){closed=true;generation++;abort.abort();if(!busy)void network?.close();}});
}
