# Frozen melodic transfer

The teaching and learning lab now supports a learner-declared short melody in the
**phrase transfer** stage. Prompted practice, single-note recall and later-session
retention retain their existing sustained-note task. Existing saved single-note
protocols and exports remain readable.

Before recording, enable **Use a short melody for phrase transfer**, declare 2–8
comfortable target frequencies and durations, then freeze the reviewed protocol.
Each note must be 65–1100 Hz and 500–4000 ms; total duration is at most 20 seconds.
Adjacent notes differ by at least 100 cents. Repeated notes, rests, articulation,
vowel identity, lyrics, vocal quality and internal physiology are not scored.
No songs, copyrighted assets or automatic range-expansion cues are supplied.

Practice and memorize the declared melody while assistance is visible. Transfer
hides the cue, mnemonic, earlier reports and target sequence. Begin when ready,
sing the melody, then leave at least 300 ms of silence before stopping. A previous
prompted attempt for the same comparison arm is required. Failure and discomfort
reports remain in the study denominator. The same target/scoring digest binds all
attempts in both arms; changing any note invalidates existing evidence references.

## Measurement definition

`fixed-tempo-onset/1` uses decoded recording PCM and the existing YIN pitch
extractor. New melodic samples carry their analysis-window center, duration and
voiced/unvoiced/rejected state. Window size scales with sample rate; windows are
sampled every 100 ms. The first pair of consecutive voiced windows anchors time,
regardless of whether those pitches match the target. Absolute recording-start
latency is therefore not a measured skill. There is no pitch correction, octave
folding, tempo fitting or time warping.

Each declared note has a fixed time interval. Interior 100 ms bins exclude 100 ms
at each boundary to reduce pitch-window transition mixing. Per-note median
absolute cents error, observed coverage and voiced fraction are reported; missing
bins remain in denominators. Each note needs 70% observed and 70% voiced interior
bins in the app protocol. Invalid or unordered samples are rejected explicitly.

Pitch transitions require two consecutive samples compatible with the next
declared target. The score reports the largest absolute transition-time error,
each transition error, and the final voiced-duration error. Two trailing unvoiced
windows are needed for the phrase offset. Sampling resolution is 100 ms; this is
not a calibrated uncertainty estimate. The default rhythm tolerance is 200 ms,
frozen with the target, adjustable between 100 and 500 ms.

Passing requires every note's median pitch error within the frozen cents
tolerance, all transitions and final duration within rhythm tolerance, and
sufficient recording evidence. A confidently wrong note is a scored non-pass;
missing/unvoiced or malformed evidence can exclude an attempt. Raw sample rows,
per-note diagnostics, evidence reasons and performance failures remain in local
JSON and KIT context. Subjective reports remain explicitly subjective.

## Verification and limitations

`node --experimental-strip-types --test src/evaluation/learning/*.test.ts
src/experiment/cues/memoryBridge.test.ts` covers matched melody, changed pitches,
octave errors, slower timing, missing samples, silence, malformed samples,
unsupported targets, frozen-digest tampering, single-note compatibility, no-cue
instructions and validated exports.

`npx playwright test -c playwright.melody.config.ts` records an explicitly
generated Web Audio microphone stream using actual browser MediaRecorder, decodes
the resulting media, and compares correct and deliberately wrong melodies. It
also checks report/export/reload, hidden transfer assistance and mobile width.
Generated audio verifies software behavior; it does not establish singer
accuracy, clinical validity, learning benefit or anatomical identifiability.
Real-phone microphone latency, room noise, phonation types and human phrase
coordination still need empirical evaluation.
