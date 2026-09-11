import test from 'node:test'
import assert from 'node:assert/strict'
import { MELODY_HOP_MS, mirexHit, scoreMelody, validateMelody } from './melody.ts'
import { compareLearning, evaluateLearning, freezeLearningProtocol } from './index.ts'
import { exportLearningInterchange, learningInstruction } from '../../experiment/cues/interchange.ts'
import { CUE_LIBRARY } from '../../experiment/cues/library.ts'
import type { LearningAttempt, LearningMelody, LearningPitchSample } from '../../experiment/cues/types.ts'

// Synthetic pitch tracks (input data only): one sample every hop, centered at 10 + 20·i ms, content taken at the center.
const melody: LearningMelody = { policy: 'anchored-note-changes/1', notes: [{hz:220,durationMs:1000},{hz:330,durationMs:1000},{hz:275,durationMs:1000}], rhythmToleranceMs:200, minimumNoteVoicedFraction:.5, maximumBreathMs:250, maximumLeadInVoicedMs:1000 }
type Part = [hz: number | null, ms: number]
function track(parts: Part[], { lead = 400, tail = 500 } = {}): LearningPitchSample[] {
  const timeline: Part[] = [[null,lead], ...parts, [null,tail]], total = timeline.reduce((sum,[,ms]) => sum+ms, 0), samples: LearningPitchSample[] = []
  for (let offsetMs = MELODY_HOP_MS/2; offsetMs < total; offsetMs += MELODY_HOP_MS) {
    let at = 0, hz: number | null = null
    for (const [value,ms] of timeline) { if (offsetMs < at+ms) { hz = value; break } at += ms }
    samples.push({ offsetMs, hz, status: hz === null ? 'unvoiced' : 'voiced', windowMs: 85.3 })
  }
  return samples
}
const sung = (hz = [220,330,275], ms = [1000,1000,1000]): Part[] => hz.map((value,i) => [value, ms[i]])

test('a correct performance passes with mir_eval frame metrics and per-note timing', () => {
  const score = scoreMelody(melody, track(sung()), 50)
  assert.equal(score.status, 'scored'); assert.equal(score.passed, true); assert.deepEqual(score.failures, [])
  assert.equal(score.anchor, 'note-1'); assert.equal(score.onsetMs, 400); assert.equal(score.errorCents, 0)
  assert.equal(score.transitionErrorMs, 0); assert.equal(score.offsetObserved, true); assert.equal(score.durationErrorMs, 0)
  assert.equal(score.leadInVoicedMs, 0)
  assert.deepEqual(score.frames, { referenceVoicedFrames: 150, referenceUnvoicedFrames: 45, rawPitchAccuracy: 1, rawChromaAccuracy: 1, voicingRecall: 1, voicingFalseAlarm: 0 })
  assert.deepEqual(score.notes.map(n => [n.observedStartMs, n.voicedFraction]), [[0,1],[1000,1],[2000,1]])
})

test('forgotten last note is incomplete and the attempt fails, not excluded', () => {
  const score = scoreMelody(melody, track(sung([220,330],[1000,1000]), { tail: 1500 }), 50)
  assert.equal(score.status, 'incomplete'); assert.equal(score.passed, false)
  assert.match(score.reasons.join(), /Note 3 not sung: 0% of its time voiced/)
  assert.equal(score.offsetObserved, true); assert.equal(score.durationErrorMs, 1000)
  const heldOver = scoreMelody(melody, track(sung([220,330],[1000,1100]), { tail: 1500 }), 50)
  assert.equal(heldOver.status, 'incomplete'); assert.match(heldOver.reasons.join(), /Note 3 not sung: 10% of its time voiced/)
})

test('a confidently wrong note is scored as a non-pass with only that note failing pitch', () => {
  const score = scoreMelody(melody, track(sung([220,440,275])), 50)
  assert.equal(score.status, 'scored'); assert.equal(score.passed, false)
  assert.deepEqual(score.notes.map(n => Math.round(n.errorCents!)), [0,498,0])
  assert.equal(Math.round(score.errorCents!), 498); assert.equal(score.transitionErrorMs, 0); assert.deepEqual(score.failures, ['Note 2: pitch error 498 cents exceeds 50'])
  assert.ok(score.frames!.rawPitchAccuracy! < .7)
})

