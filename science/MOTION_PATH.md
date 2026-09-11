# Recorded audio trajectory comparison

The app's `motion-forward-bank-3` compares a time course of audio windows from the saved, hash-verified companion recording with a bounded native prediction bank. It does not align camera landmarks to internal geometry, alter the baseline anatomy, or identify measured jaw movement. Evidence from the generated fixtures below is `synthetic`; the scientific outcome for human singing is `untested`.

## Measured windows

The recording is limited to 30 seconds (`MAX_RECORDING_SECONDS`). It is sampled on an evenly spaced grid of at most 120 disjoint quarter-second excerpts. Each excerpt contributes the canonical 4096-sample frame (8192 at 96 kHz), beginning 100 ms into the excerpt. Short recordings have fewer windows. Unvoiced, invalid, incomplete and out-of-pitch-support windows remain explicit missing observations with a reason and a time. No window is selected because it happens to fit a hypothesis well.

Encoded containers add codec padding, so a 30.0 s recording can report a slightly longer duration. Containers reporting up to 30.5 s are accepted; the decoder reads only the first 30 s, and `decode.truncated` records whether the container was longer than that.

## Candidate bank

**Hypotheses.** The bank uses the top three hypotheses of the frozen baseline snapshot, in the snapshot's own rank order. The session freezes that order from its search discrepancy (or from the adopted probe ranking). `hypothesisSubset` records the ranking basis, its receipt hash, the snapshot hash and the selected anatomies. The subset depends only on the frozen snapshot, so it is fixed before any recording byte is decoded. A snapshot that declares no ranking is labelled as caller order.

**Controls.** Each hypothesis is combined with JA −4, −3 and −2 degrees and digital gains 1 and 4. `fit_pcm` also synthesizes its fixed-anatomy comparator at the same controls and equal compute. The time course does not use the comparator, so its predictions stay only in the bank artifacts.

**Pitch anchors.** With 11 or more measured voiced windows, the anchors are the nearest-rank 10th, 50th and 90th percentiles of measured pitch in this recording, so one octave error or other outlier cannot become an anchor. At exactly 10 windows the nearest-rank 10th percentile is the lowest pitch, so with 10 or fewer windows only the median anchors the bank and `pitchAnchorPolicy` says so. Percentile anchors within 50 cents of a lower kept anchor would duplicate one bank and are merged into it; a steady recording therefore uses one bank. Each window is compared only with its nearest anchor (lower on ties), and only within 100 cents.

The 100-cent support means a window can be compared with predictions synthesized up to one semitone away from its own pitch. The bank does not resynthesize each window's F0. This mismatch enters every candidate of that window through the pitch descriptor. At 180 Hz, 100 cents is about 10.7 Hz, or 0.53 of the 20 Hz pitch scale. It adds up to about 0.06 to the window's mean-square cost, much the same for every candidate, so it mainly raises the level of that window's cost rather than reordering its candidates. `pitchAnchorHz` and `pitchDistanceCents` are recorded per window. The test `test_robust_pitch_anchors_ignore_a_single_octave_error` shows the change. For pitches 160–210 Hz with one octave error at 370 Hz, the earlier minimum/median/maximum rule anchored 370 Hz, scored the octave-error window and left four real pitches unsupported. The percentile rule keeps all eleven real pitches supported and marks the octave error as unsupported.

A path control change between two linked windows that use different anchors may follow the source pitch change rather than articulation. Such transitions carry `pitchBankSwitch`, and each λ lists `pathChangesAtPitchBankSwitch`. The timeline draws a dashed line at every anchor change and names the path changes that coincide with one.

**Budget.** There are at most 108 synthesis requests (3 anchors × 2 models × 3 hypotheses × 3 JA × 2 gains, including the comparator). `score_forward_bank` computes the request count from the declared hypotheses and anchors before any synthesis and refuses when it exceeds 108. Exact duplicate anatomy/pose/F0/duration requests reuse one native waveform, so `actualSynthesisCalls` (native invocations) is usually lower than `trajectoryBank.synthesisRequests`.

**Objective.** Rescoring always uses the coarse canonical descriptors (`COARSE_OBJECTIVE` = `canonical-coarse-v1` from `pcm_spectral`: dBFS, centroid, flatness, pitch, periodicity), even when the baseline was fitted with the spectral objective. `objective` records this next to the objective the baseline run declares. The app's capture pipeline records the fit objective in the run summary; a summary without an `objective` field predates selectable objectives and counts as coarse. When the baseline declares another objective, the result carries the warning `objective-differs-from-baseline`, because the motion ranking can then differ from the baseline fit.

