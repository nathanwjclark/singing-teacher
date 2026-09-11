import type { LearningMelody, LearningPitchSample } from '../../experiment/cues/types.ts'

export const MELODY_SAMPLE_MS = 100
const BOUNDARY_GUARD_MS = 100
const cents = (hz: number, target: number) => Math.abs(1200 * Math.log2(hz / target))
function median(values: number[]) { const ordered = [...values].sort((a,b) => a-b), mid = Math.floor(ordered.length/2); return ordered.length ? ordered.length % 2 ? ordered[mid] : (ordered[mid-1]+ordered[mid])/2 : null }

export function validateMelody(melody: LearningMelody): void {
  if (melody.policy !== 'fixed-tempo-onset/1' || !Array.isArray(melody.notes) || melody.notes.length < 2 || melody.notes.length > 8) throw Error('Declare 2–8 notes for the melodic transfer task.')
  if (melody.notes.some(n => !Number.isFinite(n.hz) || n.hz < 65 || n.hz > 1100 || !Number.isFinite(n.durationMs) || n.durationMs < 500 || n.durationMs > 4000) || melody.notes.reduce((sum,n) => sum+n.durationMs,0) > 20000) throw Error('Each note needs 65–1100 Hz and 500–4000 ms; total phrase duration must not exceed 20 seconds.')
  if (melody.notes.some((n,i) => i > 0 && cents(n.hz,melody.notes[i-1].hz) < 100-1e-6)) throw Error('Adjacent notes must differ by at least 100 cents so recorded pitch can identify transitions. Repeated notes and articulation timing are not measured.')
  if (!Number.isFinite(melody.rhythmToleranceMs) || melody.rhythmToleranceMs < 100 || melody.rhythmToleranceMs > 500 || !Number.isFinite(melody.minimumCoverage) || melody.minimumCoverage < .7 || melody.minimumCoverage > 1 || !Number.isFinite(melody.minimumNoteVoicedFraction) || melody.minimumNoteVoicedFraction < .5 || melody.minimumNoteVoicedFraction > 1) throw Error('Use 100–500 ms rhythm tolerance, coverage of 0.7–1 and per-note voicing of 0.5–1.')
}

export interface MelodyScore {
  policy: LearningMelody['policy']; onsetMs: number | null; timingResolutionMs: number
  errorCents: number | null; transitionErrorMs: number | null; durationErrorMs: number | null
  expectedDurationMs: number; observedDurationMs: number | null
  missingSamples: number; rejectedSamples: number; unvoicedSamples: number
  notes: { index: number; targetHz: number; expectedStartMs: number; expectedDurationMs: number; errorCents: number | null; observedFraction: number; voicedFraction: number; observedTransitionMs: number | null; transitionErrorMs: number | null }[]
  reasons: string[]; failures: string[]; passed: boolean
}

/** A single acoustic onset anchor, fixed target durations, no tempo fitting or pitch warping.
 * The first two consecutive voiced windows anchor the phrase regardless of target pitch.
 * Per-note errors use interior 100 ms bins; missing bins remain in coverage denominators.
 */
