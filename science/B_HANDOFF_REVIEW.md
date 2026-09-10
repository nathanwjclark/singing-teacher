# Scientific review of the Lead B handoff

Reviewed integration commit `91d3380` (A `bdee764`, B `4c801ac`). This is a source
and contract review, not physical-device acceptance. No B production files were
modified. The new A PCM and KIT consumers require their own executable acceptance
before their integration is marked complete.

## Ready to consume

B provides a concrete canonical audio extractor in `src/lib/audio.ts`:
`pcm-blackman-power-yin/1.1.0`. It computes digital RMS dBFS, power-weighted
centroid/flatness, pitch and periodicity from finite mono PCM. It exposes no tract
transfer function, formants, anatomical dimensions or calibrated feature
uncertainty. Reusing the same implementation for native and recorded PCM avoids
silently introducing different feature definitions.

KIT 1.0.0 supplies immutable prediction commits, artifact metadata, observations,
measurements, candidate models, forecasts and evaluation records. The independent
evaluator checks prediction digests, chronology, target IDs/media hashes, duplicate
feature keys, missing features and baseline budget/articulation compatibility.
`import-science-forward.ts` validates native file hashes, converts actual native
OBJ coordinates from centimeters to meters, and extracts canonical PCM features.
These paths unblock a synthetic A/B integration, with its fixed-source scope
retained.

## Conditions for A consumer acceptance

1. **Preserve physical quantities.** KIT supports dBFS, not generic transfer dB.
   Do not map `transfer.json` magnitudes into dBFS outcomes. Produce native PCM and
   use B's extractor for available PCM forecasts; unsupported outputs remain
   unavailable. Centroid and pitch share units of Hz but represent different
   quantities and cannot substitute for one another.
2. **Bind extraction to evidence.** `audio.ts:168–191` permits omitted source hashes
   and caller-supplied IDs/window metadata. This is suitable for preview plumbing,
   but insufficient as a scientific artifact boundary. A consumers must verify
   actual source bytes/hash, channel selection, sample rate, window start/length,
   method/version and observation identity. A syntactically valid record does not
   prove its feature values were extracted from its referenced media.
3. **Separate source and anatomy.** F0 is a source control; recorded dBFS combines
   source pressure, digital gain, distance and capture response. Optimizing these
   features as if only tract dimensions can change would spuriously personalize
   anatomy. Declare gain/F0 treatment as fixed, estimated nuisance or conditional;
   preserve equal freedom for the fixed-anatomy baseline. Small scalar-feature
   error does not establish anatomical identifiability.
4. **Preserve unavailable and poor-quality observations.** Null pitch/centroid is
   not zero. Clipping, low SNR, active processing and preview timestamps are quality
   limitations. `evaluatePrediction` excludes missing numerical outcomes but does
   not independently certify every quality flag or extractor implementation.
   Declare the fitting/scoring quality policy before comparing cases; retain failed
   and excluded attempts rather than selecting only well-fitting frames.
5. **Use matching windows.** The extractor does no hidden resampling. Native and
   observed windows need compatible sample rate, FFT length and placement relative
   to source onset. The pressure ramp in a native onset window is part of the
   signal. A held-out recording's measured F0/articulation may support a separately
   labeled conditional prediction; it cannot retroactively improve a prospective
   forecast.
6. **Make compute units explicit.** KIT's `solver-calls` is not automatically equal
   to A residual calls, per-vowel spectra, synthesized windows or ensemble nodes.
   Record actual usage and compare like-for-like baseline budgets. A one-synthesis
   forecast budget must not imply that its preceding anatomical fit cost one call.

These are concrete adapter acceptance requirements, not claims that B's generic
record validator should itself authenticate arbitrary media or solve inverse
physics. PCM/KIT owners received them before implementation review.

## Native phone capture does not yet satisfy metric fusion inputs

The Swift producer explicitly captures front TrueDepth with RGB and optional raw
interleaved LPCM/ASBD metadata. It preserves dropped frames, invalid depth values,
source timestamps and calibration/distortion data. Its current mode is one held
pose. Rear LiDAR, validated head registration and measured temporal calibration
are not implemented by this producer.

