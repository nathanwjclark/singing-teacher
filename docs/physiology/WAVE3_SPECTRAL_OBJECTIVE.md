# Wave 3: versioned spectral objective

`multires-log-spectrum-v1` is an experimental alternative to the default coarse objective `canonical-coarse-v1`. When it is selected, the capture pipeline derives a compact multi-resolution spectral observation from the exact imported float32 frame and uses it in bounded anatomy search, prospective experiment selection and the later PCM update. It is an engineering discrepancy, not a physiological likelihood or calibrated posterior.

## Choosing the objective

- **App:** Experiments → Scientific model → **Scoring objective**. The default is coarse. The fit request posts `{"objective": ...}` to `/api/science/run`; the server accepts only the two objective names above (no body keeps the default), records the choice with the run and passes it to the pipeline. The fitted result shows which objective produced it.
- **CLI:** `science/scripts/live_capture_jobs.py --objective multires-log-spectrum-v1`.
- **Library/service:** `fit_pcm`, `search_pcm` and `design_pcm` take `objective=`; the session `search` and `propose_design` commands accept `objective` in their parameters. `update_pcm` takes the objective from the sealed design.

When the spectral objective is requested and a trial has no spectral observation, fitting fails with "reimport original PCM"; it never falls back to coarse scoring.

## Representation and comparison

Three periodic-Hann periodograms are computed at 512, 1024 and 2048 samples at 44.1 kHz (the same durations at the other supported observation rates). A quarter-window hop uses complete windows only. One-sided power density is averaged over time, linearly interpolated onto 64 fixed frequencies from 80 to 8000 Hz and stored in dBFS/Hz with a −140 dBFS/Hz floor. Observed audio is never resampled.

The comparison removes an unbounded constant log-power difference **separately at each resolution** to isolate shape. It then fits one shared spectral tilt within ±6 dB/octave. Raw shape error, adjusted shape error and the fitted tilt are all retained. Overall RMS level stays separate: a scalar gain adjustment is allowed within ±24 dB, and any level difference beyond that is retained and penalized. These nuisance parameters stand for unresolved source and recording differences. They do not measure glottal closure or calibrate a room.

The score averages four squared terms: adjusted spectral shape / 6 dB, unexplained level / 3 dB, pitch error / 20 Hz and periodicity error / 0.1. Frequency bins and resolutions are correlated and are not counted as independent evidence. The canonical centroid and flatness remain available as diagnostics; their coarse residuals are not added again. The scales are declared engineering assumptions.

## Evidence binding

In the app pipeline, the importer's original segment bytes are checked against their SHA-256 and byte length before a frame is cut. The canonical measurement is re-extracted from that frame and must match the imported measurement exactly. The trial then carries a dedicated `frame_sha256` (the SHA-256 of the exact little-endian float32 frame) and the spectral observation, whose own frame hash must equal it. The measurement's `sourceHashes` keep the importer's segment digest; a segment digest is never accepted as a frame hash. Spectral observations must also match the frame offset, the original artifact identity and the sampling profile. Imported records are not modified.

Session ingest and the fitters receive JSON, not original bytes. They check this binding for consistency only, and fit and search results keep reporting `source_artifact_bytes_verified: false`. `update_pcm` hashes the frame it is given, and its receipt binds the spectral observation to that hash.

## Frozen scoring code

A new design records `objective`, `objective_policy` (for the spectral objective: its configuration, the SHA-256 of `pcm_spectral.py` and the NumPy version) and `scorer_implementation_pin`: SHA-256 hashes of `pcm_design.py`, `pcm_inverse.py`, `pcm_spectral.py`, `prediction.py`, `engine.py` and `science/scripts/extract_pcm.ts`, plus NumPy and SciPy versions. The TypeScript extractor and contracts are pinned separately by the extractor subprocess and checked on update. Fit and search results record `objective_policy`.

Pins are computed once, when a process imports these modules, so they name the code that process runs. Each worker job runs in a fresh process. After changing scoring code, restart any long-running process; its new pin will differ, and selecting or updating a design sealed by the older code fails with "freeze a new design with the current runtime". Coarse designs sealed before pins existed still update and report `scorer_pin_status: legacy_version_unverified`; a spectral design without a pin is rejected. Invalid or clipped PCM, frames below the analysis floor, missing predictions and nonfinite values never receive a favorable score.

## Budget and controls

The app's search keeps its declared cap of 60 native calls: five geometry proposals, three gain profiles (1, 4 and 16) and two calibration windows, for the joint and fixed-anatomy models. Gain multiplies each frame after synthesis, so the three gain profiles share one waveform per anatomy and window, and the search makes 20 native calls. The forecast adds 15 calls and the geometry export 2, for 37 in total (77 before synthesis was shared). Spectral extraction and the nuisance projection add no native calls, so both objectives use the same native budget. F0 comes from the observed canonical pitch during fitting; JA remains a declared control. The objective does not learn how a person executes a cue.

## Verification

- `science/tests/test_pcm_spectral.py`: separate gain, shape and tilt behavior; nuisance bounds; invalid values; exact frame binding including a segment digest offered as a frame hash; original-byte tampering and window mismatch in the app derivation; a native fit, sealed different-vowel forecast and exact PCM update; changed and missing pins; legacy coarse designs.
- `science/tests/test_live_capture_jobs.py`: the capture pipeline end to end through a local session for both objectives and through the HTTP worker for coarse, including native call counts.
- `server/science-run.test.mjs`: the fit route's objective allowlist and recorded choice.
- `tests/spectral-objective.spec.ts` (`npx playwright test -c tests/spectral-objective.config.ts`): the real app server and scientific worker with a generated native capture. It selects the spectral objective in the panel, runs the fit and forecast, publishes a later capture of the selected vowel and scores it; the update reports `scorer_pin_status: verified` and a spectral receipt bound to the frame hash. In that run the searched anatomy did not fit better than the fixed reference anatomy (0.056 against 0.052). This is expected: the generated capture uses the reference anatomy, and the five searched points do not include it.

These are synthetic software checks, not human recordings.

## Independent evaluation

The frozen equal-budget comparisons are in `evaluation/wave3/` and `docs/physiology/wave3-review.md`. Revision 1 was mixed and inconclusive. Revision 2 (three held-out vowels, declared gain rule and tie margin, production scorer) is inconclusive: both objectives hit 13 of 18 held-out comparisons. The spectral objective was invariant to a half-amplitude recording where coarse held-out error rose sixfold, but it did not improve held-out selection, separate source skews or detect a truth outside the grid. No threshold or spectral setting was tuned on either revision's held-out results. Neither establishes better anatomical recovery.

## Primary references

- Yamamoto, Song and Kim, [Parallel WaveGAN](https://arxiv.org/abs/1910.11480), motivates comparisons at multiple spectral resolutions for waveform modeling. This pooled, gain-separated finite-frame discrepancy differs from their neural-vocoder training loss; their results do not validate anatomy inference here.
- [SciPy spectral analysis documentation](https://docs.scipy.org/doc/scipy/tutorial/signal.html#spectral-analysis) describes the density scaling and finite-window issues relevant to the estimator. The implementation uses explicit NumPy FFTs and a specified periodic Hann window so windowing, pooling and endpoints are visible and pinned.
