import type { LearningMelody, LearningPitchSample } from '../../experiment/cues/types.ts'

/** Pitch-sample hop for melodic attempts. Timing resolution; not a calibrated uncertainty. */
export const MELODY_HOP_MS = 20
/** A note is located by the first run of voiced samples at least this long. */
export const MELODY_STABLE_MS = 250
/** Trailing silence the learner is asked to leave; longer than any allowed breath so it always ends the phrase. */
export const MELODY_TRAILING_SILENCE_MS = 500
/** mir_eval.melody counts an estimate as correct when strictly within 50 cents of the reference. */
export const mirexHit = (errorCents: number) => Math.abs(errorCents) < 50
const cents = (hz: number, reference: number) => 1200 * Math.log2(hz / reference)
const chroma = (value: number) => Math.abs(value - 1200 * Math.round(value / 1200))
function median(values: number[]) { const ordered = [...values].sort((a,b) => a-b), mid = Math.floor(ordered.length/2); return ordered.length ? ordered.length % 2 ? ordered[mid] : (ordered[mid-1]+ordered[mid])/2 : null }
const ratio = (hits: number, total: number) => total ? hits/total : null
/** Absolute value of the median signed error: symmetric vibrato around the target scores near zero. */
function signedError(sung: number[], target: number) { const middle = median(sung.map(hz => cents(hz,target))); return middle === null ? null : Math.abs(middle) }

export function validateMelody(melody: LearningMelody, toleranceCents: number): void {
  if (melody.policy !== 'anchored-note-changes/1' || !Array.isArray(melody.notes) || melody.notes.length < 2 || melody.notes.length > 8) throw Error('Declare 2–8 notes for the melodic transfer task.')
  if (melody.notes.some(n => !Number.isFinite(n.hz) || n.hz < 65 || n.hz > 1100 || !Number.isFinite(n.durationMs) || n.durationMs < 500 || n.durationMs > 4000) || melody.notes.reduce((sum,n) => sum+n.durationMs,0) > 20000) throw Error('Each note needs 65–1100 Hz and 500–4000 ms; total phrase duration must not exceed 20 seconds.')
  const smallest = Math.min(...melody.notes.slice(1).map((n,i) => Math.abs(cents(n.hz,melody.notes[i].hz))))
  // 0.5 cent slack: frequencies entered to 0.01 Hz put exact semitones a few hundredths of a cent short.
  if (smallest < 100-.5) throw Error('Adjacent notes must differ by at least 100 cents so recorded pitch can locate note changes. Repeated notes and articulation are not measured.')
  if (2*toleranceCents > smallest+.5) throw Error(`Pitch tolerance must be at most half the smallest adjacent interval (${Math.round(smallest)} cents) so a neighbouring note cannot pass.`)
  if (!Number.isFinite(melody.rhythmToleranceMs) || melody.rhythmToleranceMs < 100 || melody.rhythmToleranceMs > 500 || !Number.isFinite(melody.minimumNoteVoicedFraction) || melody.minimumNoteVoicedFraction < .5 || melody.minimumNoteVoicedFraction > 1) throw Error('Use 100–500 ms rhythm tolerance and per-note voicing of 0.5–1.')
  if (!Number.isFinite(melody.maximumBreathMs) || melody.maximumBreathMs < 0 || melody.maximumBreathMs > 250 || !Number.isFinite(melody.maximumLeadInVoicedMs) || melody.maximumLeadInVoicedMs < 0 || melody.maximumLeadInVoicedMs > 5000) throw Error('Allow breaths of 0–250 ms and 0–5000 ms of voicing before note 1.')
}