`import-native-capture.ts:75–90` deliberately preserves unknown synchronization,
unrectified depth, uncalibrated depth noise and absent head pose. These honest
missing fields must not become identity transforms, zero uncertainty or a
`rectified=true` flag in an A adapter. Supplying a camera calibration artifact
alone does not supply a validated rectified depth array: intrinsics reference
resolution, distortion, pixel alignment and coordinate convention still matter.

Raw PCM must be decoded using the recorded ASBD format/flags, channel count and
byte alignment. Audio presentation clocks and synchronized RGB/depth clocks remain
unrelated until an explicit mapping and error bound are supplied. The existing
native importer validates package consistency, not device authenticity, mouth
measurement accuracy or human consent history. No actual device bundle was
reviewed here.

For FUSE/MOT acceptance the capture owner must provide supported depth
rectification/registration, measured uncertainty, explicit rigid head references
and audio/depth clock mapping. Until then, standalone audio research may proceed,
but a valid native KIT import cannot close human multimodal or motion gates.

## Verification and limits of this review

Inspected canonical extraction/calibration/recorded-window paths, KIT validators,
evaluation and native-forward/native-capture adapters, Swift capture output, and
B's acceptance ledger. No new heavy numerical experiment or hardware test was run.
No direct-transfer-to-dBFS conversion was found in B's current adapter. B's
controlled deterministic PCM replay is accurately labeled integration evidence,
not anatomical recovery or predictive generalization.

Pending separate acceptance: A's new PCM likelihood and KIT bridge, followed by a
real service/commit/generation/evaluation replay. Actual phone capture, calibrated
human reconstruction and human learning claims remain open independently of
software integration passing.

## Follow-up: implemented A PCM and KIT consumers

Reviewed `pcm_inverse.py`/`extract_pcm.ts` in `codex/a-pcm-inverse` and
`kit_science.ts`/`replay_kit_science.ts` in `codex/a-kit-forecast`. These are
finite-candidate hypothesis ranking and an actual fitted-model interchange path;
neither establishes general physiological identification.

The PCM implementation calls B's real extractor, records extractor/contract code
hashes, checks canonical quantities and window metadata, retains missing predicted
features and compares the same finite control grid under fitted versus fixed
anatomy. JA, F0 and scalar gain are explicit per-trial candidate controls. Feature
scales define a coarse discrepancy score, explicitly not a calibrated likelihood.
Candidate-only polyphase resampling to 48/96 kHz records its method, filter and
SciPy version; observation samples are not silently resampled.

Review found two PCM defects, fixed in `ecb72e6`: adding an unrelated source hash
could bypass duplicate-interval detection, and the human extraction helper
invented zero synchronization uncertainty. The corrected path detects repeated
source hashes/artifact intervals independently of ancillary hashes, and preserves
unknown human synchronization. The owner reports seven passing tests, including
these regressions and the sample-rate path. Source artifact bytes are **not**
verified by the scalar-record fitting API; its explicit
`source_artifact_bytes_verified=false` remains an ingestion boundary. Only a
verified producer-to-record chain can support a stronger source-integrity claim.

The KIT replay starts with an actual joint-fit job, exports its matching native
geometry and PCM, persists a public prediction commit, generates a later target
from scoring-only anatomy, and calls B's independent evaluator. Only the two fitted
anatomical dimensions are marked inferred; the remaining eleven are fixed.
Prospective synthesis count is separated from prior fitting cost. The public
human-only live ledger is not misused for this synthetic run. The owner reported
six tests passing on the first implementation. The subsequent review correction
`b927711` binds the complete canonical native provenance, including geometry basis
and library, through the candidate source identity/hash and checks it at forecast
time. Duplicate feature names are rejected before lookup. The same commit adds
actual PCM-job hypothesis projection, requiring a retained scored candidate and
matching full native geometry. Only physical dimensions varied in that candidate
grid are marked inferred. The owner reports seven tests passing in 8.49 seconds
on the updated handoff root, plus strict TypeScript and whitespace checks. No
remaining blocker was found in these reviewed paths.

## Canonical native geometry basis

