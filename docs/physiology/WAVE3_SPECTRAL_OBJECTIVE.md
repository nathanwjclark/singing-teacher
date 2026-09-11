# Wave 3: versioned spectral objective

The app’s explicitly selected experimental spectral mode now derives a compact, multi-resolution spectral observation from the exact imported float32 frame and uses it in bounded anatomy search, prospective experiment selection, and later PCM scoring. This is an experimental engineering discrepancy, not a physiological likelihood or calibrated posterior.

## Representation and comparison

`multires-log-spectrum-v1` computes periodic-Hann periodograms at three window durations (512, 1024 and 2048 samples at 44.1 kHz; durations preserved at supported observation rates). A quarter-window hop includes complete windows only. One-sided power density is averaged over time, linearly interpolated onto 64 fixed frequencies from 80–8000 Hz, and represented in dBFS/Hz with a -140 dBFS/Hz floor. Observations are never resampled.

The comparison removes an unbounded constant log-power difference **separately at each resolution** to isolate shape. A shared empirical spectral tilt is then fitted within ±6 dB/octave. Raw shape error, adjusted shape error, and the fitted tilt are retained. Overall PCM RMS level remains separate: a scalar gain adjustment is allowed within ±24 dB, and excess level discrepancy is retained and penalized. These nuisance parameters represent unresolved source/recording differences; they do not measure glottal closure or calibrate a room.

The score averages four squared terms: adjusted spectral shape / 6 dB, unexplained level / 3 dB, pitch error / 20 Hz, and periodicity error / 0.1. The frequency bins and resolutions are correlated, and are not counted as independent evidence. Canonical centroid and flatness remain available diagnostics; the new objective does not add their coarse residuals again. Thresholds remain declared engineering assumptions.

## Evidence and replay

Imported original segment bytes are checked against their digest and byte length before extracting a frame. Copied calibration measurements retain their segment digest and gain an exact float32 frame digest. Spectral observations must match that digest, frame offset, original artifact identity, and sampling profile. Original imported measurements remain unchanged. The numerical fitter itself does not read original recording files; its `source_artifact_bytes_verified: false` remains accurate.

New forecasts pin the scorer implementation files and NumPy/SciPy versions. Spectral observations additionally pin the spectral configuration and implementation. Changed policies fail before observation extraction; old coarse forecasts without a historical code pin remain explicitly `legacy_version_unverified`. Spectral forecasts cannot omit their scorer pin. Same-artifact wrong-frame attachments, invalid or clipped PCM, low-level frames, missing predictions and nonfinite values do not silently receive a favorable score.

## Budget and controls

The existing app calibration budget remains 60 native calls (five geometry proposals × three gain profiles × two calibration windows × joint/fixed-anatomy models), followed by 15 forecast calls and two geometry-export calls: 77 synthesis calls. Spectral extraction and bounded nuisance projection add no native calls. Gain profiles remain explicit and use the same native budget as the coarse comparison. F0 comes from the observed canonical pitch during fitting; JA remains a declared control. The new scorer does not learn how a person executes a cue.

The coarse objective `canonical-coarse-v1` remains the app default. The independently evaluated spectral mode is selectable as an experimental alternative, not promoted as universally superior. Both modes execute the same app pipeline; CLI selection is `--objective multires-log-spectrum-v1`. Missing spectral data does not silently fall back to coarse scoring when spectral mode was requested; reimport original PCM.

## Verification and interpretation

Targeted tests cover separate gain/shape/tilt behavior, nuisance bounds, invalid values, frame/source binding, original-byte tampering, native fitting and a different-vowel forecast followed by exact PCM scoring. The existing app HTTP test exercises the real capture import → search → sealed forecast → new capture → update path with spectral scoring enabled.

The independent frozen equal-budget study is in `evaluation/wave3/` and `docs/physiology/wave3-review.md`. Its initial results are mixed: gain robustness improves in a tested case, while noise, unsupported anatomy and held-out vowels expose failures. This implementation does not establish better anatomical recovery or broad generalization. No thresholds or spectral configuration were tuned after the independent held-out results were seen.

## Primary references

- Yamamoto, Song and Kim, [Parallel WaveGAN](https://arxiv.org/abs/1910.11480), motivates comparisons at multiple spectral resolutions for waveform modeling. Our pooled, gain-separated finite-frame discrepancy differs from their neural-vocoder training loss; their results do not validate anatomy inference here.
- [SciPy spectral analysis documentation](https://docs.scipy.org/doc/scipy/tutorial/signal.html#spectral-analysis) describes the density scaling and finite-window issues relevant to the estimator. The implementation uses explicit NumPy FFTs and a specified periodic Hann window so windowing, pooling and endpoints are visible and pinned.
