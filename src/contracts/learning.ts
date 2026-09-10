/** Revision 6 interchange records. Independent versioning avoids changing KIT-01 v1 consumers. */
import type { Provenance } from './index'
export const LEARNING_VERSION = '1.0.0' as const
export interface LearningBase { schemaVersion: typeof LEARNING_VERSION; id: string; createdAt: string; provenance: Provenance }
export interface CueDefinition extends LearningBase { kind: 'cue-definition'; version: string; wording: string; allowedVariants: string[]; familiarAction: string; hypothesis: string; supportedEngineVariables: string[]; expectedObservables: string[]; sources: { url: string; evidenceLevel: string }[]; review: { status: 'candidate' | 'reviewed' | 'rejected'; reviewer: string | null; reviewedAt: string | null }; context: Record<string, string>; effortRule: string; restRule: string; stopRules: string[]; alternatives: string[] }
export interface CueAttempt extends LearningBase { kind: 'cue-attempt'; cueId: string; cueVersion: string; deliveredWording: string; goal: string; modelId: string | null; predictionId: string | null; context: Record<string, string>; startedAt: string; endedAt: string | null; repetition: number; captureIds: string[]; executionDeviations: string[]; outcome: 'completed' | 'unsuccessful' | 'stopped' | 'unknown' }
export interface SensationReport extends LearningBase { kind: 'sensation-report'; attemptId: string; words: string; bodyRegions: string[]; ease: number | null; effort: number | null; discomfort: string; confidence: number | null; recognizable: boolean | null; interpretation: 'subjective-self-report' }
export type MotionPhase = 'neutral' | 'gesture' | 'return'
export interface MotionPoint { name: string; image: [number, number] | null; headRelative: [number, number] | null; visibility: 'estimated-visible' | 'missing'; reason: string | null; confidence: number | null }
export interface MotionSample { id: string; captureMs: number; sourceTimestampMs: number; repetition: number; phase: MotionPhase; head: { center: [number, number]; rollRadians: number; scale: number; method: 'outer-eye-image-similarity' } | null; points: MotionPoint[]; gapBefore: boolean }
export interface MotionMarker { captureMs: number; repetition: number; type: 'task-start' | 'cue-delivery' | 'phase' | 'observed-onset' | 'observed-return' | 'unsuccessful' | 'stop' | 'task-end'; phase: MotionPhase; source: 'protocol' | 'user'; note: string }
export interface MotionObservation extends LearningBase { kind: 'motion-observation'; attemptId: string; cueId: string; cueVersion: string; context: Record<string,string>; samples: MotionSample[]; markers: MotionMarker[]; coordinateFrame: 'normalized-image-and-outer-eye-relative-2d'; timebase: { clock: 'browser-performance'; originMs: number; syncUncertaintyMs: null }; visibility: string; uncertainty: 'unquantified-image-estimates'; observedEnvelope: { name: string; min: [number,number]; max: [number,number]; samples: number }[]; media: { filename: string; mimeType: string; startedAtMs: number; syncUncertaintyMs: null; sha256?: string; byteLength?: number } | null; missing: { depth: 'not-supported'; internalGeometry: 'not-observed'; calibratedHeadPose: 'not-captured' }; interpretation: 'observed-visible-motion-not-anatomical-limits' }
export interface ControlProfile extends LearningBase { kind: 'control-profile'; cueId: string; cueVersion: string; context: Record<string,string>; attemptIds: string[]; reachableStates: { variable: string; values: number[]; unit: string }[]; repeatability: { value: number | null; method: string }; transitionTimingMs: number[]; learningHistory: string[]; competingExplanations: string[]; interpretation: 'cue-conditioned-control-not-anatomy' }
export interface TransferEvaluation extends LearningBase { kind: 'transfer-evaluation'; protocolId: string; frozenScoringId: string; baselineCueId: string; variantCueId: string; context: Record<string,string>; attemptIds: string[]; stage: 'cue-free-recall' | 'phrase-transfer' | 'later-session-retention'; acousticError: number | null; movementAgreement: number | null; effort: number | null; outcome: 'scored' | 'failed' | 'insufficient-evidence'; missingReasons: string[]; independentlyScored: boolean }