**Scales.** Each window uses its own scale vector from `pcm_inverse.feature_scale`, the rule `fit_pcm` applies per trial: the declared engineering scale, widened only by that window's own reported descriptor uncertainty. Costs combine through `pcm_inverse.candidate_discrepancy`, as in `fit_pcm`. A noisy window therefore weights itself down without changing any other window's costs. The current canonical extractor reports no descriptor uncertainty, so every window uses the declared scales today. Per-window costs are mean squared standardized discrepancies, not likelihoods. Pitch anchors use this recording, so these are **retrospective explanatory comparisons**, not held-out predictions.

**Retained outputs.** The summary keeps compact per-window rows: candidate, anatomy hash, JA, gain, status and cost. Missing-feature reasons appear only where a candidate cannot be scored. Complete bank predictions are written once per anchor as `bank-N.json` beside the summary and cited by `sha256` (canonical JSON). With three hypotheses the summary grows by about 10 KB per window: the 120-window, three-hypothesis test recording writes 1.22 MB, below the 2 MiB session-export file limit, and the tests enforce `64 KB + 12.5 KB × windows`. The previous format was 565 KB for 12 windows and would have reached about 5.6 MB at 120 windows, beyond both the export limit and the 4 MiB Astra context read limit. The 12-window one-hypothesis fixture summary is now 87 KB.

## Fixed anatomy and time-dependent regularization

`couple_motion_hypotheses(windows)` keeps every anatomical alternative scored across the entire recording. Dynamic programming selects conditional JA/gain states for each anatomy and segment. It minimizes:

`sum(frame discrepancy) + λ sum[((ΔJA / 1 degree)² + (Δlog2 gain / 1 octave)²) × 0.25 s / Δt]`.

The bracketed sum is reported as `timeScaledTransitionCost`, and λ times it as `weightedTransitionCost`. λ values 0, 0.1 and 1 are predeclared sensitivity settings. The elapsed-time factor avoids treating equal changes over different measured intervals identically. It is an engineering regularizer, not a measured motor law, calibrated process noise or physiological speed limit.

A gap of more than 0.5 seconds between measured frame spans breaks a transition, and so does a missing window. Within the 30-second limit, adjacent frames on the grid are at most about 0.41 s apart, so they always link (`test_adaptive_grid_has_disjoint_frames_and_hard_bound`). If the grid were stretched over a longer recording, frames more than 0.5 s apart would all break, and the result would be `no-temporal-links` (`test_link_gap_boundary_between_measured_frames`). Shared anatomy stays fixed across gaps; the system never fills them with invented observations.

## Explicit ambiguity

Forward/backward dynamic programming computes the minimum complete-path objective for each candidate at every frame and each pair of neighbouring control states. The JA/gain alternatives within an objective gap of 0.1 of the global minimum across all retained anatomies form the sensitivity sets. `candidateObjectiveGaps` gives every candidate's gap in the window's candidate order (null where unscored). These are objective-sensitivity sets, **not confidence intervals or posterior probabilities**. Exact ties, anatomy alternatives, per-frame gaps, transition ambiguity and excluded windows remain in the result. The first entry of `alternatives` is the minimum-objective path.

## Improvement over a constant path

Source changes the fixed-source bank cannot represent can be absorbed into apparent JA/gain changes, and measurement noise or pitch-bank switches also let a time-varying path fit better than a constant one. For every λ, `constantComparison` reports the best constant path: one anatomy and one JA/gain control scored in every usable window, with no transition cost. It gives that path's objective, its summed `improvement` from the best path, `improvementPerWindow`, the `tolerance` and whether the constant path is `admissible`.

The tolerance is `constantTolerancePerWindow` (0.01) times the number of included windows, declared in the settings. A fixed tolerance on the summed improvement would drift with recording length: a time-varying path picks the best candidate in every window, so it gains a little on noise alone in each one. With the same small score noise and a truly constant control, the summed improvement was 0.005 at 12 windows but 0.108 at 120, which a fixed 0.1 tolerance read as "exceeds". Per window it is 0.0004 and 0.0009, well inside 0.01 (`test_constant_control_with_small_noise_stays_within_tolerance_at_any_length`). The 0.01 value was chosen with the fixtures below already known; it is an engineering tolerance, not a calibrated test.