test('a note moved in the wrong direction is a scored non-pass without a located transition', () => {
  const score = scoreMelody(melody, track(sung([220,196,275],[1000,1100,900])), 50)
  assert.equal(score.status, 'scored'); assert.equal(score.passed, false); assert.equal(score.notes[1].observedStartMs, null)
  assert.match(score.failures.join(), /Note 2: no sustained move toward the declared pitch/)
})

test('wrong rhythm is scored: a late change and a long phrase fail the rhythm tolerance', () => {
  const score = scoreMelody(melody, track(sung(undefined,[1400,1000,1000])), 50)
  assert.equal(score.status, 'scored'); assert.equal(score.passed, false)
  assert.deepEqual(score.notes.map(n => n.transitionErrorMs), [0,400,400]); assert.equal(score.durationErrorMs, 400)
  assert.deepEqual(score.notes.map(n => n.errorCents), [0,0,0])
})

test('broken evidence is unusable: no samples, rejected audio, internal gaps and silent captures', () => {
  const samples = track(sung())
  assert.match(scoreMelody(melody, [], 50).reasons.join(), /No decoded pitch samples/)
  const rejected = scoreMelody(melody, [...samples.slice(0,50), { offsetMs: NaN, hz: 220 }, { ...samples[60], status: 'rejected', hz: null }, ...samples.slice(61)], 50)
  assert.equal(rejected.status, 'unusable'); assert.equal(rejected.rejectedSamples, 2)
  const gap = scoreMelody(melody, samples.filter(s => s.offsetMs < 1500 || s.offsetMs > 1700), 50)
  assert.equal(gap.status, 'unusable'); assert.equal(gap.missingSamples, 10); assert.match(gap.reasons.join(), /missing inside the recording/)
  const silent = scoreMelody(melody, samples.map(s => ({ ...s, hz: null, status: 'unvoiced' as const })), 50)
  assert.equal(silent.status, 'unusable'); assert.match(silent.reasons.join(), /silent microphone/)
})

test('a short hum before singing does not move the anchor', () => {
  for (const hum of [220, 180]) {
    const score = scoreMelody(melody, track([[hum,200],[null,300],...sung()], { lead: 200 }), 50)
    assert.equal(score.passed, true, `hum at ${hum} Hz`); assert.equal(score.onsetMs, 700); assert.equal(score.transitionErrorMs, 0)
  }
  const joined = scoreMelody(melody, track([[180,200],...sung()]), 50)
  assert.equal(joined.passed, true); assert.equal(joined.onsetMs, 600)
})

test('500 ms notes: a late change within tolerance leaves pitch bins uncontaminated', () => {
  const short: LearningMelody = { ...melody, notes: melody.notes.map(n => ({ ...n, durationMs: 500 })) }
  const score = scoreMelody(short, track([[220,660],[330,340],[275,500]]), 50)
  assert.equal(score.passed, true); assert.deepEqual(score.notes.map(n => n.errorCents), [0,0,0])
  assert.deepEqual(score.notes.map(n => n.transitionErrorMs), [0,160,0])
  const glide = scoreMelody(short, track([[220,580],[262,40],[330,380],[275,500]]), 50)
  assert.equal(glide.passed, true); assert.deepEqual(glide.notes.map(n => n.errorCents), [0,0,0])
})

test('transposed performances fail absolute pitch and report the shift; octave slips show as chroma-only matches', () => {
  const up = scoreMelody(melody, track(sung([220,330,275].map(hz => hz*2**(200/1200)))), 50)
  assert.equal(up.status, 'scored'); assert.equal(up.passed, false); assert.equal(up.anchor, 'first-stable-pitch'); assert.equal(up.transposedCents, 200)
  assert.match(up.failures.join(), /Sung transposed by 200 cents/)
  const octave = scoreMelody(melody, track(sung([110,165,137.5])), 50)
  assert.equal(octave.transposedCents, -1200); assert.equal(octave.frames!.rawPitchAccuracy, 0); assert.equal(octave.frames!.rawChromaAccuracy, 1)
  const wrong = scoreMelody(melody, track(sung([247,300,262])), 50)
  assert.equal(wrong.anchor, 'first-stable-pitch'); assert.equal(wrong.transposedCents, null); assert.equal(wrong.passed, false)
  const slips = track(sung()).map((s,i) => i % 10 === 5 && s.hz ? { ...s, hz: s.hz/2 } : s)
  const slipped = scoreMelody(melody, slips, 50)
  assert.equal(slipped.passed, true); assert.ok(slipped.frames!.rawPitchAccuracy! < 1); assert.equal(slipped.frames!.rawChromaAccuracy, 1)
})

