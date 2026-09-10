import type {TongueRegion} from './tongueRegion';

export async function loadTongueBaseline(signal?:AbortSignal){
 const response=await fetch('/models/tonguesam/manifest.json',{signal,cache:'no-store'});
 if(!response.ok)throw Error('Tongue baseline is unavailable');
 const manifest=await response.json();
 if(manifest.schema!=='tonguesam-detector/v1'||manifest.capability!=='visible-tongue-bounding-box'||manifest.input?.join(',')!=='1,3,448,448')throw Error('Unknown tongue baseline');
 const weights=await fetch('/models/tonguesam/detector.onnx',{signal,cache:'no-store'});if(!weights.ok)throw Error('Tongue baseline weights are unavailable');
 const buffer=await weights.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==manifest.modelSha256)throw Error('Tongue baseline verification failed');
 const worker=new Worker(new URL('./tongueBaseline.worker.ts',import.meta.url),{type:'module'});
 let nextId=0,closed=false;
 const pending=new Map<number,{resolve:(value:TongueRegion)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const close=()=>{if(closed)return;closed=true;worker.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Tongue baseline stopped'));}pending.clear();signal?.removeEventListener('abort',close);};
 const request=(message:{weights?:ArrayBuffer;data?:Float32Array},transfer:Transferable[])=>new Promise<TongueRegion>((resolve,reject)=>{
  if(closed){reject(Error('Tongue baseline stopped'));return;}
  const id=++nextId,timer=setTimeout(()=>{close()},15000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,...message},transfer);
 });
 worker.onmessage=event=>{const p=pending.get(event.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(event.data.id);if(event.data.error)p.reject(Error(event.data.error));else p.resolve(event.data.result??{box:null,score:0});};
 worker.onerror=()=>close();signal?.addEventListener('abort',close,{once:true});
 if(signal?.aborted)close();
 try{await request({weights:buffer},[buffer]);}catch(error){close();throw error;}
 const source=document.createElement('canvas'),canvas=document.createElement('canvas');canvas.width=canvas.height=448;
 const sc=source.getContext('2d')!,ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 return {kind:'region' as const,manifest,close,async infer(pixels:Uint8ClampedArray,w:number,h:number){
  source.width=w;source.height=h;sc.putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);ctx.drawImage(source,0,0,448,448);
  const rgba=ctx.getImageData(0,0,448,448).data,data=new Float32Array(3*448*448),mean=[.485,.456,.406],std=[.229,.224,.225];
  for(let i=0;i<448*448;i++)for(let c=0;c<3;c++)data[c*448*448+i]=(rgba[i*4+c]/255-mean[c])/std[c];
  return request({data},[data.buffer]);
 }};
}
