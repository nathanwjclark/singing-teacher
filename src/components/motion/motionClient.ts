import type {TemporalResult,TemporalWarning} from './TemporalAnalysis'
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
export type MotionVowel='a'|'e'|'i'|'o'|'u';
export function motionAnalysisRequestIdentity(previous:{key:string;id:string}|null,captureId:string,pose:MotionVowel,modelId:string|null,analysisPolicy:string){
 const key=JSON.stringify([captureId,pose,modelId,analysisPolicy]);
 return previous?.key===key?previous:{key,id:crypto.randomUUID()};
}
export interface MotionCandidateScore {candidate_id:string;status:string;weighted_mean_square_discrepancy:number|null;missing_features?:Array<{reason:string;feature?:string}>}
export const rankMotionCandidates=(candidates:MotionCandidateScore[])=>[...candidates].sort((a,b)=>(a.weighted_mean_square_discrepancy??Infinity)-(b.weighted_mean_square_discrepancy??Infinity));
export interface MotionAudioResult {
 temporalAnalysis?:TemporalResult;
 analysisPolicy?:string;trajectoryBank?:{maxWindows:number;maxSynthesisCalls:number;pitchAnchorsHz:number[];maxPitchDistanceCents:number;synthesisRequests:number;interpretation:string};
 warnings?:TemporalWarning[];objective?:{rescoring:string;baseline:string;baselineDeclared:boolean;matchesBaseline:boolean};
 kind:'motion-pcm-fit-1';captureId:string;pose:MotionVowel;status:string;
 windows:Array<{index:number;startSample:number;measurement:unknown;status:string;reason?:string|null;pitchAnchorHz?:number;pitchDistanceCents?:number;
  fit?:{joint:{candidates:MotionCandidateScore[]}}|null}>;
 modelId:string;sessionId:string;actualSynthesisCalls:number;visualSync:'unknown';modelUpdated:false;
 hypothesisSubset:{selectedIds:string[];totalRetained:number;selection:string;rankingBasis?:string};assumptions:string[];
}
export interface MotionAnalysisStatus {
 status:'not-run'|'running'|'succeeded'|'failed'|'interrupted';analysisId?:string;error?:string;
 resultCurrent:boolean;currentModelId:string|null;analysisPolicy:string;
 result?:MotionAudioResult|null;availability:{available:boolean;reason:string|null};
}
/** A stored result from another analysis version has a different shape; it is reported, not rendered. */
export const earlierAnalysisVersion=(status:MotionAnalysisStatus)=>!!status.result&&status.result.analysisPolicy!==status.analysisPolicy;
export const readMotionAnalysis=(captureId:string,signal?:AbortSignal):Promise<MotionAnalysisStatus>=>request('analysis?captureId='+encodeURIComponent(captureId),{signal});
export const analyzeMotionAudio=(captureId:string,pose:MotionVowel,requestId:string):Promise<MotionAnalysisStatus>=>request('analyze',{
 method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,captureId,pose,containsExternalExcitation:false})
});