test('phrase ending at the end of audio: offset unknown is neither a failure nor a pass', () => {
  const censored = scoreMelody(melody, track(sung(), { tail: 0 }), 50)
  assert.equal(censored.status, 'unusable'); assert.equal(censored.passed, false); assert.equal(censored.offsetObserved, false)
  assert.equal(censored.durationErrorMs, null); assert.equal(censored.observedDurationMs, 3000); assert.match(censored.reasons.join(), /Phrase end not observed/)
  const shortTail = scoreMelody(melody, track(sung(), { tail: 100 }), 50)
  assert.equal(shortTail.status, 'unusable'); assert.equal(shortTail.offsetObserved, false)
  // Exclusion never depends on the outcome: a wrong note or an overlong phrase with no observed end is still excluded.
  const wrongAndCensored = scoreMelody(melody, track(sung([220,440,275]), { tail: 0 }), 50)
  assert.equal(wrongAndCensored.status, 'unusable'); assert.match(wrongAndCensored.failures.join(), /Note 2: pitch error/)
  const stoppedMidPhrase = scoreMelody(melody, track(sung([220,330],[1000,600]), { tail: 0 }), 50)
  assert.equal(stoppedMidPhrase.status, 'unusable'); assert.equal(stoppedMidPhrase.notes[2].voicedFraction, null); assert.ok(stoppedMidPhrase.missingSamples > 0)
  const heldTooLong = scoreMelody(melody, track(sung(undefined,[1000,1000,1500]), { tail: 0 }), 50)
  assert.equal(heldTooLong.status, 'unusable'); assert.equal(heldTooLong.observedDurationMs, 3500)
})

test('vibrato is scored by its centre: ±40, ±80 and ±100 cents around the target pass; an off-centre note fails', () => {
  const vibrato = (extent: number, centre = 0) => track(sung()).map(s => s.hz ? { ...s, hz: s.hz*2**((centre+extent*Math.sin(2*Math.PI*5.5*s.offsetMs/1000))/1200) } : s)
  for (const extent of [40, 80, 100]) {
    const score = scoreMelody(melody, vibrato(extent), 50)
    assert.equal(score.passed, true, `±${extent} cents`); assert.ok(score.errorCents! < 15, `±${extent}: ${score.errorCents}`); assert.ok(score.transitionErrorMs! <= 40)
  }
  const flat = scoreMelody(melody, vibrato(80, -60), 50)
  assert.equal(flat.passed, false); assert.ok(flat.notes.every(n => Math.abs(n.errorCents!-60) < 15))
})

test('singing before note 1 is reported, counted as voicing false alarm and fails beyond the frozen bound', () => {
  const hunting: Part[] = Array.from({ length: 6 }, (_,i) => [i % 2 ? 196 : 247, 500] as Part)
  const hunted = scoreMelody(melody, track([...hunting, ...sung()]), 50)
  assert.equal(hunted.status, 'scored'); assert.equal(hunted.passed, false); assert.equal(hunted.leadInVoicedMs, 3000)
  assert.match(hunted.failures.join(), /3000 ms voiced before note 1 was held \(allowed 1000 ms\)/); assert.equal(hunted.frames!.voicingFalseAlarm, 150/195)
  const retry = scoreMelody(melody, track([...sung([220,330,275].map(hz => hz*2**(200/1200))), [null,400], ...sung()]), 50)
  assert.equal(retry.passed, false); assert.equal(retry.leadInVoicedMs, 3000)
  const brief = scoreMelody(melody, track([[196,600], ...sung()]), 50)
  assert.equal(brief.passed, true); assert.equal(brief.leadInVoicedMs, 600)
})

test('a breath inside the last note shorter than the frozen allowance keeps the phrase; a longer gap ends it', () => {
  const breath = scoreMelody(melody, track([...sung([220,330],[1000,1000]), [275,400], [null,240], [275,360]]), 50)
  assert.equal(breath.passed, true); assert.equal(breath.observedDurationMs, 3000); assert.ok(breath.notes[2].voicedFraction! < 1)
  const gap = scoreMelody(melody, track([...sung([220,330],[1000,1000]), [275,400], [null,300], [275,300]]), 50)
  assert.equal(gap.passed, false); assert.equal(gap.observedDurationMs, 2400); assert.match(gap.failures.join(), /Phrase lasts 2400 ms/)
})

