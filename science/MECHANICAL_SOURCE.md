# Native two-mass source family

The optional source fit can use VocalTractLab's actual **Two-mass model** in addition to the prescribed **Geometric glottis**. The two-mass dynamics run inside the pinned native synthesizer together with the vocal tract; Python does not generate a substitute pulse. The model contains lower and upper masses, springs, collision springs, coupling, damping and pressure-driven motion.

The app default stays the geometric glottis. `PHONATION_SOURCE_MODEL=two_mass` on the local server opts in; choosing a different default is an owner decision, and the [frozen comparison](../evaluation/wave3/source/README.md) reports the evidence for it.

This is a conditional low-dimensional simulator. Its tissue masses, stiffnesses, cord length and other static properties stay at the certified JD3 speaker values. Fitting its controls does not identify a singer's tissue mechanics, muscle activity, vocal-fold contact or closure, or anatomical uniqueness. The tract's `vocal_fold_length` geometry parameter is not an independently measured or fitted two-mass cord length.

## Controls and finite support

Each family requires exactly its own shape controls, alongside `JA`, `F0` (65-600 Hz), `PR` (4,000-12,000 dPa) and microphone `gain`:

| Family | Shape controls | Research bounds | Fixed native controls |
| --- | --- | --- | --- |
| `geometric` | `PS` (pulse skew) | -0.3 to 0.3 | `FL=0`, `DP=0`, `AS=-40 dB` |
| `two_mass` | `XB`, `XT` (lower/upper rest displacement, cm); `EAA` (extra arytenoid area, cm²); `DF` (damping factor) | XB/XT -0.01 to 0.06; EAA 0 to 0.05; DF 0.6 to 1.6 | none |

`synthesize_phonation` rejects a call that omits its family's shape controls or includes the other family's; `PS` is never filled in silently. Candidate documents may declare `source_model`; without it a candidate is geometric. A hypothesis keeps one family and shape across all calibration trials. The fixed-source ablation uses each family's own reference (`PS=0`; `XB=XT=.01 cm, EAA=0, DF=1`).

The app varies one declared shape axis per family, with the same support for every retained anatomy: geometric `PS` in `[-0.2, 0, 0.2]` (one or two anatomies) or `[-0.2, 0.2]` (three to eight); two-mass `XB=XT` in `[.005, .01, .015]` or `[.005, .015]` cm with `EAA=0` and `DF=1` fixed. A preference among two-mass alternatives is therefore attributable to rest displacement only; the app does not explore arytenoid area or damping. Geometric alternatives use gain 4 and two-mass alternatives gain 2. A sweep of the app grids over 65-600 Hz and all five vowels at 8,000 dPa peaks at 0.85 (geometric, gain 4) and 0.73 (two-mass, gain 2); two-mass frames clip at gain 4 at 600 Hz. A fixed gain trades clipping against the -60 dBFS analysis floor: in the frozen comparison, which used gain 2 for both families, vowel `u` at 220 Hz with a long pharynx fell below the floor for both. `XB=.005` returns non-finite native output at some high pitches (vowel `a` at 450 Hz; `e` from 555 Hz; `i`, `o`, `u` from 520 Hz); those calls stay explicit failures.

## Requested and simulated F0

For the two-mass model, `F0` is the native tension control, not a pitch target. Its simulated pitch can differ from the request depending on shape, vowel, pressure and tract: in the frozen comparison by 11.0 Hz on average in absolute value and by up to 60 Hz (86.7 Hz simulated for 147 Hz requested on a long tract). Some shapes stop oscillating above the analysis floor at high requests. The app sets the requested `F0` to the observed pitch for both families.

Every fit prediction, frozen-bank alternative, single forecast and held-out score row records `requested_f0_hz` and `simulated_f0_hz` (the pitch the canonical extractor measured in the simulated frame). The primary discrepancy includes a pitch term, so it partly measures F0-control mapping rather than shape. Each row also carries `score_excluding_pitch`, the same terms without `pitchHz`; held-out scores add `heldout_rank_excluding_pitch`. Both scores need the same four descriptors, so availability is identical. The primary score still sets `best` and every rank. The pitch-excluded score does not remove F0 dependence from periodicity, flatness or harmonic slope.

A bounded per-shape secant search on requested F0 was considered and not adopted: it needs extra calls for every (shape, vowel, pitch) combination, which exceeds the app's declared 48-call bank limit at eight anatomies, and it would add search failures that are hard to separate from model failures. Reporting both scores keeps the declared budgets and shows the mismatch instead of tuning it away.

## Integrity, selection and restoration

