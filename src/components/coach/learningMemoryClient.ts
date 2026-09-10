export interface LearningMemoryEntry {
 id:string;attemptId:string;modelId:string;runId:string;designId:string;
 text:string;createdAt:string;decisionId:string|null;cue:string|null;
}
export interface LearningMemory {
 kind:'subjective-cue-memory';sessionId:string;entries:LearningMemoryEntry[];
 scope:'subjective_not_physiological_evidence';
}
async function requestMemory(path:string,init:RequestInit):Promise<LearningMemory>{
 const response=await fetch('/api/learning/'+path,{cache:'no-store',...init});
 const value=await response.json();
 if(!response.ok)throw Error(value.error||'Learning memory is unavailable');
 if(value.kind!=='subjective-cue-memory'||value.scope!=='subjective_not_physiological_evidence'||!Array.isArray(value.entries))throw Error('Learning memory response is invalid');
 return value;
}
export const readLearningMemory=(signal?:AbortSignal)=>requestMemory('memory',{signal});
export const saveLearningSensation=(text:string)=>requestMemory('sensation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