test('raw pitch and chroma accuracy use mir_eval\'s strict 50-cent threshold', () => {
  assert.equal(mirexHit(49.999), true); assert.equal(mirexHit(50), false); assert.equal(mirexHit(-50), false)
})

test('melody declarations reject unsupported repeated notes, range, malformed values and ambiguous tolerance', () => {
  assert.throws(() => validateMelody({ ...melody, notes: [melody.notes[0],melody.notes[0]] }, 50), /Adjacent notes/)
  assert.throws(() => validateMelody({ ...melody, notes: [{hz:50,durationMs:1000},melody.notes[1]] }, 50), /65–1100/)
  assert.throws(() => validateMelody({ ...melody, notes: [{hz:220,durationMs:NaN},melody.notes[1]] }, 50), /500–4000/)
  assert.throws(() => validateMelody({ ...melody, rhythmToleranceMs: 50 }, 50), /100–500/)
  assert.throws(() => validateMelody({ ...melody, policy: 'fixed-tempo-onset/1' as LearningMelody['policy'] }, 50), /2–8 notes/)
  assert.throws(() => validateMelody(melody, 200), /less than half the smallest adjacent interval \(315\.64 cents\)/)
  // Semitones entered to 0.01 Hz land a few hundredths of a cent short of 100 and must be accepted.
  // The tolerance must be strictly below half the actual interval, so a 99.99-cent step needs less than 50 cents.
  for (const notes of [[{hz:261.63,durationMs:800},{hz:277.18,durationMs:800}],[{hz:220,durationMs:800},{hz:233.08,durationMs:800}]]) {
    assert.doesNotThrow(() => validateMelody({ ...melody, notes }, 49.9))
    assert.throws(() => validateMelody({ ...melody, notes }, 50), /less than half the smallest adjacent interval \(99\.9\d cents\)/)
  }
  const nearSemitone = [{hz:220,durationMs:800},{hz:220*2**(99.6/1200),durationMs:800}]
  assert.throws(() => validateMelody({ ...melody, notes: nearSemitone }, 49.8), /less than half/); assert.doesNotThrow(() => validateMelody({ ...melody, notes: nearSemitone }, 49.79))
  assert.throws(() => validateMelody({ ...melody, notes: [{hz:220,durationMs:800},{hz:232.9,durationMs:800}] }, 50), /Adjacent notes/)
  assert.throws(() => validateMelody({ ...melody, maximumBreathMs: 300 }, 50), /breaths of 0–250 ms/)
})

