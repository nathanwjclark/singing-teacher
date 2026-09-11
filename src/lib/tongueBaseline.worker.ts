import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import {selectTongueRegion} from './tongueRegion';
ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths={wasm:wasmUrl};
let session:ort.InferenceSession|undefined,threshold:number|undefined;
self.onmessage=async(event:MessageEvent<{id:number;weights?:ArrayBuffer;threshold?:number;data?:Float32Array}>)=>{
 const {id,weights,data}=event.data;
 try{
  if(weights){session=await ort.InferenceSession.create(weights,{executionProviders:['wasm'],graphOptimizationLevel:'all'});threshold=event.data.threshold;self.postMessage({id,ready:true});return;}
  if(!session||threshold===undefined||!data||data.length!==3*448*448)throw Error('Tongue worker is not ready');
  const input=new ort.Tensor('float32',data,[1,3,448,448]);let output:ort.InferenceSession.OnnxValueMapType|undefined;
  try{output=await session.run({image:input});self.postMessage({id,result:selectTongueRegion(output.boxes.data as Float32Array,threshold)});}
  finally{input.dispose();if(output)Object.values(output).forEach(t=>t.dispose());}
 }catch{self.postMessage({id,error:'Tongue baseline inference failed'});}
};
