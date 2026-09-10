export interface VisualCapture {captureId:string;observationId:string;mediaSha256:string;mimeType:string}
export interface VisualFrame {frameIndex:number;ptsSeconds:number;width:number;height:number}
export interface VisualFrameIndex {captureId:string;mediaSha256:string;frames:VisualFrame[];rotationApplied:false}
export type VisualPixel=[number,number];
export interface VisualAnnotation {frameIndex:number;pose:string;assumedJA:number;visibility:'visible'|'occluded'|'missing';upperPixel:VisualPixel|null;lowerPixel:VisualPixel|null}
export interface VisualCamera {camera_id:string;rotation_3x3:number[][];scale_px_per_m:number}
export interface FrozenVisualForecast {model_id:string;calibration_status:string;targets:Array<{frame_id:string;media_sha256:string;video_frame_index:number;pose:string;assumed_JA:number}>;pairs:Array<{hypothesis_id:string;camera_id:string;calibration_rms_px:number|null;retained:boolean;target_vectors_px:number[][]}>;[key:string]:unknown}
export interface VisualScore {status:string;scores:Array<{hypothesis_id:string;camera_id:string;calibration_rms_px:number|null;heldout_rms_px:number|null}>;missing_frame_ids:string[];baseline_unchanged:true;[key:string]:unknown}
export interface VisualForecastRecord {artifact:{artifact:FrozenVisualForecast;sha256:string};baseline_model_id:string;baseline_snapshot_sha256:string;committed_at:string;status:string;score_result:{artifact:VisualScore;sha256:string}|null}
export interface VisualStatus {enabled:boolean;busy:boolean;captures:VisualCapture[];currentModelId:string|null;visualForecasts:Record<string,VisualForecastRecord>;latestResult?:{operation:string;forecastId:string;sessionId:string;baselineModelId:string;result:unknown;status:string}|null;error?:string}
export const readVisualStatus=(signal?:AbortSignal):Promise<VisualStatus>=>visualRequest('status',undefined,signal);
export function parseVisualCamera(id:string,rotation:string,scale:string):VisualCamera{
 const numbers=rotation.trim().split(/[\s,]+/).map(Number),factor=Number(scale);
 if(numbers.length!==9||numbers.some(value=>!Number.isFinite(value)))throw Error('Camera rotation needs nine finite numbers');
 if(!Number.isFinite(factor)||factor<=0)throw Error('Camera scale must be positive pixels per meter');
 return {camera_id:id,rotation_3x3:[numbers.slice(0,3),numbers.slice(3,6),numbers.slice(6,9)],scale_px_per_m:factor};
}
export function visualPixelAt(x:number,y:number,displayWidth:number,displayHeight:number,width:number,height:number):VisualPixel{
 return [Math.max(0,Math.min(width-1,Math.floor(x/displayWidth*width))),Math.max(0,Math.min(height-1,Math.floor(y/displayHeight*height)))];
}
export async function visualRequest(path:string,body?:unknown,signal?:AbortSignal){
 const response=await fetch('/api/visual/'+path,{cache:'no-store',signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Visual likelihood operation unavailable');return value;
}
export const indexVisualFrames=(captureId:string):Promise<VisualFrameIndex>=>visualRequest('frames',{captureId});
export const visualFrameUrl=(captureId:string,frameIndex:number)=>`/api/visual/frame?captureId=${encodeURIComponent(captureId)}&frameIndex=${frameIndex}`;
