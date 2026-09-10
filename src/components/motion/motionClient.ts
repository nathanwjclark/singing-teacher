export interface MotionReceipt {
 id:string;observationId:string;attemptId:string;recordSha256:string;mediaSha256:string;
 mediaByteLength:number;mimeType:string;sampleCount:number;timingGaps:number;unsuccessfulMarkers:number;
 syncUncertaintyMs:null;missing:Record<string,string>;status:'retained-byte-verified';includedInPhysicalFit:false;interpretation:string;
}
export interface SavedMotionStatus {busy:boolean;capture:MotionReceipt|null;record:unknown}
async function request(path:string,init?:RequestInit){
 const response=await fetch('/api/motion/'+path,{cache:'no-store',...init});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Motion storage unavailable');return value;
}
export const readMotionStatus=():Promise<SavedMotionStatus>=>request('status');
export async function importMotionCapture(record:Blob,media:Blob,filename:string):Promise<{capture:MotionReceipt;reused:boolean}>{
 if(record.size>4*1024*1024)throw Error('Motion JSON exceeds the 4 MiB upload limit; download the local export instead');
 if(media.size>64*1024*1024)throw Error('Motion video exceeds the 64 MiB upload limit; download the local export instead');
 const body=new FormData();body.append('record',record,'motion.json');body.append('media',media,filename);
 return request('import',{method:'POST',body});
}
export const motionAssetUrl=(id:string,kind:'record'|'media')=>`/api/motion/${kind}?id=${encodeURIComponent(id)}`;