test('frozen melody: prompted and transfer score the melody, recall stays single note, statuses separate failure from exclusion, export keeps lineage', async () => {
  const protocol = await freezeLearningProtocol({ schema:'singing-teacher/learning/1', id:'melodic-study', frozenAt:'2026-09-10T00:00:00Z', cue:{ ...CUE_LIBRARY[0], review:{ reviewer:'Fictional software reviewer', role:'Software QA', evidence:'Development fixture, no clinical approval', reviewedAt:'2026-09-09T00:00:00Z' } }, targetHz:220, toleranceCents:50, context:'comfortable ah, seated', phrase:'ah', retentionHours:24, minimumVoicedWindows:5, minimumVoicedFraction:.3, scoring:'melodic-pitch-rhythm/1', melody, sessionId:'session-test' })
  const practice: LearningAttempt = { id:'practice', protocolId:protocol.id, protocolDigest:protocol.digest, sessionId:protocol.sessionId, arm:'baseline', phase:'prompted', startedAt:'2026-09-10T00:00:10Z', endedAt:'2026-09-10T00:00:15Z', deliveredWording:protocol.cue.wording, contextConfirmed:true, deviations:'', outcome:'completed', failureReason:null, recordingId:'recorded-practice', artifactId:'artifact-practice', artifactHash:'a'.repeat(64), filename:'fixture.webm', pitches:track(sung()), sensation:{ provenance:'learner-self-report', words:'Fictional test report', bodyRegion:'', effort:2, discomfort:false, recognizable:true, confidence:3 }, mnemonic:'' }
  const later = (id: string, phase: LearningAttempt['phase'], pitches: LearningPitchSample[], minute: number): LearningAttempt => ({ ...practice, id, phase, startedAt:`2026-09-10T00:${String(minute).padStart(2,'0')}:10Z`, endedAt:`2026-09-10T00:${String(minute).padStart(2,'0')}:15Z`, deliveredWording:'', pitches })
  const recall = later('recall', 'recall', Array.from({ length: 10 }, (_,i) => ({ offsetMs: i*100, hz: 220 })), 1)
  const transfer = later('transfer', 'transfer', track(sung()), 2), forgot = later('forgot', 'transfer', track(sung([220,330],[1000,1000]), { tail: 1500 }), 3)
  const wrong = later('wrong', 'transfer', track(sung([220,440,275])), 4), broken = later('broken', 'transfer', [], 5)
  const scores = await evaluateLearning(protocol, [practice,recall,transfer,forgot,wrong,broken])
  assert.deepEqual(scores.map(s => [s.status,s.passed]), [['scored',true],['scored',true],['scored',true],['failed',false],['scored',false],['excluded',false]])
  assert.equal(scores[0].melody?.passed, true); assert.equal(scores[1].melody, undefined); assert.equal(scores[1].errorCents, 0)
  assert.match(scores[3].reasons.join(), /Note 3 not sung/); assert.match(scores[5].reasons.join(), /No decoded pitch samples/)
  // The single-note whole-recording voicing gate must not apply to melodic attempts.
  const lateSilence = later('late-silence', 'transfer', track(sung([220],[1000]), { tail: 3000 }), 6), padded = later('padded', 'transfer', track(sung(), { lead: 4000, tail: 4000 }), 7)
  const gated = await evaluateLearning(protocol, [practice, lateSilence, padded])
  assert.deepEqual(gated.slice(1).map(s => [s.status,s.passed]), [['failed',false],['scored',true]]); assert.match(gated[1].reasons.join(), /Note 2 not sung/); assert.doesNotMatch(gated[1].reasons.join(), /Insufficient voiced audio/)
  const censored = later('censored', 'transfer', track(sung(), { tail: 0 }), 8), variantPractice = { ...practice, id:'variant-practice', arm:'variant' as const, deliveredWording:protocol.cue.variant }
  const perArm = [practice, variantPractice, censored, { ...censored, id:'censored-wrong', arm:'variant' as const, pitches:track(sung([220,440,275]), { tail: 0 }) }, { ...transfer, id:'variant-transfer', arm:'variant' as const }]
  const transferRow = compareLearning(perArm, await evaluateLearning(protocol, perArm)).find(row => row.phase === 'transfer')!
  assert.deepEqual(transferRow.arms.map(a => [a.arm,a.attempts,a.passed,a.excluded,a.endNotObserved]), [['baseline',1,0,1,1],['variant',2,1,1,1]])
  const stopped = await evaluateLearning(protocol, [practice, { ...forgot, outcome:'stopped', failureReason:'Stopped for discomfort / rest' }])
  assert.deepEqual(stopped[1].reasons, ['Stopped for discomfort / rest'])
  assert.match(learningInstruction(protocol,'baseline','transfer'), /from memory/); assert.doesNotMatch(learningInstruction(protocol,'baseline','transfer'), /220|330|275/)
  const tampered = await evaluateLearning({ ...protocol, melody: { ...melody, notes: [...melody.notes.slice(0,2), { hz:300, durationMs:1000 }] } }, [practice,transfer])
  assert.equal(tampered[1].status, 'excluded'); assert.match(tampered[1].reasons.join(), /digest/)
  const kit = await exportLearningInterchange([protocol], [practice,recall,transfer,forgot])
  assert.equal(kit.omissions.length, 0)
  const evaluations = kit.records.filter(r => r.kind === 'transfer-evaluation')
  assert.deepEqual(evaluations.map(r => r.kind === 'transfer-evaluation' && [r.stage, r.outcome]), [['cue-free-recall','scored'],['phrase-transfer','scored'],['phrase-transfer','failed']])
  const transferRecord = evaluations[1]
  assert.ok(transferRecord.kind === 'transfer-evaluation' && JSON.parse(transferRecord.context.melodicScore).frames.rawPitchAccuracy === 1)
  assert.ok(kit.records.some(r => r.kind === 'sensation-report' && r.attemptId === 'transfer'))
})
