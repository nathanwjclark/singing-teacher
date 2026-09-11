# Frozen melodic practice and transfer

Evidence source for everything verified here: `synthetic` (generated pitch tracks and generated
oscillator audio). Scientific outcome: `untested`. No human singer, teacher or learning effect
has been measured.

## What the learner does

In the Teaching & learning panel, enable **Use a short melody for practice and phrase transfer**
before freezing the reviewed protocol. The default melody is do–mi–re–do on the declared target
(for 220 Hz: A3, C♯4, B3, A3, 800 ms each). Notes are shown by name and duration, can be edited in
Hz and ms, and **Play reference** plays them through a Web Audio triangle oscillator. No samples or
audio assets are used.

Freezing binds the notes, durations, pitch tolerance, note-start tolerance and scoring policy into the
protocol digest. Any later change to a note invalidates existing evidence references. A declared
melody must have:

- 2–8 notes, each 65–1100 Hz and 500–4000 ms, at most 20 s in total;
- adjacent notes at least 100 cents apart (repeated notes and rests are not supported);
- a pitch tolerance of at most half the smallest adjacent interval, so a neighbouring note cannot pass;
- a note-start and phrase-length tolerance of 100–500 ms (default 200 ms).

Stages in a melody protocol:

| Stage | Task | Assistance | Scoring |
| --- | --- | --- | --- |
| Prompted practice | Sing the melody with the cue | Cue, mnemonic, melody names and **Play reference** visible | Melody |
| Recall | Single target note | Hidden | Single note (unchanged) |
| Phrase transfer | Sing the melody from memory | Cue, mnemonic, melody and reference hidden | Melody |
| Retention | Single target note, later session | Hidden | Single note (unchanged) |

**Play reference** is disabled while recording so the reference cannot leak into a capture.
Protocols without a melody behave exactly as before; their scores have no `melody` field.

## Measurement (`anchored-note-changes/1`)

Pitch comes from decoded recording PCM and the existing `detectPitch` (YIN) with the
`audioFrameSize` window (85 ms at 48 kHz). Melodic samples are taken every 20 ms, time-stamped at the
window centre, and carry `voiced`, `unvoiced` or `rejected` state plus the window length. Nothing is
interpolated or zero-filled.

1. **Onset anchor.** The phrase starts at the first run of 250 ms of voiced samples whose first pitch and
   median pitch are both within tolerance of note 1. A breath, a short hum or a sound at another pitch
   before singing does not start the clock.
2. **Note changes.** Note *k* starts at the first 250 ms voiced run after the previous note whose first
   and median pitch are nearer to note *k* than to note *k−1*, found by note *k*'s declared end. A
   note that is not found keeps its declared slot. Note-start error is the distance from the declared
   start, measured from the anchor at the declared tempo. There is no time warping.
3. **Phrase end.** The phrase ends at the first unvoiced run of at least 200 ms after the last located
   note. If the recording ends first, the end is *not observed*: the sung length is only a lower bound.
4. **Pitch per note.** The median absolute cents error against the declared frequency, over voiced
   samples whose analysis window lies inside the located note (half a window is dropped at each
   edge). Pitch windows follow observed note changes, so a late but in-tolerance change does not mix
   two notes into one median. The attempt's summary error is the worst note's error, because every
   note must pass.
5. **Frame metrics** (Salamon et al. 2014, as in `mir_eval.melody`), reported alongside the per-note
   results against the declared melody placed at the anchor, from the anchor to the last pitch
   sample. Samples before the anchor are not evaluated.
   - Raw pitch accuracy: share of reference-voiced samples whose estimate is within 50 cents.
   - Raw chroma accuracy: the same after octave folding. It is a diagnostic for detector octave slips
     and octave-transposed singing; it does not affect passing.
   - Voicing recall: share of reference-voiced samples that were estimated voiced.
   - Voicing false alarm: share of reference-unvoiced samples (after the declared end) estimated voiced.

**Absolute pitch is the task.** The learner is asked to sing declared notes, so a transposed
performance does not pass. When note 1 is never held within tolerance, the declared intervals are
placed on the first steady pitch; if every note and all timing then match, the score reports
`transposedCents` ("sung transposed by N cents").

## Outcomes

| Score status | When | Attempt status |
| --- | --- | --- |
| `unusable` | No decoded samples, rejected (non-finite or unordered) samples, samples missing inside the recording, no voiced audio at all, no steady pitch, or phrase end not observed while every observed criterion passed | `excluded` |
| `incomplete` | A declared note was not sung: less than the frozen voiced fraction of its time voiced (0.5 in the panel; for a note that was not found, its whole declared slot counts once the phrase end is observed) | `failed` |
| `scored` | Every note was sung | pass only if every note's pitch, every note start and the phrase length are within tolerance |

Stopped attempts and discomfort reports stay `failed` as before. A phrase that reaches the end of the
recording is neither a pass nor a failure unless an observed criterion already failed (for example a
wrong note, or a phrase already longer than the tolerance allows); then it is a scored non-pass.
The learner instruction for transfer asks for at least 300 ms of silence before stopping.

The local JSON export keeps the raw pitch samples. Local JSON and KIT records both keep the full melody
score (per-note values, frame metrics, reasons and failures), the frozen melody, the policy
description and the cue lineage.
Sensation reports stay subjective.

## Known limits

- If note 1 is sung out of tolerance but its pitch recurs later in the melody, the later occurrence
  becomes the anchor and the attempt usually reads as incomplete. It still does not pass.
- A hum at note 1's pitch lasting 250 ms or more cannot be told apart from starting note 1.
- A note held for less than 250 ms is not located. A breath of 200 ms or more inside the last note ends
  the phrase.
- Window smear biases located starts and ends by up to about half an analysis window. In generated
  audio the measured note-start and phrase-length errors were 20–60 ms over 10 browser runs; this is not a
  calibrated uncertainty and was not measured on voices, rooms or phone microphones.
- Vowel, words, articulation, vocal quality and internal physiology are not measured.
- An audio decoding failure in the panel is recorded as a failed attempt (`Audio decoding failed;
  recording retained.`), as it is for single-note protocols; the scorer itself excludes attempts with
  no decoded samples.

## Verification

- `node --experimental-strip-types --test src/evaluation/learning/*.test.ts` — melody unit scenarios
  on synthetic pitch tracks (correct, forgotten and held-over last note, wrong note, wrong direction,
  wrong rhythm, broken evidence, pre-singing hum, 500 ms notes with a late change and a glide,
  transposition, octave slips, vibrato, phrase ending at end of audio, declaration limits, frozen
  digest, stage routing and export) plus the unchanged single-note tests.
- `npx playwright test tests/melody-learning.spec.ts` runs under the default real-server configuration.
  It drives the real app with a generated oscillator microphone through MediaRecorder, decoding and
  scoring: prompted melody (pass), single-note recall (pass), transfer with a 200 ms hum first (pass),
  a wrong second note (scored non-pass), a forgotten last note (failed), then export, reload, hidden
  transfer assistance, reference playback, a refused repeated-note declaration and mobile width. It
  fails on any page error and on any console error other than the expected 503 from the routed Astra
  endpoint and the 409 answers for cue memory and session export when no model run exists.