export function scoreMelody(melody: LearningMelody, samples: LearningPitchSample[], toleranceCents: number): MelodyScore {
  validateMelody(melody)
  const expectedDurationMs = melody.notes.reduce((sum,n) => sum+n.durationMs,0)
  const result: MelodyScore = { policy: melody.policy, onsetMs: null, timingResolutionMs: MELODY_SAMPLE_MS, errorCents: null, transitionErrorMs: null, durationErrorMs: null, expectedDurationMs, observedDurationMs: null, missingSamples: 0, rejectedSamples: 0, unvoicedSamples: 0, notes: [], reasons: [], failures: [], passed: false }
  let previous = -Infinity
  const valid = samples.filter(sample => {
    const good = Number.isFinite(sample.offsetMs) && sample.offsetMs >= 0 && sample.offsetMs > previous && sample.status !== 'rejected' && (sample.hz === null || (Number.isFinite(sample.hz) && sample.hz >= 65 && sample.hz <= 1100)) && !(sample.status === 'voiced' && sample.hz === null) && !(sample.status === 'unvoiced' && sample.hz !== null)
    if (Number.isFinite(sample.offsetMs)) previous = sample.offsetMs
    if (!good) result.rejectedSamples++
    return good
  })
  if (result.rejectedSamples) result.reasons.push(`${result.rejectedSamples} rejected pitch samples (invalid, unordered or outside extractor range)`)
  const consecutive = (a: LearningPitchSample, b: LearningPitchSample) => Math.abs(b.offsetMs-a.offsetMs-MELODY_SAMPLE_MS) <= 5
  const onsetIndex = valid.findIndex((p,i) => p.hz !== null && valid[i+1]?.hz != null && consecutive(p,valid[i+1]))
  if (onsetIndex < 0) { result.reasons.push('No two consecutive voiced windows to anchor the melody'); return result }
  result.onsetMs = valid[onsetIndex].offsetMs
  let startMs = 0
  let lastTransitionIndex = onsetIndex
  const allErrors: number[] = [], timingErrors: number[] = []
  melody.notes.forEach((note,index) => {
    const noteStart = startMs, bins: (LearningPitchSample | undefined)[] = []
    for (let time = noteStart+BOUNDARY_GUARD_MS; time < noteStart+note.durationMs-BOUNDARY_GUARD_MS; time += MELODY_SAMPLE_MS) {
      const absolute = result.onsetMs!+time
      bins.push(valid.find(p => Math.abs(p.offsetMs-absolute) < MELODY_SAMPLE_MS/2))
    }
    const observed = bins.filter((p): p is LearningPitchSample => !!p)
    const voiced = observed.filter(p => p.hz !== null)
    result.missingSamples += bins.length-observed.length
    result.unvoicedSamples += observed.length-voiced.length
    const errors = voiced.map(p => cents(p.hz!,note.hz)); allErrors.push(...errors)
    const observedFraction = observed.length/Math.max(1,bins.length), voicedFraction = voiced.length/Math.max(1,bins.length)
    if (observedFraction < melody.minimumCoverage) result.reasons.push(`Note ${index+1}: insufficient observed timeline coverage`)
    if (voicedFraction < melody.minimumNoteVoicedFraction) result.reasons.push(`Note ${index+1}: insufficient voiced audio`)
    let transitionMs: number | null = index === 0 ? 0 : null
    if (index > 0) {
      // Two consecutive target-compatible frames are required; do not relabel a
      // transition to whichever target would make this attempt score better.
      const candidate = valid.findIndex((p,i) => i > lastTransitionIndex && p.offsetMs > result.onsetMs!+noteStart-note.durationMs && p.hz !== null && cents(p.hz,note.hz) <= toleranceCents && valid[i+1]?.hz != null && cents(valid[i+1].hz!,note.hz) <= toleranceCents && consecutive(p,valid[i+1]))
      if (candidate >= 0) { lastTransitionIndex = candidate; transitionMs = valid[candidate].offsetMs-result.onsetMs! }
      else result.failures.push(`Note ${index+1}: no stable pitch transition to the declared target`)
    }
    const timingError = transitionMs === null ? null : Math.abs(transitionMs-noteStart)
    if (index > 0 && timingError !== null) timingErrors.push(timingError)
    result.notes.push({ index, targetHz: note.hz, expectedStartMs: noteStart, expectedDurationMs: note.durationMs, errorCents: median(errors), observedFraction, voicedFraction, observedTransitionMs: transitionMs, transitionErrorMs: timingError })
    startMs += note.durationMs
  })
  const lastVoiced = valid.findLastIndex(p => p.hz !== null)
  if (lastVoiced >= 0 && valid[lastVoiced+1]?.hz === null && valid[lastVoiced+2]?.hz === null && consecutive(valid[lastVoiced],valid[lastVoiced+1]) && consecutive(valid[lastVoiced+1],valid[lastVoiced+2])) {
    result.observedDurationMs = valid[lastVoiced].offsetMs-result.onsetMs+MELODY_SAMPLE_MS
    result.durationErrorMs = Math.abs(result.observedDurationMs-expectedDurationMs)
  } else result.reasons.push('Phrase offset unavailable: leave at least 300 ms of silence before stopping')
  result.errorCents = median(allErrors)
  result.transitionErrorMs = timingErrors.length === melody.notes.length-1 ? Math.max(...timingErrors) : null
  for (const note of result.notes) {
    if (note.errorCents !== null && note.errorCents > toleranceCents) result.failures.push(`Note ${note.index+1}: pitch error exceeds ${toleranceCents} cents`)
    if (note.transitionErrorMs !== null && note.transitionErrorMs > melody.rhythmToleranceMs) result.failures.push(`Note ${note.index+1}: transition error exceeds ${melody.rhythmToleranceMs} ms`)
  }
  if (result.durationErrorMs !== null && result.durationErrorMs > melody.rhythmToleranceMs) result.failures.push(`Phrase duration error exceeds ${melody.rhythmToleranceMs} ms`)
  result.passed = !result.reasons.length && result.notes.every(n => n.errorCents !== null && n.errorCents <= toleranceCents) && result.transitionErrorMs !== null && result.transitionErrorMs <= melody.rhythmToleranceMs && result.durationErrorMs !== null && result.durationErrorMs <= melody.rhythmToleranceMs
  return result
}