The λ = 0 optimum has the lowest objective at any λ, so a constant path admissible at λ = 0 is admissible at every λ. `informationOverConstant` is then `within-tolerance` and the warning `constant-within-tolerance` is added; otherwise it is `exceeds-tolerance`. Neither result on its own shows or rules out a control change. With fewer than two usable windows, or with no control scored in every window, the value is `not-evaluated`.

The generated fixtures (native simulator controls, 12 windows, one hypothesis) show what the check can and cannot see:

| Fixture | Path MAE vs truth | Best constant MAE | Improvement at λ 0 / 0.1 / 1 (tolerance 0.12; 0.10 with 10 windows) | `informationOverConstant` |
|---|---|---|---|---|
| known native controls | 0.00° | 0.50° | 0.614 / 0.366 / 0 | exceeds-tolerance |
| 2.5% noise, two dropped windows | 0.00° | 0.40° | 0.052 / 0 / 0 | within-tolerance (warning) |
| changed source (mismatched) | 0.50° | 0.50° | 0.345 / 0 / 0 | exceeds-tolerance; constant admissible at λ 0.1 and 1 |
| varying pitch 160–210 Hz + octave error | 0.18° | 0.45° | 0.359 / 0.218 / 0.015 (11 windows) | exceeds-tolerance |

The mismatched-source recording exceeds the tolerance at λ = 0: its free path explains the audio better than any constant path, yet it is no closer to the true controls. At the default λ = 0.1 the app shows the improvement within tolerance. The noisy recording stays within tolerance although its free path matches the truth: its informative −2° windows were dropped, and the remaining −4°/−3° differences are small.

The time-course view shows measured frames, the selected conditional path joined only inside linked segments, JA sensitivity sets, pitch-bank anchor changes, and missing windows marked with their reasons. It also shows the constant-path comparison for the selected λ and time-stamped ambiguity tables. It connects no missing interval.

## Astra context

`server/motionContext.mjs` passes a bounded summary to Astra, at most 24,000 characters. It samples at most 12 evenly spaced entries per list: windows (with their three lowest-discrepancy candidates), segment boundaries, excluded windows with reasons and counts by reason, the minimum-objective path, and per-λ window and transition sensitivity sets. The sensitivity samples prefer windows and transitions with more than one admissible value. Each list keeps its full count. The context also carries the constant comparisons with their tolerance definition, the temporal limitations (each at most 400 characters), path changes at pitch-bank switches, `informationOverConstant`, warnings, the objective record, and the number of distinct exclusion reasons. When the context exceeds the limit, the samples shrink to 8, 4, then 2 entries. If it still does not fit, Astra receives `unavailable` with that reason. For the 120-window, three-hypothesis recording the context is about 21,600 characters.

## Verification and limits

Run:

```
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_motion_path.py science/tests/test_motion_trajectory.py science/tests/test_app_motion.py science/tests/test_app_motion_runtime.py -q
node --experimental-strip-types --test server/motion.test.mjs server/motionContext.test.mjs src/components/motion/motionClient.test.ts
npx playwright test -c tests/motion-timeline.config.ts
npm run build
npm run lint
```

The tests cover:

- complete-path enumeration against min-marginal dynamic programming;
- elapsed-time scaling, gaps, the link-gap boundary and ties;
- incompatible provenance, per-window scales and fixed anatomy;
- the synthesis budget refusal, the declared hypothesis selection, robust and merged anchors, and path changes at pitch-bank switches;
- the per-window constant tolerance at 12 and 120 windows;
- encoded WebM/native runs: known controls, noise with dropouts, changed source, varying pitch with an octave error, and a 30-second, 120-window, three-hypothesis recording;
- the Astra reduction of a real pipeline summary;
- the app's HTTP route with a real baseline fit and 24 windows;
- a browser run of the timeline, its gaps and its ambiguity table.

The fixtures are scored against known simulator controls and a constant-control comparator. They are not held-out acoustic validation or human anatomical accuracy.

Human gesture accuracy, source generalization, calibrated uncertainty, audiovisual synchronization and cue-conditioned motor prediction need separate evidence. This analysis gives a bounded, inspectable audio trajectory hypothesis without rewriting that evidence or the user's baseline model.
