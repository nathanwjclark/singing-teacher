# Native capture to canonical PCM measurements

`science/scripts/import_native_pcm.ts` reuses B's `importNativeCapture` to validate
the native package and every referenced artifact. It then reopens source audio
with no-follow file access and rechecks bytes/hashes before decoding. The source
directory is unchanged; a new private output directory contains actual derived
mono float32 PCM artifacts and `native-pcm.json` with KIT observations,
measurements, segment/source bindings and explicit cuts.

```sh
node --experimental-strip-types science/scripts/import_native_pcm.ts INPUT NEW_OUTPUT PARTICIPANT_ID SESSION_ID [POSE] [--development-fixture]
node --experimental-strip-types --test science/scripts/import_native_pcm.test.ts
```

Programmatic entry point:
`importNativePcm(directory, outputDirectory, {participantId, sessionId, pose?, evidenceKind?})`.
Declared evidence kind is `human-observation` or `development-fixture`; software
fixtures must explicitly select the latter. This declaration is retained in the
source import and derived records. Package hashes prove consistency, not physical
device authenticity. No actual phone acceptance is claimed by these tests.

## Decoding and continuity

Supported ASBD profiles are interleaved, little-endian float32 (flags 1 or 9) and
signed PCM16 (flags 4 or 12), at 44100/48000/96000 Hz with 1–8 channels. Exact
bits, frame/packet byte counts, one frame per packet, duration, sample count and
finite floating samples are checked. Big-endian, noninterleaved, aligned-high,
compressed or other unrecognized encodings fail explicitly. PCM16 conversion is
`integer / 32768`, with no normalization. Float32 values are unchanged.

Only chunks with the same ASBD and epoch and verified contiguous presentation
timestamps are concatenated. Missing chunks, positive gaps and format changes
cut segments; overlaps and inconsistent declared gaps/durations reject input.
Timing tolerance is one-quarter sample, checked both between adjacent chunks and
against the accumulated segment clock, so tiny per-chunk errors cannot silently
accumulate. Every source slice retains its original artifact ID/hash, original
chunk sample index, exact `source_sample_offset`, slice count and native start.
Segments are bounded at five seconds, including slices through longer chunks.

For each segment, channel choice follows B's recorded-audio policy: energy sampled
every eighth sample, highest channel selected, earliest channel on ties. There is
no summing, phase cancellation, gain normalization or resampling. Canonical window
size and extraction come from B's unchanged `audioFrameSize` and
`extractAudioMeasurement`; windows advance at the same 100 ms hop. Samples at or
above absolute 0.995 are flagged as clipping, including PCM16 rails.

## Artifacts, clocks and fitting

Each derived segment has its own actual PCM artifact and KIT observation. Original
chunk hashes and native-manifest hash remain in observation provenance and source
bindings. Canonical measurements reference the derived artifact's hash, avoiding
ambiguous claims that a window spanning several chunks belongs to one chunk.
The source-import metadata is retained alongside the derived output; its original
relative artifact paths resolve in `source_directory`, not the output directory.

Derived time starts at segment sample zero and includes an explicit offset and
reference to the original native audio clock. Synchronization uncertainty stays
null. This arithmetic origin shift does not establish alignment to camera/depth
or a physical audio-onset timestamp.

When a pose is explicitly supplied, `fit_trial_options` provides current
`fit_pcm` fields: canonical measurement, rate, segment-relative start sample,
frame size and actual segment duration. Segments under the native minimum 0.1 s
remain measurable but have an explicit fit-ineligible reason and emit no trial
options. Very short segments and all cuts remain in the report. The caller selects
at most ten calibration windows and provides candidate anatomy/source/articulation/
digital-gain assumptions separately. Several windows from a segment are not
independent attempts. Invalid/quiet/clipped windows are retained and the fitter's
quality gates still apply; this importer neither fits anatomy nor declares every
window usable. Source-onset correspondence and unknown room/microphone response
remain conditional modeling assumptions.

Input is bounded to 64 MB of reread manifest/audio bytes, 10,000 native sample
rows, five seconds per segment, and 1,000 canonical windows. B's earlier package
validation has its own 512 MB cap. Outputs use fresh exclusive files with private
permissions; the final metadata is written last. A partial directory without
`native-pcm.json` is incomplete and must not be consumed.

Eight software tests pass, including fixture CLI parsing without a pose: exact canonical tone values after contiguous decoding,
channel selection, hashes and unknown clocks, gaps/drops, unsupported formats,
nonfinite values, declared timing mismatch, short-fit exclusion, PCM16 clipping,
cumulative timing drift and five-second source offsets. These tests provide
software-path evidence only; actual iPhone recordings remain required for device
acceptance and human reconstruction claims.
