import type {TongueRegion} from './tongueRegion';
import {sha256} from '../contracts';

const triple=(v:unknown,positive=false):v is [number,number,number]=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&(!positive||n>0));
// Creating the 36 MB session takes much longer than one 448-pixel inference.
const LOAD={ms:60000,message:'Tongue region detector took more than 60 s to load'},INFERENCE={ms:15000,message:'timed out after 15 s'};
// Manifest hashes whose weights still failed verification after a fresh download: reported, not re-downloaded, until the page reloads.
const rejected=new Set<string>(),MISMATCH='Tongue baseline verification failed · the model file does not match its manifest; reload the page to retry';
export async function loadTongueBaseline(signal?:AbortSignal){
 // Revalidate the small manifest; the hash-checked weights may come from the HTTP cache.
 const response=await fetch('/models/tonguesam/manifest.json',{signal,cache:'no-cache'});
 // A dev server answers a missing file with its HTML page; that is an absent model, not a corrupt one.
 const html=(r:Response)=>r.headers.get('content-type')?.includes('text/html');
 if(!response.ok||html(response))throw Error('Tongue baseline is unavailable');
 const manifest=await response.json(),{threshold,normalization}=manifest;
 if(manifest.schema!=='tonguesam-detector/v1'||manifest.capability!=='visible-tongue-bounding-box'||manifest.input?.join(',')!=='1,3,448,448'||!(typeof threshold==='number'&&threshold>0&&threshold<=1)||!triple(normalization?.mean)||!triple(normalization?.std,true)||!/^[0-9a-f]{64}$/.test(manifest.modelSha256))throw Error('Unknown tongue baseline');
 if(rejected.has(manifest.modelSha256))throw Error(MISMATCH);
 const weights=async(cache:RequestCache)=>{const r=await fetch('/models/tonguesam/detector.onnx',{signal,cache});if(!r.ok||html(r))throw Error('Tongue baseline weights are unavailable');return r.arrayBuffer();};
 let buffer=await weights('default');
 // A cached copy from before a model update fails the hash once; fetch the current file before giving up.
 if(await sha256(new Uint8Array(buffer))!==manifest.modelSha256){buffer=await weights('reload');if(await sha256(new Uint8Array(buffer))!==manifest.modelSha256){rejected.add(manifest.modelSha256);throw Error(MISMATCH);}}
 const worker=new Worker(new URL('./tongueBaseline.worker.ts',import.meta.url),{type:'module'});
 let nextId=0,closed=false;
 const pending=new Map<number,{resolve:(value:TongueRegion)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const close=()=>{if(closed)return;closed=true;worker.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Tongue baseline stopped'));}pending.clear();signal?.removeEventListener('abort',close);};
 const request=(message:{weights?:ArrayBuffer;threshold?:number;data?:Float32Array},transfer:Transferable[],timeout:{ms:number;message:string})=>new Promise<TongueRegion>((resolve,reject)=>{
  if(closed){reject(Error('Tongue baseline stopped'));return;}
  const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error(timeout.message));close();},timeout.ms);pending.set(id,{resolve,reject,timer});worker.postMessage({id,...message},transfer);
 });
 worker.onmessage=event=>{const p=pending.get(event.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(event.data.id);if(event.data.error)p.reject(Error(event.data.error));else p.resolve(event.data.result??{box:null,score:0});};
 worker.onerror=()=>close();signal?.addEventListener('abort',close,{once:true});
 if(signal?.aborted)close();
 try{await request({weights:buffer,threshold},[buffer],LOAD);}catch(error){close();throw error;}
 const source=document.createElement('canvas'),canvas=document.createElement('canvas');canvas.width=canvas.height=448;
 const sc=source.getContext('2d')!,ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 const {mean,std}=normalization as {mean:[number,number,number];std:[number,number,number]};
 return {kind:'region' as const,manifest,close,async infer(pixels:Uint8ClampedArray,w:number,h:number){
  source.width=w;source.height=h;sc.putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);ctx.drawImage(source,0,0,448,448);
  const rgba=ctx.getImageData(0,0,448,448).data,data=new Float32Array(3*448*448);
  for(let i=0;i<448*448;i++)for(let c=0;c<3;c++)data[c*448*448+i]=(rgba[i*4+c]/255-mean[c])/std[c];
  return request({data},[data.buffer],INFERENCE);
 }};
}
