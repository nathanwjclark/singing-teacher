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

export const recomputationOutcomes=['matched','failed','unavailable','unsupported','skipped'] as const;
export type RecomputationOutcome=typeof recomputationOutcomes[number];
export interface SessionRecomputationOperation {
 jobId:string;operation:string;originalStatus:string;outcome:RecomputationOutcome;status:string;reason?:string;
 numericalAgreement:boolean|null;policyVerification:'verified'|'legacy_version_unverified'|'unverified';
 requestSha256:string;originalResultSha256:string;details?:Record<string,unknown>;
}
export interface SessionRecomputationReport {
 schemaVersion:'session-recomputation/1';attemptId:string;sessionId:string;runId:string;createdAt:string;
 workerLedgerSha256:string;modelUpdated:false;rawMediaIncluded:false;
 counts:Record<RecomputationOutcome,number>&{total:number;scoring:number;policyVerified:number;legacyVersionUnverified:number};
 operations:SessionRecomputationOperation[];limitations:string[];
 budget:{maximumScoringOperations:number;maximumWallSeconds:number;synthesisCalls:0;geometryCalls:0;canonicalExtractions:number;elapsedSeconds:number};
}
export interface SessionRecomputationStatus {
 status:'not-run'|'running'|'completed'|'failed'|'unavailable';reason?:string;attemptId?:string;
 sessionId?:string;runId?:string;reportSha256?:string;report?:SessionRecomputationReport;
}
async function recomputationResponse(response:Response):Promise<SessionRecomputationStatus>{
 const value=await response.json();if(!response.ok)throw Error(value.error||'Numerical verification unavailable');
 if(!['not-run','running','completed','failed','unavailable'].includes(value.status))throw Error('Invalid numerical verification status');
 const report=value.report;
 // Every retained operation falls in exactly one outcome, so the counts must add up.
 if(value.status==='completed'&&(!report||report.schemaVersion!=='session-recomputation/1'||!Array.isArray(report.operations)||!report.counts||report.modelUpdated!==false||report.rawMediaIncluded!==false||report.attemptId!==value.attemptId||report.sessionId!==value.sessionId
  ||recomputationOutcomes.some(name=>!Number.isInteger(report.counts[name]))||recomputationOutcomes.reduce((sum,name)=>sum+report.counts[name],0)!==report.counts.total||report.operations.length!==report.counts.total))throw Error('Invalid numerical verification report');
 return value;
}
export async function readSessionRecomputation(signal?:AbortSignal):Promise<SessionRecomputationStatus>{
 return recomputationResponse(await fetch('/api/session-recompute/status',{cache:'no-store',signal}));
}
export async function startSessionRecomputation(requestId:string,maxOperations=16):Promise<SessionRecomputationStatus>{
 return recomputationResponse(await fetch('/api/session-recompute/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,maxOperations})}));
}
