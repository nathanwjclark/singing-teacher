# Native mechanical source experiments

The optional app source fit now uses VocalTractLab's actual **Two-mass model** by default. The two-mass dynamics run inside the pinned native synthesizer together with the vocal tract. Python does not generate a substitute pulse. The model contains lower/upper masses, springs, collision springs, coupling, damping and pressure-driven motion.

This is a conditional low-dimensional simulator. Its tissue masses, stiffnesses, length and other static properties remain the certified JD3 speaker values. Fitting its controls does not identify a singer's tissue mechanics, muscle recruitment, vocal-fold contact or anatomical uniqueness. The tract's `vocal_fold_length` geometry parameter is not an independently measured or fitted two-mass cord length.

## Controls and finite support

`source_model=two_mass` requires `XB`, `XT` (lower/upper rest displacement, cm), `EAA` (extra arytenoid area, cm²), and `DF` (dimensionless damping factor), alongside `JA`, `F0`, `PR`, and microphone `gain`. Research bounds are narrower than the verified native bounds:

| Control | Research bounds |
| --- | --- |
| XB / XT | −0.01 to 0.06 cm |
| EAA | 0 to 0.05 cm² |
| DF | 0.6 to 1.6 |
| F0 | 65 to 600 Hz |
| PR | 4,000 to 12,000 dPa |

The app uses two declared source alternatives per retained tract: `(XB=XT=.005, EAA=0, DF=1)` and `(XB=XT=.015, EAA=.005, DF=1)`. It keeps the same source support for every tract. These are a coarse, declared research grid, not a calibrated distribution of human physiology. Each hypothesis retains its source family and shape across calibration trials; vowel, pitch-control, pressure and capture gain can vary by trial.

Requested native `F0` is a control of the model's tension mapping. The actual simulated acoustic pitch can differ, especially with changes in gap, damping and tract loading. The system preserves both requested controls and extracted acoustic pitch. It never retunes generated audio to manufacture agreement. Silent, weak, aperiodic or unavailable descriptors remain explicit unavailable alternatives.

`PHONATION_SOURCE_MODEL=geometric` retains the prior PS-only app profile. Low-level finite candidate documents can compare both source families with matched tract and nuisance support. The three ablations retain equal simulation allocations: joint source/tract, fixed source within the same source family, and fixed template tract. The fixed two-mass source is `XB=XT=.01 cm, EAA=0 cm², DF=1`; fixed geometric source is `PS=0`.

## Integrity, selection and restoration

`Engine.source_model` derives a temporary speaker file from the certified JD3 file by changing only each glottis model's `selected` attribute. No tissue values are edited. Results retain the reference-speaker hash, derived speaker byte hash, selected family, full native controls, native library provenance and fixed speaker static parameters. No ephemeral file path is used as durable evidence.

The native library has global state. Selection is guarded by the existing single-owner engine and restores caller anatomy, source family and provenance after success or an exception. A failed restoration closes the engine rather than continuing with an unknown native state. Switching re-reads the native parameter count and metadata; dimensionless empty units are preserved.

The source policy is versioned as `vtl-finite-geometric-two-mass-v2`. Adapter, engine, resampling dependency and extractor hashes are frozen. The app's policy cache also includes the selected app source family. Old policies are shown as unsupported historical receipts, and a new explicit analysis is allowed. Score-time policy changes return unavailable scores with no extraction or model update. Baseline anatomical state is never replaced by a source score.

## Verification and limitations

`test_mechanical_phonation.py` uses real native synthesis. It verifies exception restoration, dimensionless metadata, finite control validation, pitch-control/output mismatch and damping response. Its matched mixed-family experiment uses two tract alternatives for each source family, two calibration vowels (`a` at 150 Hz nominal / gain 2; `u` at 220 Hz nominal / gain .7), and 24 fit calls. Separate `e` and `o` banks each freeze 12 predictions at 190 Hz nominal, 8,500 dPa, gain 1.3 before scoring. Each score performs zero synthesis and one canonical extraction.

The `e` transfer falls below the canonical analysis floor for the known mechanical generator and is retained as an explicit insufficient-quality case. The `o` case checks recovery of the known in-grid generator. The test retains both outcomes; it does not establish superiority on human singing or broad identifiability. A separate app integration test exercises current source defaults through fit, freeze, original later capture, score, two rounds, restart/recovery and missing-runner fallback.

Physical-device measurements, external validation against vocal-fold imaging/contact instrumentation, off-grid robustness, more physiological parameter recovery and calibrated uncertainty remain experimental questions.

## Primary sources and license

- [Pinned native TwoMassModel.cpp](https://github.com/TUD-STKS/VocalTractLabBackend-dev/blob/df30392f18dc5e175b577c3ba734caaa65a3927f/src/VocalTractLabBackend/TwoMassModel.cpp): actual control bounds, fixed tissue parameters and numerical dynamics used here.
- [VocalTractLab manual](https://www.vocaltractlab.de/download-vocaltractlab/VTL2.2-Manual.pdf): source families and speaker/model selection.
- [Ishizaka and Flanagan, 1972](https://doi.org/10.1002/j.1538-7305.1972.tb02651.x): original two-mass voiced-sound model.
- [Birkholz et al., 2011](https://www.speechtrainer.eu/documents/Birkholz_etal_2011_Interspeech.pdf): a separate triangular two-mass extension; available in native code but not enabled by this implementation.

VocalTractLab native code is GPL-3.0-or-later. This feature reuses the repository's pinned native dependency and introduces no additional redistributed dataset or model weights.
