# Canonical waveform-conditioned finite-candidate fitting

`singing_physics.pcm_inverse.fit_pcm(engine, document, *, candidates,
max_synthesis_calls=128, node_binary=None)` ranks explicit candidate hypotheses
using **real synthesized PCM** passed through B's unchanged
`extractAudioMeasurement` in `src/lib/audio.ts`. It does not compare a tract
transfer function to microphone data. The Node bridge also invokes B's contract
validator. Node with TypeScript stripping must be on PATH; the optional executable
argument is for trusted local callers, not remote job parameters.

The observation document has `schema_version: "0.1.0"`,
`kind: "canonical_pcm_observations"`, and a `trials` array. Each trial requires
`id`, `pose`, `measurement` (the actual KIT AudioMeasurement object),
`sample_rate_hz`, `frame_start_sample`, `frame_size`, and `duration_s`.
For example, a 0.25-second source may use rate 44100, frame start 4410 and
frame size 4096, corresponding to the window starting at 100 ms.

The measurement must be a real canonical `audio-measurement` contract object,
method `pcm-blackman-power-yin/1.1.0`, with its original source artifact hashes and
observation/artifact IDs. Source IDs, sample interval, units, finite measurements,
null/missing reasons and quality flags are validated. Duplicate source windows
are rejected. Only native 44100 Hz, canonical 4096-sample frames are currently
supported: unsupported rates fail explicitly, with no silent resampling. The
window starts at `frame_start_sample / 44100` in the source recording; synthesis
uses exactly that relative interval. Invalid/clipped/low-SNR observations fail.
At least three nonmissing descriptors per trial are required.

Each finite candidate supplies `candidate_id`, `anatomy` overrides and `trials`, a
mapping from every trial ID to explicit `{JA, f0_hz, gain}`. JA is degrees in the
bounded [-5,-1] search profile; F0 is Hz; gain is a dimensionless positive **digital
amplitude multiplier**, not measured vocal effort, tissue mechanics or dB SPL.
Candidates share anatomical parameters across all calibration trials, while F0,
JA and gain are per-trial nuisance/dynamic choices. No anatomy is derived from
pitch alone. The fixed-anatomy comparison repeats the identical candidate control
list and exactly the same number of actual native synthesis calls. A strict
preflight cap rejects grids that cannot finish both models within budget. All
candidate scores/missing outcomes remain available; missing candidate descriptors
or clipping cannot improve a score by dropping dimensions.

The five descriptors are dBFS, spectral centroid, flatness, pitch and periodicity.
Fixed discrepancy scales are 3 dB, 250 Hz, 0.1, 20 Hz and 0.1 respectively; larger
reported measurement uncertainty replaces the corresponding scale. These are
engineering scales, **not a calibrated likelihood**. The selected candidate is a
conditional hypothesis among the supplied finite grid, not identified anatomy
or a posterior. Unknown room filters, microphone response and source mechanics
remain unsupported. Human canonical measurements are accepted only under these
explicit conditional assumptions.

Result keys include `joint` and `fixed_anatomy_baseline`, each with all candidates,
nullable `best`, and actual call counts; canonical extractor/contract source-code
hashes and versions; native provenance; input/grid hashes; feature scales;
missing outcomes; and limitations. Observed source hashes are structurally checked,
not verified against original audio bytes by this measurement-only API
(`source_artifact_bytes_verified: false`). The repository ingestion layer must
verify those bytes and enforce calibration/held-out roles before fitting. The
bridge itself hashes the exact little-endian float32 frame when it extracts PCM.
No shell is used for subprocess execution, and extraction has a timeout/input cap.

## Reproduction and actual result

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_pcm_inverse.py -q
PYTHONPATH=science/src science/.venv/bin/python science/scripts/pcm_fit_demo.py --output science/artifacts/pcm-fit-demo-v1
```

Four tests passed. The genuine native demonstration used 12 fit synthesis calls
(6 per model), plus 2 calibration and 2 post-selection held-out synthesis calls.
Candidate 1 scored 0 weighted discrepancy versus 18.820782 for the best fixed
anatomy baseline. All five nonmissing held-out descriptor errors were zero.
Noise-floor/SNR values remained missing, not zero. The held-out vowel was generated
only after writing the frozen fit, with explicitly supplied held-out JA/F0/gain.

This is a **development integration check**: the noiseless generator is deliberately
included in the finite grid. It does not establish blind recovery, uniqueness,
human accuracy or independent evaluation. During development the i/e windows were
below the canonical -60 dBFS gate; those attempts failed as insufficient data.
Explicit digital gain in the development fixture was increased (i:16, held-out
e:32) to exercise a valid extraction path. These adjustments preclude calling this
a fresh untouched scientific benchmark. The separate joint-transfer challenge
retains its own failures and scientific conclusions.