export interface MelodyNoteScore { index: number; targetHz: number; expectedStartMs: number; expectedDurationMs: number; observedStartMs: number | null; transitionErrorMs: number | null; errorCents: number | null; voicedFraction: number | null }
/** mir_eval-style frame metrics over the whole recording against the declared score placed at the sung onset (unvoiced before and after it). */
export interface MelodyFrameMetrics { referenceVoicedFrames: number; referenceUnvoicedFrames: number; rawPitchAccuracy: number | null; rawChromaAccuracy: number | null; voicingRecall: number | null; voicingFalseAlarm: number | null }
export interface MelodyScore {
  policy: LearningMelody['policy']; status: 'scored' | 'incomplete' | 'unusable'; passed: boolean
  /** Why the attempt is unusable (status 'unusable') or incomplete (status 'incomplete'). */
  reasons: string[]
  /** Criteria the observed performance did not meet. */
  failures: string[]
  anchor: 'note-1' | 'first-stable-pitch' | null; onsetMs: number | null; hopMs: number
  /** Voiced time before the anchor; more than the frozen maximum fails the attempt. */
  leadInVoicedMs: number | null
  /** Set only when the whole melody matched after one constant shift and note 1 was missed. */
  transposedCents: number | null
  /** Largest per-note error (absolute value of the median signed cents) and largest note-start error; null when a note has no value. */
  errorCents: number | null; transitionErrorMs: number | null
  expectedDurationMs: number; offsetObserved: boolean
  /** Voiced phrase duration; a lower bound when the offset was not observed. */
  observedDurationMs: number | null; durationErrorMs: number | null
  frames: MelodyFrameMetrics | null
  /** unvoicedSamples counts unvoiced samples inside the located notes only. */
  missingSamples: number; rejectedSamples: number; unvoicedSamples: number
  notes: MelodyNoteScore[]
}

function sampleCheck(samples: LearningPitchSample[]) {
  let previous = -Infinity, rejected = 0
  const valid = samples.filter(sample => {
    const good = Number.isFinite(sample.offsetMs) && sample.offsetMs >= 0 && sample.offsetMs > previous && sample.status !== 'rejected' && (sample.hz === null || (Number.isFinite(sample.hz) && sample.hz >= 65 && sample.hz <= 1100)) && !(sample.status === 'voiced' && sample.hz === null) && !(sample.status === 'unvoiced' && sample.hz !== null)
    if (Number.isFinite(sample.offsetMs)) previous = Math.max(previous, sample.offsetMs)
    if (!good) rejected++
    return good
  })
  const gaps = valid.slice(1).reduce((sum,p,i) => sum + Math.max(0, Math.round((p.offsetMs-valid[i].offsetMs)/MELODY_HOP_MS)-1), 0)
  return { valid, rejected, gaps }
}

/** Absolute-pitch melody scoring with a note-1 onset anchor and note changes located in the pitch track.
 * Missing and unvoiced samples are never filled. Unusable evidence, incomplete performance and
 * wrong pitch or rhythm are reported separately.
 */