export type LearningRecord = CueDefinition | CueAttempt | SensationReport | MotionObservation | ControlProfile | TransferEvaluation
/** Validate imported/exported records before using them as evidence. */
export function validateLearningRecord(value: unknown): {valid: boolean; errors: string[]} {
 const errors:string[]=[]
 type Check=(v:unknown,p:string)=>void
 const fail=(p:string)=>{errors.push(`${p}: invalid or missing value`)}
 const str:Check=(v,p)=>{if(typeof v!=='string'||!v.trim())fail(p)}
 const num:Check=(v,p)=>{if(typeof v!=='number'||!Number.isFinite(v))fail(p)}
 const nonnegative:Check=(v,p)=>{num(v,p);if(typeof v==='number'&&v<0)fail(p)}
 const positive:Check=(v,p)=>{num(v,p);if(typeof v==='number'&&v<=0)fail(p)}
 const confidence:Check=(v,p)=>{nonnegative(v,p);if(typeof v==='number'&&v>1)fail(p)}
 const optional=(check:Check):Check=>(v,p)=>{if(v!==undefined)check(v,p)}
 const digest:Check=(v,p)=>{if(typeof v!=='string'||!/^([0-9a-f]{64})$/.test(v))fail(p)}
 const size:Check=(v,p)=>{positive(v,p);if(typeof v==='number'&&!Number.isSafeInteger(v))fail(p)}
 const bool:Check=(v,p)=>{if(typeof v!=='boolean')fail(p)}
 const one=(...xs:unknown[]):Check=>(v,p)=>{if(!xs.includes(v))fail(p)}
 const nullable=(check:Check):Check=>(v,p)=>{if(v!==null)check(v,p)}
 const list=(check:Check):Check=>(v,p)=>{if(!Array.isArray(v))fail(p);else v.forEach((x,i)=>check(x,`${p}[${i}]`))}
 const obj=(shape:Record<string,Check>):Check=>(v,p)=>{if(!v||typeof v!=='object'||Array.isArray(v)){fail(p);return}Object.entries(shape).forEach(([k,c])=>c((v as Record<string,unknown>)[k],`${p}.${k}`))}
 const context:Check=(v,p)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(p);else Object.entries(v).forEach(([k,x])=>str(x,`${p}.${k}`))}
 const xy:Check=(v,p)=>{if(!Array.isArray(v)||v.length!==2)fail(p);else v.forEach((x,i)=>num(x,`${p}[${i}]`))}
 const iso:Check=(v,p)=>{str(v,p);if(typeof v==='string'&&!Number.isFinite(Date.parse(v)))fail(p)}
 const base={schemaVersion:one(LEARNING_VERSION),id:str,createdAt:iso,provenance:obj({kind:one('human-observation','engine-generated','derived-measurement','development-fixture'),producer:str,producerVersion:str,sourceIds:list(str),sourceHashes:list(str)})}
 const phase=one('neutral','gesture','return')
 const checks:Record<LearningRecord['kind'],Check>={
  'cue-definition':obj({...base,version:str,wording:str,allowedVariants:list(str),familiarAction:str,hypothesis:str,supportedEngineVariables:list(str),expectedObservables:list(str),sources:list(obj({url:str,evidenceLevel:str})),review:obj({status:one('candidate','reviewed','rejected'),reviewer:nullable(str),reviewedAt:nullable(iso)}),context,effortRule:str,restRule:str,stopRules:list(str),alternatives:list(str)}),
  'cue-attempt':obj({...base,cueId:str,cueVersion:str,deliveredWording:str,goal:str,modelId:nullable(str),predictionId:nullable(str),context,startedAt:iso,endedAt:nullable(iso),repetition:nonnegative,captureIds:list(str),executionDeviations:list(str),outcome:one('completed','unsuccessful','stopped','unknown')}),
  'sensation-report':obj({...base,attemptId:str,words:str,bodyRegions:list(str),ease:nullable(nonnegative),effort:nullable(nonnegative),discomfort:(v,p)=>{if(typeof v!=='string')fail(p)},confidence:nullable(nonnegative),recognizable:nullable(bool),interpretation:one('subjective-self-report')}),
  'motion-observation':obj({...base,attemptId:str,cueId:str,cueVersion:str,context,samples:list(obj({id:str,captureMs:nonnegative,sourceTimestampMs:nonnegative,repetition:nonnegative,phase,head:nullable(obj({center:xy,rollRadians:num,scale:positive,method:one('outer-eye-image-similarity')})),points:list(obj({name:str,image:nullable(xy),headRelative:nullable(xy),visibility:one('estimated-visible','missing'),reason:nullable(str),confidence:nullable(confidence)})),gapBefore:bool})),markers:list(obj({captureMs:nonnegative,repetition:nonnegative,type:one('task-start','cue-delivery','phase','observed-onset','observed-return','unsuccessful','stop','task-end'),phase,source:one('protocol','user'),note:str})),coordinateFrame:one('normalized-image-and-outer-eye-relative-2d'),timebase:obj({clock:one('browser-performance'),originMs:nonnegative,syncUncertaintyMs:one(null)}),visibility:str,uncertainty:one('unquantified-image-estimates'),observedEnvelope:list(obj({name:str,min:xy,max:xy,samples:nonnegative})),media:nullable(obj({filename:str,mimeType:str,startedAtMs:nonnegative,syncUncertaintyMs:one(null),sha256:optional(digest),byteLength:optional(size)})),missing:obj({depth:one('not-supported'),internalGeometry:one('not-observed'),calibratedHeadPose:one('not-captured')}),interpretation:one('observed-visible-motion-not-anatomical-limits')}),
  'control-profile':obj({...base,cueId:str,cueVersion:str,context,attemptIds:list(str),reachableStates:list(obj({variable:str,values:list(num),unit:str})),repeatability:obj({value:nullable(nonnegative),method:str}),transitionTimingMs:list(nonnegative),learningHistory:list(str),competingExplanations:list(str),interpretation:one('cue-conditioned-control-not-anatomy')}),
  'transfer-evaluation':obj({...base,protocolId:str,frozenScoringId:str,baselineCueId:str,variantCueId:str,context,attemptIds:list(str),stage:one('cue-free-recall','phrase-transfer','later-session-retention'),acousticError:nullable(num),movementAgreement:nullable(num),effort:nullable(nonnegative),outcome:one('scored','failed','insufficient-evidence'),missingReasons:list(str),independentlyScored:bool})
 }
 const kind=value&&typeof value==='object'?(value as {kind?:unknown}).kind:undefined
 if(typeof kind!=='string'||!Object.hasOwn(checks,kind))return {valid:false,errors:['Unknown learning record kind']}
 checks[kind as LearningRecord['kind']](value,'record')
 if(errors.length)return {valid:false,errors}
 const record=value as LearningRecord
 if(record.kind==='cue-definition'&&record.review.status==='reviewed'&&(!record.review.reviewer||!record.review.reviewedAt||!record.sources.length))errors.push('Reviewed cues require reviewer, review time and evidence sources')
 if(record.kind==='sensation-report'&&record.provenance.kind!=='human-observation')errors.push('Sensation reports require human-observation provenance')
 if(record.kind==='motion-observation'){
  if(record.media){
   const hasHash=record.media.sha256!==undefined,hasSize=record.media.byteLength!==undefined
   if(hasHash!==hasSize)errors.push('Media integrity requires both SHA-256 and byte length')
   if(hasHash&&!record.provenance.sourceHashes.includes(record.media.sha256!))errors.push('Media digest must be bound to observation provenance')
  }
  let previousMarker=-Infinity
  record.markers.forEach(marker=>{if(marker.captureMs<previousMarker)errors.push('Motion markers must be in chronological order');previousMarker=marker.captureMs})
  const end=record.markers.find(marker=>marker.type==='stop'||marker.type==='task-end')?.captureMs
  if(end!==undefined&&(record.markers.some(marker=>marker.captureMs>end)||record.samples.some(sample=>sample.captureMs>end)||(record.media?.startedAtMs??0)>end))errors.push('Motion samples, markers and media start must not follow capture end')
  const ids=new Set<string>();let previous=-Infinity
  record.samples.forEach(s=>{if(ids.has(s.id)||s.sourceTimestampMs<=previous)errors.push('Motion samples require unique evidence IDs and strictly increasing source timestamps');ids.add(s.id);previous=s.sourceTimestampMs;if(Math.abs(s.captureMs-(s.sourceTimestampMs-record.timebase.originMs))>.001)errors.push('Motion source and relative timestamps disagree');s.points.forEach(p=>{if((p.visibility==='missing')!==(p.image===null))errors.push('Missing point visibility must agree with missing image coordinates');if(p.visibility==='missing'&&(!p.reason||p.headRelative))errors.push('Missing points need reasons and cannot contain head-relative geometry');if(p.headRelative&&!s.head)errors.push('Head-relative points require declared head references')})})
 }
 return {valid:errors.length===0,errors}
}
