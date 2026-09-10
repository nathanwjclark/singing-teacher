import { canonicalJson, sha256 } from '../../contracts/index.ts'
import type { LearningAttempt, LearningProtocol, LearningPhase, LearningArm } from '../../experiment/cues/types.ts'
export async function freezeLearningProtocol(input: Omit<LearningProtocol,'digest'>): Promise<LearningProtocol> {
  if(!input.cue.review?.reviewer.trim() || !input.cue.review.evidence.trim() || !input.cue.review.role.trim()) throw new Error('Record specialist review of both exact wordings first.')
  if(!(input.targetHz>=50&&input.targetHz<=1200&&input.toleranceCents>0&&input.toleranceCents<=300&&input.retentionHours>=1&&input.context.trim()&&input.phrase.trim())) throw new Error('Supply a comfortable 50–1200 Hz target, tolerance 1–300 cents, context, phrase and retention delay of at least one hour.')
  const snapshot=JSON.parse(canonicalJson(input)) as typeof input
  return Object.freeze({...snapshot,digest:await sha256(canonicalJson(snapshot))})
}
export interface LearningScore { attemptId:string; status:'scored'|'failed'|'excluded'; reasons:string[]; errorCents:number|null; passed:boolean; movementAgreement:null }
export async function evaluateLearning(protocol:LearningProtocol, attempts:LearningAttempt[]):Promise<LearningScore[]> {
  const {digest,...payload}=protocol
  const valid=await sha256(canonicalJson(payload))===digest
  return attempts.map(attempt=>{
    const reasons:string[]=[]
    if(!valid)reasons.push('Frozen protocol digest changed')
    if(attempt.protocolId!==protocol.id||attempt.protocolDigest!==digest)reasons.push('Protocol reference mismatch')
    if(!(Date.parse(attempt.startedAt)>Date.parse(protocol.frozenAt)))reasons.push('Capture did not begin after protocol freeze')
    if(!attempt.contextConfirmed||attempt.deviations.trim())reasons.push('Context changed or not confirmed')
    const expected=attempt.phase==='prompted'?(attempt.arm==='baseline'?protocol.cue.wording:protocol.cue.variant):''
    if(attempt.deliveredWording!==expected)reasons.push('Cue assistance differs from frozen protocol')
    if(!attempt.artifactId||!attempt.artifactHash||!attempt.recordingId)reasons.push('Missing recorded evidence')
    if(attempt.phase!=='prompted'&&!attempts.some(a=>a.arm===attempt.arm&&a.phase==='prompted'&&a.protocolId===protocol.id&&Date.parse(a.endedAt)<Date.parse(attempt.startedAt)))reasons.push('No earlier prompted attempt for this arm')
    if(attempt.phase==='retention'){
      const earlier=attempts.filter(a=>a.arm===attempt.arm&&a.phase!=='retention'&&a.protocolId===protocol.id&&Date.parse(a.endedAt)<Date.parse(attempt.startedAt))
      const latest=Math.max(...earlier.map(a=>Date.parse(a.endedAt)))
      if(!earlier.length||attempt.sessionId===protocol.sessionId||Date.parse(attempt.startedAt)-latest<protocol.retentionHours*3600000)reasons.push('Later-session retention delay not met')
    }
    const validPitch=attempt.pitches.filter(p=>p.hz!==null&&Number.isFinite(p.hz)&&p.hz>0)
    if(validPitch.length<protocol.minimumVoicedWindows||validPitch.length/Math.max(1,attempt.pitches.length)<protocol.minimumVoicedFraction)reasons.push('Insufficient voiced audio')
    const errors=validPitch.map(p=>Math.abs(1200*Math.log2(p.hz!/protocol.targetHz))).sort((a,b)=>a-b)
    const middle=Math.floor(errors.length/2)
    const errorCents=errors.length?(errors.length%2?errors[middle]:(errors[middle-1]+errors[middle])/2):null
    const failed=attempt.outcome!=='completed'||attempt.sensation.discomfort
    if(failed)reasons.push(attempt.failureReason||'Attempt stopped or discomfort reported')
    return {attemptId:attempt.id,status:failed?'failed':reasons.length?'excluded':'scored',reasons,errorCents:reasons.length?null:errorCents,passed:!reasons.length&&errorCents!==null&&errorCents<=protocol.toleranceCents,movementAgreement:null}
  })
}
export function compareLearning(attempts:LearningAttempt[],scores:LearningScore[]){
  const phases:LearningPhase[]=['prompted','recall','transfer','retention']
  return phases.map(phase=>({phase,arms:(['baseline','variant'] as LearningArm[]).map(arm=>{const group=attempts.filter(a=>a.phase===phase&&a.arm===arm);const results=group.map(a=>scores.find(s=>s.attemptId===a.id));return {arm,attempts:group.length,passed:results.filter(s=>s?.passed).length,failed:results.filter(s=>s?.status==='failed').length,excluded:results.filter(s=>s?.status==='excluded').length}})}))
}