Independently assessed root fix `efb77c5`. A fresh JD3 instance contains detailed
geometry not completely represented by its thirteen reported AnatomyParams;
reapplying those numbers previously changed its spectrum. Canonicalizing through
`set_anatomy(base_anatomy)` after caching the named poses, before exposing any
forward output, makes forward generation and frozen/reapplied anatomy use one
representational basis. This is the smallest coherent fix for a parameter-based
model rather than a full speaker-file snapshot.

The added provenance `geometry_basis=vtl-anatomy-params-reconstructed-v1` is a
necessary compatibility break. Old detailed-JD3 exports must not be relabeled or
accepted merely because their thirteen numbers match. Replay and downstream
forecast validation must compare the bound native basis/library, not only anatomy
numbers. Earlier default-forward results predate this basis; regenerating them is
a new artifact, not an update to old evidence.

Independent lightweight basis verification used the same `/a/` 512-bin transfer
call before and after reapplying `engine.anatomy()`. The old `91d3380` integration
worktree produced 0.8154007843 dB RMS difference across the returned bins and no
basis declaration. The updated `codex/a-b-handoff` worktree produced **0.0 dB**
difference and the declared reconstructed basis. This checks parameter reset
consistency, not accuracy against a human vocal tract.

Readiness: the reviewed PCM/KIT paths are suitable for the declared conditional
synthetic/hypothesis workflow after root integration checks. Scalar-record source
authenticity, model identifiability, microphone-response calibration and actual
phone/human acceptance remain separate unresolved requirements.

## Native LPCM bridge review

Reviewed `science/scripts/import_native_pcm.ts` and its complete test file in
`codex/a-native-pcm`, including the clipping-threshold change in `extract_pcm.ts`.
The bridge calls B's actual native package verifier and canonical audio extractor;
it does not substitute a new feature implementation. Supported ASBD encodings are
explicit interleaved little-endian float32 and signed PCM16 at 44.1/48/96 kHz.
PCM16 is divided by 32768 without normalization. Unsupported flags, inconsistent
byte widths, nonfinite samples, duration inconsistencies and changed input hashes
are rejected. Unknown audio/video synchronization stays unknown.

Concrete review findings, in priority order:

1. **Timing correctness, fixed by owner:** individually tolerated fractional
   sample gaps could accumulate while the output segment claimed a contiguous
   sample-index clock. The importer now compares each chunk start against the
   entire current segment's expected time and cuts when deviation exceeds one
   quarter sample. The regression accumulates 0.2-sample gaps and verifies cuts.
2. **Source replay completeness, fixed by owner:** splitting one source chunk at
   five seconds previously omitted its original sample offset in the binding.
   `source_sample_offset` now records the exact slice; a six-second chunk test
   verifies offsets 0 and 240000 at 48 kHz.
3. **CLI optional argument handling, fixed in `a387bf6`:** the development
   fixture flag could not be supplied without the optional pose. Parsing now
   removes the trailing flag independently; a real CLI subprocess regression
   verifies fixture provenance and absent automatic fit options without a pose.

Independent command on the reviewed worktree:

```sh
node --experimental-strip-types --test science/scripts/import_native_pcm.test.ts
```

All eight tests passed independently after `a387bf6` (397 ms rounded). They
exercise real package hashing,
LPCM decoding, canonical extraction, private exclusive output writes, gap/drop
segmentation, source offsets, short-window fit eligibility and clipping flags.
Software fixtures are explicitly declared `development-fixture`, including the
nested source observation. These tests do not establish actual device acceptance.

No-stubs audit: no TODO, FIXME, placeholder, dummy, fake or stub implementation
was found in the bridge or its test file. Synthetic PCM is confined to explicitly
labeled development tests. Wiring audit: both the exported API and CLI execute
B's verifier/extractor and serialize validated records plus derived media. The
returned `fit_trial_options` are selectable inputs, not automatic fitting or
independent trials; selecting calibration windows and candidates remains an
explicit caller step. No automatic fit connection is claimed. Minimality audit:
no dependency was added, and existing contract/extractor code is reused. The
second selected-artifact read deliberately verifies that bytes did not change
since package validation; it is not redundant evidence of device authenticity.

No remaining scientific blocker was found in this bounded importer. Root must
still run its integrated service replay and overall checks. Physical capture,
room/microphone calibration, depth rectification, head registration and measured
cross-modal timing remain separate acceptance requirements.
