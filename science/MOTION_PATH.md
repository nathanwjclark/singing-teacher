# Recorded audio trajectory comparison

The app's `motion-forward-bank-2` replaces three sparse audio excerpts with a bounded, time-resolved comparison. It operates on the actual decoded audio in the saved, hash-verified companion recording. It does not align camera landmarks to internal geometry, alter the baseline anatomy, or identify measured jaw movement.

## Native prediction bank and measured windows

The entire recording (at most 30 seconds) is sampled on an evenly spaced temporal grid of at most 120 disjoint quarter-second excerpts. Each excerpt contributes the existing canonical 4096-sample frame (8192 at 96 kHz), beginning 100 ms into the excerpt. Short recordings have fewer windows; unvoiced, invalid, incomplete and out-of-pitch-support windows remain explicit missing observations. No window is selected because it happens to fit a hypothesis well.

The first three retained anatomy alternatives, JA values −4, −3 and −2 degrees, and digital gains 1 and 4 define the candidate bank. Minimum, median and maximum observed voiced pitch are retrospective pitch anchors. Each frame is compared to its nearest anchor only within 100 cents. This approximation is explicit in `pitchAnchorHz` and `pitchDistanceCents`; rapid or broad pitch changes can leave unsupported windows. No interpolation or continuous F0 resynthesis is implied.

There are at most 108 predeclared synthesis requests, including the existing fixed-anatomy comparator. Exact duplicate anatomy/pose/F0/duration requests reuse the same native waveform before gain and canonical extraction. `actualSynthesisCalls` counts native invocations and `trajectoryBank.synthesisRequests` counts requests. Increasing temporal resolution does not multiply the native synthesis bank. Original canonical bank predictions and their hashes are retained once in the result; per-window candidates refer to those bank hashes.

All usable windows share one objective scale vector: the larger of the existing declared descriptor scale and the maximum reported uncertainty for that descriptor across this recording. Per-window costs are mean squared standardized discrepancies. They are not likelihoods. Pitch anchors and scales use this recording, so these results are **retrospective explanatory comparisons**, not prospective or held-out acoustic predictions.

## Fixed anatomy and time-dependent regularization

`couple_motion_hypotheses(windows)` retains every usable anatomical alternative shared across the entire recording. Dynamic programming selects conditional JA/gain states for each anatomy and segment. It minimizes:

`sum(frame discrepancy) + λ sum[((ΔJA / 1 degree)² + (Δlog2 gain / 1 octave)²) × 0.25 s / Δt]`.

λ values 0, 0.1 and 1 are predeclared sensitivity settings. The elapsed-time factor avoids treating equal changes over different measured intervals identically. It is an engineering regularizer, not a measured motor law, calibrated process noise, or physiological speed limit. Source F0 follows the declared pitch-bank approximation; source mechanics, room and microphone assumptions remain conditional.

An acoustic gap greater than 0.5 seconds between measured frame spans breaks a transition. Missing windows also break transitions. Shared anatomy remains fixed across those gaps; the system never fills them with invented observations.

## Explicit ambiguity

Forward/backward dynamic programming computes the minimum complete-path objective for each candidate at every frame and each pair of neighboring control states. The UI shows the JA/gain alternatives within an objective gap of 0.1 from the global minimum across all retained anatomies. These are objective-sensitivity sets, **not confidence intervals or posterior probabilities**. Exact ties, anatomy alternatives, per-frame gaps, transition ambiguity and excluded windows remain in the result.

The time-course view displays discrete measured-frame positions, the selected conditional path, competing JA states and time-stamped ambiguity tables. It connects no missing intervals. A narrow sensitivity set does not establish that source/articulation ambiguity was resolved: the source bank is still restricted, and unmodeled source changes may be absorbed into apparent JA/gain changes.

## Verification and limits

Targeted tests cover complete-path enumeration versus min-marginal dynamic programming, elapsed-time scaling, gaps, ties, incompatible provenance, fixed anatomy, and the adaptive 120-window bound. Actual encoded WebM/native tests compare known simulator control trajectories, a noisy recording with explicit dropouts, and a changed-source challenge. Their frozen test sequence is evaluated against known simulator controls and a constant-control comparator; it is not labeled held-out acoustic validation or human anatomical accuracy.

Run:

```
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_motion_path.py science/tests/test_motion_trajectory.py science/tests/test_app_motion.py science/tests/test_app_motion_runtime.py -q
node --experimental-strip-types --test server/motion.test.mjs src/components/motion/motionClient.test.ts
npm run build
npm run lint
```

Actual human gesture accuracy, source generalization, calibrated uncertainty, audiovisual synchronization and cue-conditioned motor prediction require separate evidence. This analysis provides a bounded, inspectable audio trajectory hypothesis without rewriting that evidence or the user's baseline model.
