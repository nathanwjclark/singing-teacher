export type Pixel=[number,number];
export interface LidarFrameInfo {sequence:number;width:number;height:number;calibration:unknown;depthFiltered:boolean;depthAccuracy:string;validPixels:number;rgbAvailable:boolean}
export interface LidarStatus {
 enabled:boolean;busy:boolean;capture:null|{captureId:string;importId:string;archiveSha256:string;manifestSha256:string;frames:LidarFrameInfo[]};
 currentModelId:string|null;result:LidarFitReceipt|null;lastSuccessfulResult?:LidarFitReceipt|null;lastSuccessfulResultCurrent?:boolean;error?:string;
}
export function currentLidarPreview(status:LidarStatus|null):LidarFitReceipt|null{
 if(!status?.currentModelId)return null;
 return [status.result,status.lastSuccessfulResult].find(receipt=>receipt?.adoption?.model_updated&&receipt.geometry?.modelId===status.currentModelId)??null;
}
export interface LidarFitReceipt {
 captureId:string;importId:string;archiveSha256:string;sessionId:string;parentModelId:string;modelId:string;jobId:string;fitId:string;status:string;includedInFit:boolean;
 result:{status:string;reason?:string;without_depth_order?:string[];with_depth_order?:string[];rankings?:Array<{hypothesis_id:string;depth_discrepancy:number|null;predictions:unknown}>;observed_distance_m?:number;actual_geometry_calls?:number;comparison?:unknown};
 adoption?:{status:string;model_updated:boolean};
 geometry?:{modelId:string;hypothesisId:string;pose:string;JA:number;files:Record<string,{sha256:string;byteLength:number}>};
}
export interface LidarFrame {width:number;height:number;depthM:Array<number|null>;sequence:number;calibration:unknown}
export interface LidarAnnotation {
 sourceKind:'human-observation'|'development-fixture';
 frameSequence:number;upperPixel:Pixel;lowerPixel:Pixel;depthToReference:number[][];
 referenceMappingExplanation:string;pose:string;jawValues:number[];jawWeights:number[];
 measurementSigmaM:number;modelSigmaM:number;uncertaintyExplanation:string;
 correspondenceExplanation:string;registrationExplanation:string;experimentalDeclaration:true;
}
export function parseNumbers(text:string,name:string):number[]{
 const values=text.trim().split(/[\s,]+/).map(Number);
 if(!text.trim()||values.some(value=>!Number.isFinite(value)))throw Error(name+' must contain finite numbers');
 return values;
}
export function parseDepthMapping(text:string):number[][]{
 const values=parseNumbers(text,'Depth mapping');if(values.length!==9)throw Error('Depth mapping needs nine numbers, one row after another');
 return [values.slice(0,3),values.slice(3,6),values.slice(6,9)];
}
export function depthPixelAt(x:number,y:number,displayWidth:number,displayHeight:number,width:number,height:number):Pixel{
 return [Math.max(0,Math.min(width-1,Math.floor(x/displayWidth*width))),Math.max(0,Math.min(height-1,Math.floor(y/displayHeight*height)))];
}
async function request(path:string,init?:RequestInit){
 const response=await fetch('/api/lidar/'+path,{cache:'no-store',...init});const value=await response.json();
 if(!response.ok)throw Error(value.error||'LiDAR operation unavailable');return value;
}
export const readLidarStatus=(signal?:AbortSignal):Promise<LidarStatus>=>request('status',{signal});
export const importLidarCapture=()=>request('import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
export const lidarFrameUrl=(captureId:string,sequence:number,kind:'frame'|'rgb')=>`/api/lidar/${kind}?captureId=${encodeURIComponent(captureId)}&sequence=${sequence}`;
export async function readLidarFrame(captureId:string,sequence:number,signal?:AbortSignal):Promise<LidarFrame>{
 const response=await fetch(lidarFrameUrl(captureId,sequence,'frame'),{cache:'no-store',signal});const value=await response.json();if(!response.ok)throw Error(value.error||'Depth frame unavailable');return value;
}
export const fitLidarCapture=(captureId:string,expectedModelId:string,annotation:LidarAnnotation,requestId:string)=>request('fit',{
 method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({captureId,expectedModelId,annotation,requestId})
});
export async function verifiedLidarGeometry(receipt:LidarFitReceipt):Promise<ArrayBuffer>{
 const expected=receipt.geometry?.files['space-diff.json'];if(!expected)throw Error('No bound depth-ranked geometry artifact');
 const response=await fetch('/api/lidar/artifact?fitId='+encodeURIComponent(receipt.fitId)+'&name=space-diff.json',{cache:'no-store'});
 if(!response.ok)throw Error('Depth-ranked geometry artifact unavailable');
 const bytes=await response.arrayBuffer();const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==expected.byteLength||sha!==expected.sha256)throw Error('Depth-ranked geometry byte size or hash mismatch');
 return bytes;
}
