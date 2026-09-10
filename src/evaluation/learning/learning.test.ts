import test from 'node:test'
import assert from 'node:assert/strict'
import {freezeLearningProtocol,evaluateLearning,compareLearning} from './index.ts'
import {CUE_LIBRARY} from '../../experiment/cues/library.ts'
import type {LearningAttempt} from '../../experiment/cues/types.ts'
const config={schema:'singing-teacher/learning/1' as const,id:'protocol',frozenAt:'2026-09-10T00:00:00Z',cue:{...CUE_LIBRARY[0],review:{reviewer:'Fixture reviewer',role:'test fixture only',evidence:'Synthetic review for software test; not approval',reviewedAt:'2026-09-09T00:00:00Z'}},targetHz:220,toleranceCents:50,context:'ah seated easy',phrase:'Hello',retentionHours:24,minimumVoicedWindows:5,minimumVoicedFraction:.3,scoring:'median-absolute-cents/1' as const,sessionId:'session-one'}
function attempt(digest:string):LearningAttempt{return {id:'attempt',protocolId:'protocol',protocolDigest:digest,sessionId:'session-one',arm:'baseline',phase:'prompted',startedAt:'2026-09-10T00:01:00Z',endedAt:'2026-09-10T00:01:02Z',deliveredWording:config.cue.wording,contextConfirmed:true,deviations:'',outcome:'completed',failureReason:null,recordingId:'record',artifactId:'artifact',artifactHash:'f'.repeat(64),filename:'test.wav',pitches:Array.from({length:10},(_,i)=>({offsetMs:i*100,hz:220})),sensation:{provenance:'learner-self-report',words:'fixture',bodyRegion:'',effort:2,discomfort:false,recognizable:true,confidence:3},mnemonic:'fixture'}}
test('cue review is required and frozen payload tampering excludes scoring',async()=>{await assert.rejects(freezeLearningProtocol({...config,cue:CUE_LIBRARY[0]}));const p=await freezeLearningProtocol(config);const scores=await evaluateLearning({...p,targetHz:440},[attempt(p.digest)]);assert.equal(scores[0].status,'excluded');assert.match(scores[0].reasons.join(),/digest/)})
test('score real-evidence references, retain failed/unvoiced/missing/context drift, and do not turn sensation into physiology',async()=>{const p=await freezeLearningProtocol(config),good=attempt(p.digest);const failed={...good,id:'failed',outcome:'failed' as const,failureReason:'Could not reproduce'};const silent={...good,id:'silent',pitches:[]};const missing={...good,id:'missing',artifactHash:null};const changed={...good,id:'changed',deviations:'changed pitch'};const list=[good,failed,silent,missing,changed];const scores=await evaluateLearning(p,list);assert.equal(scores[0].errorCents,0);assert.equal(scores[0].passed,true);assert.equal(scores[0].movementAgreement,null);assert.deepEqual(scores.map(s=>s.status),['scored','failed','excluded','excluded','excluded']);assert.equal(compareLearning(list,scores)[0].arms[0].attempts,5)})
test('recall hides wording and retention needs separate session and elapsed time after practice',async()=>{const p=await freezeLearningProtocol(config),practice=attempt(p.digest);const recall={...practice,id:'recall',phase:'recall' as const,startedAt:'2026-09-10T00:02:00Z',endedAt:'2026-09-10T00:02:02Z',deliveredWording:''};const assisted={...recall,id:'assisted',deliveredWording:config.cue.wording};const early={...recall,id:'early',phase:'retention' as const,sessionId:'session-two'};const later={...early,id:'later',startedAt:'2026-09-11T00:03:00Z',endedAt:'2026-09-11T00:03:02Z'};const scores=await evaluateLearning(p,[practice,recall,assisted,early,later]);assert.equal(scores[1].status,'scored');assert.equal(scores[2].status,'excluded');assert.equal(scores[3].status,'excluded');assert.equal(scores[4].status,'scored')})

test('KIT export is validated and keeps unknown physiology, failed attempts and actual subjective words',async()=>{
 const {exportLearningInterchange}=await import('../../experiment/cues/interchange.ts')
 const {validateLearningRecord}=await import('../../contracts/learning.ts')
 const p=await freezeLearningProtocol(config),practice=attempt(p.digest)
 const recall={...practice,id:'recall',phase:'recall' as const,startedAt:'2026-09-10T00:02:00Z',endedAt:'2026-09-10T00:02:02Z',deliveredWording:'',outcome:'failed' as const,failureReason:'Learner could not reproduce'}
 const bundle=await exportLearningInterchange([p,p],[practice,recall])
 assert.equal(bundle.records.filter(r=>r.kind==='cue-definition').length,2)
 assert.equal(bundle.omissions.length,0)
 assert.ok(bundle.records.every(r=>validateLearningRecord(r).valid))
 const cueAttempt=bundle.records.find(r=>r.kind==='cue-attempt'&&r.id==='recall')!
 assert.equal(cueAttempt.kind==='cue-attempt'&&cueAttempt.modelId,null)
 assert.equal(cueAttempt.kind==='cue-attempt'&&cueAttempt.outcome,'unsuccessful')
 const score=bundle.records.find(r=>r.kind==='transfer-evaluation')!
 assert.equal(score.kind==='transfer-evaluation'&&score.outcome,'failed')
 assert.equal(score.kind==='transfer-evaluation'&&score.movementAgreement,null)
 assert.equal(bundle.records.some(r=>r.kind==='control-profile'||r.kind==='motion-observation'),false)
 const missingWords=await exportLearningInterchange([p],[{...practice,sensation:{...practice.sensation,words:''}}])
 assert.equal(missingWords.records.some(r=>r.kind==='sensation-report'),false)
 assert.match(missingWords.omissions.join(),/no verbal sensation/)
})
