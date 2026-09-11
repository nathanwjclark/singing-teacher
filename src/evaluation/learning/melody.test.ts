import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreMelody, validateMelody } from './melody.ts'
import { evaluateLearning, freezeLearningProtocol } from './index.ts'
import { exportLearningInterchange, learningInstruction } from '../../experiment/cues/interchange.ts'
import { CUE_LIBRARY } from '../../experiment/cues/library.ts'
import type { LearningAttempt, LearningMelody, LearningPitchSample } from '../../experiment/cues/types.ts'

const melody: LearningMelody = { policy: 'fixed-tempo-onset/1', notes: [{hz:220,durationMs:1000},{hz:330,durationMs:1000},{hz:275,durationMs:1000}], rhythmToleranceMs:200, minimumCoverage:.7, minimumNoteVoicedFraction:.7 }
function recording(durations=[1000,1000,1000], frequencies=[220,330,275]): LearningPitchSample[] {
  const total=durations.reduce((a,b)=>a+b,0), samples:LearningPitchSample[]=[]
  for(let time=-300;time<total+500;time+=100){let index=0,start=0;while(index<durations.length&&time>=start+durations[index]){start+=durations[index];index++}const hz=time<0||index>=durations.length?null:frequencies[index];samples.push({offsetMs:time+350,hz,status:hz===null?'unvoiced':'voiced',reason:hz===null?'Synthetic silence':null,windowMs:85})}
  return samples
}
test('fixed-time melody detects correct pitch/tempo; reports shifted notes, rhythm and absent final silence',()=>{
  const correct=scoreMelody(melody,recording(),50)
  assert.equal(correct.passed,true);assert.equal(correct.errorCents,0);assert.equal(correct.transitionErrorMs,0);assert.equal(correct.durationErrorMs,0)
  assert.equal(correct.onsetMs,350);assert.deepEqual(correct.notes.map(n=>n.voicedFraction),[1,1,1])
  const wrong=scoreMelody(melody,recording(undefined,[220,440,275]),50)
  assert.equal(wrong.passed,false);assert.ok(wrong.notes[1].errorCents!>490);assert.match(wrong.failures.join(),/no stable pitch transition/)
  const late=scoreMelody(melody,recording([1400,1000,1000]),50)
  assert.equal(late.transitionErrorMs,400);assert.equal(late.durationErrorMs,400);assert.equal(late.passed,false)
  assert.match(scoreMelody(melody,recording().filter(s=>s.offsetMs<3350),50).reasons.join(),/offset unavailable/)
})
test('unvoiced, missing, rejected and octave-wrong samples remain visible and do not pass',()=>{
  const samples=recording(), silence=samples.map(s=>({...s,hz:null,status:'unvoiced' as const}))
  assert.match(scoreMelody(melody,silence,50).reasons.join(),/No two consecutive voiced/)
  const gap=scoreMelody(melody,samples.filter(s=>s.offsetMs<1500||s.offsetMs>2100),50)
  assert.ok(gap.missingSamples>0);assert.equal(gap.passed,false);assert.match(gap.reasons.join(),/coverage/)
  const unvoiced=scoreMelody(melody,samples.map(s=>s.offsetMs>1500&&s.offsetMs<2200?{...s,hz:null,status:'unvoiced' as const}:s),50)
  assert.ok(unvoiced.unvoicedSamples>0);assert.equal(unvoiced.passed,false)
  const rejected=scoreMelody(melody,[...samples,{offsetMs:NaN,hz:220},{offsetMs:450,hz:220}],50)
  assert.equal(rejected.rejectedSamples,2);assert.equal(rejected.passed,false)
  const octave=scoreMelody(melody,recording(undefined,[440,660,550]),50)
  assert.ok(octave.notes.every(n=>n.errorCents===1200));assert.equal(octave.passed,false)
})
test('melodic constraints reject unsupported repeated notes, range, malformed and excessive duration',()=>{
  assert.throws(()=>validateMelody({...melody,notes:[melody.notes[0],melody.notes[0]]}),/Adjacent notes/)
  assert.throws(()=>validateMelody({...melody,notes:[{hz:50,durationMs:1000},melody.notes[1]]}),/65–1100/)
  assert.throws(()=>validateMelody({...melody,notes:[{hz:220,durationMs:NaN},melody.notes[1]]}),/500–4000/)
  assert.throws(()=>validateMelody({...melody,rhythmToleranceMs:50}),/100–500/)
})
test('target is digest-bound before capture; transfer scores melody, practice stays single note and export preserves score policy',async()=>{
  const protocol=await freezeLearningProtocol({schema:'singing-teacher/learning/1',id:'melodic-study',frozenAt:'2026-09-10T00:00:00Z',cue:{...CUE_LIBRARY[0],review:{reviewer:'Fictional software reviewer',role:'Software QA',evidence:'Development fixture, no clinical approval',reviewedAt:'2026-09-09T00:00:00Z'}},targetHz:220,toleranceCents:50,context:'comfortable ah, seated',phrase:'ah',retentionHours:24,minimumVoicedWindows:5,minimumVoicedFraction:.3,scoring:'melodic-pitch-rhythm/1',melody,sessionId:'session-test'})
  const practice:LearningAttempt={id:'practice',protocolId:protocol.id,protocolDigest:protocol.digest,sessionId:protocol.sessionId,arm:'baseline',phase:'prompted',startedAt:'2026-09-10T00:00:10Z',endedAt:'2026-09-10T00:00:15Z',deliveredWording:protocol.cue.wording,contextConfirmed:true,deviations:'',outcome:'completed',failureReason:null,recordingId:'recorded-practice',artifactId:'artifact-practice',artifactHash:'a'.repeat(64),filename:'fixture.wav',pitches:recording(undefined,[220,220,220]),sensation:{provenance:'learner-self-report',words:'Fictional test report',bodyRegion:'',effort:2,discomfort:false,recognizable:true,confidence:3},mnemonic:''}
  const transfer={...practice,id:'transfer',phase:'transfer' as const,startedAt:'2026-09-10T00:01:10Z',endedAt:'2026-09-10T00:01:15Z',deliveredWording:'',pitches:recording()}
  const scores=await evaluateLearning(protocol,[practice,transfer]);assert.ok(scores.every(s=>s.passed));assert.equal(scores[0].melody,undefined);assert.equal(scores[1].melody?.transitionErrorMs,0)
  assert.match(learningInstruction(protocol,'baseline','transfer'),/from memory/);assert.doesNotMatch(learningInstruction(protocol,'baseline','transfer'),/220|330|275/)
  const tampered=await evaluateLearning({...protocol,melody:{...melody,notes:[...melody.notes.slice(0,2),{hz:300,durationMs:1000}]}},[practice,transfer]);assert.equal(tampered[1].status,'excluded');assert.match(tampered[1].reasons.join(),/digest/)
  const kit=await exportLearningInterchange([protocol],[practice,transfer]);assert.equal(kit.omissions.length,0)
  const evaluation=kit.records.find(r=>r.kind==='transfer-evaluation')!;assert.equal(evaluation.kind,'transfer-evaluation');assert.equal(evaluation.kind==='transfer-evaluation'&&JSON.parse(evaluation.context.melodicScore).passed,true)
})