export function scoreMelody(melody: LearningMelody, samples: LearningPitchSample[], toleranceCents: number): MelodyScore {
  validateMelody(melody, toleranceCents)
  const declared = melody.notes.map(n => n.hz), starts = melody.notes.map((_,i) => melody.notes.slice(0,i).reduce((sum,n) => sum+n.durationMs,0))
  const expectedDurationMs = starts.at(-1)!+melody.notes.at(-1)!.durationMs
  const { valid, rejected, gaps } = sampleCheck(samples)
  const result: MelodyScore = { policy: melody.policy, status: 'unusable', passed: false, reasons: [], failures: [], anchor: null, onsetMs: null, hopMs: MELODY_HOP_MS, leadInVoicedMs: null, transposedCents: null, errorCents: null, transitionErrorMs: null, expectedDurationMs, offsetObserved: false, observedDurationMs: null, durationErrorMs: null, frames: null, missingSamples: gaps, rejectedSamples: rejected, unvoicedSamples: 0, notes: [] }
  if (!samples.length) result.reasons.push('No decoded pitch samples')
  if (rejected) result.reasons.push(`${rejected} rejected pitch samples (non-finite audio, unordered or outside the extractor range)`)
  if (gaps) result.reasons.push(`${gaps} pitch samples missing inside the recording`)
  if (valid.length && !valid.some(p => p.hz !== null)) result.reasons.push('No voiced audio detected; a silent microphone and a silent learner cannot be told apart')
  if (result.reasons.length) return result

  // The phrase ends at the first unvoiced run longer than the frozen breath allowance.
  const run = Math.ceil(MELODY_STABLE_MS/MELODY_HOP_MS), silence = Math.floor(melody.maximumBreathMs/MELODY_HOP_MS)+1
  const boundary = (i: number) => valid[i].offsetMs-MELODY_HOP_MS/2
  const near = (hz: number, target: number) => Math.abs(cents(hz,target)) <= toleranceCents
  // A run is `run` consecutive voiced samples; accept() sees its first pitch and its median pitch.
  const find = (from: number, accept: (first: number, middle: number) => boolean, limitMs = Infinity) => {
    for (let i = from; i+run <= valid.length && boundary(i) <= limitMs; i++) {
      const frames = valid.slice(i,i+run)
      if (frames.every(p => p.hz !== null) && accept(frames[0].hz!, median(frames.map(p => p.hz!))!)) return i
    }
    return -1
  }
  // Anchor: the first sustained pitch within tolerance of note 1. Shorter or off-target sounds before it are ignored.
  let anchorIndex = find(0, (first,middle) => near(first,declared[0]) && near(middle,declared[0])), targets = declared
  if (anchorIndex >= 0) result.anchor = 'note-1'
  else {
    // Diagnostic only: place the declared intervals on the first steady pitch to detect a transposed performance.
    anchorIndex = find(0, (first,middle) => near(first,middle))
    if (anchorIndex < 0) { result.reasons.push(`No voiced pitch held steady for ${MELODY_STABLE_MS} ms; the pitch track cannot place a melody`); return result }
    const shift = cents(median(valid.slice(anchorIndex,anchorIndex+run).map(p => p.hz!))!, declared[0])
    targets = declared.map(hz => hz*2**(shift/1200)); result.anchor = 'first-stable-pitch'
    result.failures.push(`Note 1 was never held within ${toleranceCents} cents; the first steady pitch was ${Math.round(shift)} cents away`)
  }
  const onset = boundary(anchorIndex), located: (number | null)[] = [anchorIndex]
  result.onsetMs = onset
  result.leadInVoicedMs = valid.slice(0,anchorIndex).filter(p => p.hz !== null).length*MELODY_HOP_MS
  // Note k starts at the first sustained run nearer to note k than to note k-1, before note k's expected end.
  let from = anchorIndex+run
  for (let k = 1; k < targets.length; k++) {
    const closer = (hz: number) => Math.abs(cents(hz,targets[k])) < Math.abs(cents(hz,targets[k-1]))
    const i = find(from, (first,middle) => closer(first) && closer(middle), onset+starts[k]+melody.notes[k].durationMs)
    located.push(i >= 0 ? i : null)
    // An unlocated note keeps its declared slot, so the next note is not searched for before it.
    const slot = valid.findIndex(p => p.offsetMs-MELODY_HOP_MS/2 >= onset+starts[k])
    from = i >= 0 ? i+run : slot < 0 ? valid.length : Math.max(from, slot)
  }
  let offsetIndex = -1
  for (let i = Math.max(...located.filter((i): i is number => i !== null))+run; i+silence <= valid.length; i++) if (valid.slice(i,i+silence).every(p => p.hz === null)) { offsetIndex = i; break }
  const evidenceEnd = valid.at(-1)!.offsetMs+MELODY_HOP_MS/2
  result.offsetObserved = offsetIndex >= 0
  const offset = result.offsetObserved ? boundary(offsetIndex) : evidenceEnd
  result.observedDurationMs = (result.offsetObserved ? offset : valid.findLast(p => p.hz !== null)!.offsetMs+MELODY_HOP_MS/2)-onset
  if (!result.offsetObserved) result.missingSamples += Math.max(0, Math.round((onset+expectedDurationMs-evidenceEnd)/MELODY_HOP_MS))
  // Pitch uses samples whose analysis window lies inside the located note.
  const guard = Math.max(MELODY_HOP_MS, ...valid.map(p => (p.windowMs ?? 0)/2))
  // A located note runs to the next located change (or the next declared slot); an unlocated note is judged in its declared slot.
  const starting = (k: number) => located[k] === null ? onset+starts[k] : boundary(located[k]!)
  const pitches = melody.notes.map((note,k) => {
    const start = starting(k), end = Math.min(located[k] === null ? onset+starts[k]+note.durationMs : k+1 < targets.length ? starting(k+1) : offset, offset), inside = valid.filter(p => p.offsetMs >= start && p.offsetMs < end)
    const voiced = inside.filter(p => p.hz !== null), sung = voiced.filter(p => p.offsetMs >= start+guard && p.offsetMs < end-guard).map(p => p.hz!)
    result.unvoicedSamples += inside.length-voiced.length
    const transitionErrorMs = k === 0 ? 0 : located[k] === null ? null : Math.abs(start-onset-starts[k])
    // After an observed offset an unlocated note's whole slot counts; past the evidence end without one, voicing is unknown.
    const slots = located[k] === null && result.offsetObserved ? Math.round(note.durationMs/MELODY_HOP_MS) : inside.length
    const voicedFraction = slots ? voiced.length/slots : result.offsetObserved ? 0 : null
    result.notes.push({ index: k, targetHz: note.hz, expectedStartMs: starts[k], expectedDurationMs: note.durationMs, observedStartMs: located[k] === null ? null : start-onset, transitionErrorMs, errorCents: signedError(sung, note.hz), voicedFraction })
    return sung
  })
  // Frame metrics (Salamon et al. 2014; mir_eval.melody) over every sample; the reference is unvoiced outside the placed melody.
  const reference = valid.map(p => { const t = p.offsetMs-onset; return { hz: p.hz, ref: t >= 0 && t < expectedDurationMs ? declared[starts.findLastIndex(s => s <= t)] : null } })
  const voicedRef = reference.filter(f => f.ref !== null), unvoicedRef = reference.filter(f => f.ref === null)
  result.frames = { referenceVoicedFrames: voicedRef.length, referenceUnvoicedFrames: unvoicedRef.length, rawPitchAccuracy: ratio(voicedRef.filter(f => f.hz !== null && mirexHit(cents(f.hz,f.ref!))).length, voicedRef.length), rawChromaAccuracy: ratio(voicedRef.filter(f => f.hz !== null && mirexHit(chroma(cents(f.hz,f.ref!)))).length, voicedRef.length), voicingRecall: ratio(voicedRef.filter(f => f.hz !== null).length, voicedRef.length), voicingFalseAlarm: ratio(unvoicedRef.filter(f => f.hz !== null).length, unvoicedRef.length) }
  // The worst note decides passing, so it is the summary error.
  result.errorCents = result.notes.every(n => n.errorCents !== null) ? Math.max(...result.notes.map(n => n.errorCents!)) : null
  const timing = result.notes.slice(1).map(n => n.transitionErrorMs)
  result.transitionErrorMs = timing.every(t => t !== null) ? Math.max(...timing as number[]) : null
  if (result.offsetObserved) result.durationErrorMs = Math.abs(result.observedDurationMs-expectedDurationMs)
  const rhythm: string[] = []
  for (const note of result.notes) {
    if (note.voicedFraction !== null && note.voicedFraction < melody.minimumNoteVoicedFraction) result.reasons.push(`Note ${note.index+1} not sung: ${Math.round(note.voicedFraction*100)}% of its time voiced`)
    // Without an observed offset, a note whose search window runs past the evidence is unknown, not missed.
    if (note.index > 0 && note.observedStartMs === null && (result.offsetObserved || onset+note.expectedStartMs+note.expectedDurationMs <= evidenceEnd)) rhythm.push(`Note ${note.index+1}: no sustained move toward the declared pitch before its expected end`)
    if (note.errorCents !== null && note.errorCents > toleranceCents) result.failures.push(`Note ${note.index+1}: pitch error ${Math.round(note.errorCents)} cents exceeds ${toleranceCents}`)
    if (note.transitionErrorMs !== null && note.transitionErrorMs > melody.rhythmToleranceMs) rhythm.push(`Note ${note.index+1}: starts ${Math.round(note.transitionErrorMs)} ms from its expected time (tolerance ${melody.rhythmToleranceMs} ms)`)
  }
  if (result.durationErrorMs !== null && result.durationErrorMs > melody.rhythmToleranceMs) rhythm.push(`Phrase lasts ${Math.round(result.observedDurationMs)} ms against ${expectedDurationMs} ms (tolerance ${melody.rhythmToleranceMs} ms)`)
  if (result.leadInVoicedMs > melody.maximumLeadInVoicedMs) result.failures.push(`${result.leadInVoicedMs} ms voiced before note 1 was held (allowed ${melody.maximumLeadInVoicedMs} ms)`)
  result.failures.push(...rhythm)
  if (result.anchor === 'first-stable-pitch' && !rhythm.length && pitches.every((sung,k) => { const error = signedError(sung, targets[k]); return error !== null && error <= toleranceCents })) {
    result.transposedCents = Math.round(cents(targets[0],declared[0]))
    result.failures.push(`Sung transposed by ${result.transposedCents} cents: relative pitch and rhythm matched, absolute pitch did not`)
  }
  // An unobserved end excludes the attempt whatever the other criteria say, so exclusion never depends on the outcome.
  if (!result.offsetObserved) { result.reasons = [`Phrase end not observed: the recording ended while still voiced (at least ${Math.round(result.observedDurationMs)} ms sung). Leave at least ${MELODY_TRAILING_SILENCE_MS} ms of silence before stopping.`]; return result }
  if (result.reasons.length) { result.status = 'incomplete'; return result }
  result.status = 'scored'
  result.passed = !result.failures.length
  return result
}
