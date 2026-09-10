export interface SessionReplayExport {
 schemaVersion:'singing-session-export/1';exportedAt:string;runId:string;sessionId:string;
 status:'complete'|'partial';
 summary:{modelId:string|null;sessionVersion:number|null;eventCount:number;decisionCount:number;attemptCount:number;scoreCount:number;probeFitCount:number};
 missing:Array<{source:string;reason:string}>;
 replay:object|null;
 artifacts:Array<{source:string;sha256:string;byteLength:number;data:unknown}>;
 omissions:Array<{path:string;reason:string}>;
 limits:{rawMediaIncluded:false;scientificAccuracyValidated:false};
 workerLedgerSha256:string|null;
}
export async function readSessionReplay(signal?:AbortSignal):Promise<SessionReplayExport>{
 const response=await fetch('/api/session-export',{cache:'no-store',signal});
 const value=await response.json();
 if(!response.ok)throw Error(value.error||'Session export unavailable');
 if(value.schemaVersion!=='singing-session-export/1'||!value.summary||!Array.isArray(value.missing)||!Array.isArray(value.artifacts)||!Array.isArray(value.omissions))throw Error('Invalid session export response');
 return value;
}
export const sessionReplayJson=(value:SessionReplayExport)=>JSON.stringify(value,null,2)+'\n';