`Engine.source_model(family)` reinitializes the native library with one glottis model selected. The engine reads the certified JD3 speaker once at start-up, checks its hash and loads native state only from those verified bytes, through a private temporary copy named with the process id; copies left by killed processes are removed when the next engine starts. The certified family (the geometric glottis) reloads exactly the certified bytes, and its native source metadata must equal the metadata read at start-up. The two-mass family loads bytes that differ from the certified ones only in the two `selected` digits; their SHA-256 is recorded as `selected_source_speaker_sha256` under policy `certified-JD3-selection-digits-only-v2`. No tissue value is edited. No temporary path is durable evidence.

The native library has global state. Selection is guarded by the single-owner engine and restores caller anatomy, source family and provenance after success or an exception; a failed restoration closes the engine. Fits and banks group calls by source family, so each group selects its family once. Because groups run in order, a deadline in a mixed-family bank would cut the later family; such a partly covered bank is returned as `timed-out` and is not committed. A bank applies one declared gain, so a bank whose alternatives were fitted with different reference gains (for example geometric gain 4 and two-mass gain 2) is rejected. `source_capability` requires the certified file to select the geometric glottis and reports each family separately: native controls and their hash, supported bounds, fixed controls, fixed-source reference, provenance and fixed speaker static parameters.

The source policy is versioned `vtl-finite-geometric-two-mass-v2`. Adapter, engine, resampling and extractor hashes are frozen, and the app policy also includes the selected app family, so changing `PHONATION_SOURCE_MODEL` invalidates cached fits. Old results stay visible as historical receipts. Baseline anatomy is never replaced by a source score.

## Cost of family selection

For the app's five-anatomy two-mass profile (30 fit calls, 30 bank calls), native reinitializations fell from 62 to 4 per phase once calls were grouped by family; `test_mechanical_phonation.py` asserts the grouped count. Wall time per phase fell from 14.0-15.0 s to 11.1-13.6 s on a loaded 8-core host, where extraction subprocesses dominate; the timings come from one uncommitted measurement script run twice on each version and will differ on other hosts. A standalone two-mass synthesis still selects and restores its family (0.16-0.20 s per call); inside a family group a call takes 0.09-0.15 s, close to the geometric 0.09-0.11 s.

## Verification and limitations

`test_mechanical_phonation.py` uses real native synthesis. It checks that the derived speaker differs only in selection digits; that restoration loads exactly the certified bytes and returns bit-identical synthesis for all five vowels, identical source metadata, anatomy and provenance after exceptions; that capability is family-aware and refuses a non-geometric certified selection; stale speaker-copy cleanup; family control validation; mixed-gain rejection and refusal of a partly covered mixed-family bank; requested/simulated F0 and the pitch-excluded score on fit, bank and score rows; one family selection per group; and the app grids and family gains. Its on-grid mixed-family test is a plumbing test only: its generator is a grid candidate, so near-zero scores hold by construction. `test_app_source_loop.py` runs fit, bank and score through the app routes and native worker for both the geometric default and `PHONATION_SOURCE_MODEL=two_mass`.

The off-grid, equal-budget comparison is in [evaluation/wave3/source](../evaluation/wave3/source/README.md). Its first frozen revision is **inconclusive** (synthetic evidence). Its main limitation is the frozen F0 rule: every candidate's `F0` was the pitch measured in the generator frame, which suits the geometric glottis but not the two-mass tension control, so even the true two-mass shape missed its generator's pitch and the primary score was biased against two-mass. Half the tract support was also lost to the analysis floor and one two-mass generator had no fit. The win counts therefore do not show which family predicts better, and they give no support for changing the default. Physical-device measurements, validation against vocal-fold imaging or contact instrumentation, recovery of more physiological parameters and calibrated uncertainty remain open.

## Primary sources and license

- [Pinned native TwoMassModel.cpp](https://github.com/TUD-STKS/VocalTractLabBackend-dev/blob/df30392f18dc5e175b577c3ba734caaa65a3927f/src/VocalTractLabBackend/TwoMassModel.cpp): control bounds, fixed tissue parameters and numerical dynamics used here.
- [VocalTractLab manual](https://www.vocaltractlab.de/download-vocaltractlab/VTL2.2-Manual.pdf): source families and speaker/model selection.
- [Ishizaka and Flanagan, 1972](https://doi.org/10.1002/j.1538-7305.1972.tb02651.x): original two-mass voiced-sound model.
- [Birkholz et al., 2011](https://www.speechtrainer.eu/documents/Birkholz_etal_2011_Interspeech.pdf): a separate triangular two-mass extension; present in native code but not enabled here.

VocalTractLab native code is GPL-3.0-or-later. This feature reuses the repository's pinned native dependency and adds no redistributed dataset or model weights.
