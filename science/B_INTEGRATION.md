# Cross-lead scientific handoff

B's public KIT 1.0.0, canonical audio extractor 1.1.0, native acquisition and
independent evaluator are integrated through main `55ff619`. A's scientific
consumers preserve these interfaces. No new public contract or alternate audio
extractor was introduced.

## Executable paths

| Input | A operation | Consumer/output |
|---|---|---|
| Original native capture directory | Verified artifact decoding; calibrated radial point mapping | Camera-space points with source hashes and explicit calibration/fusion gates |
| Canonical audio measurements | `JobService` operation `fit_pcm` | All finite anatomy/source/JA/gain candidates and equal-compute fixed-anatomy scores |
| Frozen complete anatomical snapshot and later single-vowel frames | `fit_frozen_control` | Per-frame inferred articulation; anatomical parameters stay fixed |
| Verified completed joint or PCM fitting job and matching native export | KIT candidate adapter | Explicit inferred/fixed parameters, configuration and native-basis provenance |
| Matching candidate and canonical native PCM | KIT forecast/commit | Immutable prediction followed by later generation and B's independent scoring |

The PCM comparison supports 44.1/48/96 kHz observations. Only synthesized
predictions are resampled, with the exact transform recorded; observation samples
are not silently changed. Source pitch and gain are explicit hypotheses. Unknown
microphone/room filters and detailed vocal tissue mechanics remain unsupported.

## Reproduce on a new output directory

After the existing scientific setup and `npm ci`, run from the repository root:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests -q -W error
PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/pcm_fit_demo.py --output science/artifacts/pcm-demo
SINGING_PYTHON=science/.venv/bin/python node --experimental-strip-types science/scripts/replay_kit_science.ts science/artifacts/kit-replay
SINGING_PYTHON=science/.venv/bin/python node --experimental-strip-types --test science/scripts/kit_science.test.ts
npm run build
npm run lint
```

The PCM development demonstration includes its noiseless generator in the finite
candidate grid. Its exact match demonstrates executable comparison, not blind
recovery. The separate KIT replay fits on calibration transfer data, freezes its
forecast before generating a target from the source anatomy, and retains nonzero
independent PCM errors. Neither is a human accuracy or learning result.

## Reproducible native geometry

The stored detailed JD3 geometry is not exactly represented by its 13 anatomical
parameters. All new Engine instances therefore initialize the reconstructed
parameter basis. Both synthesis and later parameter restoration now share it.
New provenance includes `geometry_basis: vtl-anatomy-params-reconstructed-v1`;
older snapshots lacking it are incompatible and must be regenerated. KIT forecasts
bind that basis and the native library provenance, not just 13 numerical values.

## Remaining external acceptance

The current native capture format preserves data needed to begin geometric
calibration, but it does not supply measured lens/pixel mapping validation, depth
error, rigid head pose or audio/depth synchronization uncertainty. The point
operator can run on analytic fixtures before those measurements exist; real
multimodal fitting must wait for validated derivatives with their source hashes.

B and the phone operator supply actual private iPhone recordings, known-target
calibration and clock/head-pose evidence. A then checks the measurement operators
and runs physical fitting. B's independent evaluator supplies held-out human and
learner/retention outcomes; specialists review the cue library. No software test
can mark these participant/device gates passed.
