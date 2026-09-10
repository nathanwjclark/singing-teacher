# Joint shared-anatomy and trial-articulation inference

`singing_physics.joint.fit_joint(engine, document, budget_per_model=120, starts=3, seed=1)` is a complete, bounded scientific fitter for **synthetic direct-transfer data**. It does not consume human microphone spectra or infer internal geometry from external depth.

The model fits shared hard-palate length (3.8–5.1 cm) and pharynx length (5.7–7.4 cm), with independent jaw angle JA (−5 to −1 degrees) for each calibration trial. Callers can narrow these declared boxes or choose a subset of the two anatomy variables. All other anatomy and pose controls use the pinned reference speaker. JA denotes the requested native control; native anatomical limiting still applies. This limited parameterization is an explicit experiment, not a complete anatomical reconstruction.

## Observation contract

The document uses `schema_version: "0.1.0"`, `kind: "synthetic_transfer_unknown_articulation"`, `sample_rate_hz` and `provenance` from the engine, `spectrum_bins: 512`, and an `observations` list. Each row declares a unique `id`, `split` (`calibration` or `held_out`), reference `pose`, and matching `frequency_hz` / `magnitude_db` arrays. Calibration uses the 512-point native frequency grid between 100 and 6000 Hz, with at least two different poses. `spectral_sigma_db` defaults to 1 and must be positive.

Optional `geometry_observations` have explicit split, `kind: "synthetic_direct_anatomy"`, `parameter` naming one free anatomy variable, `unit: "cm"`, finite `value`, and positive `sigma`. This maps a synthetic observation directly to the identically named native anatomy control. Neither a face scan nor a mouth opening measures hard-palate or pharynx length through this interface. External depth records are rejected, and no inferred prior is relabeled a measurement.

Held-out spectra and geometry values are never read for fitting or candidate selection. Held-out IDs are returned for independent evaluation; held-out articulation is not fitted. The calibration digest excludes held-out values. Caller inputs are copied and never modified. Engine anatomy is restored even when a native operation fails.

## Objective and compute

The objective is the sum of squared spectral residuals divided by declared spectral variance, plus squared standardized synthetic geometry residuals. These are user-declared weights; correlated frequency bins mean this objective does not establish calibrated probabilistic confidence.

For budgets of at least 80 residual evaluations, seeded differential evolution receives half the cap for global exploration. Its best proposal seeds local refinement and remains eligible even if refinement fails to improve it. Bounded multistart least squares receives the remaining cap. Smaller budgets use only local search. Both phases share the strict evaluation counter; global exploration does not add an unreported budget. A separate fixed-reference-anatomy baseline fits the **same number of independent JA controls using the same bounds and total evaluation cap**. Both receive any geometry residual; it is constant for the fixed-anatomy model. Initial objective, retained best objective, spectral RMSE, start index, and termination are returned for every start. `budget_exhausted` is not reported as convergence. All actual residual calls, including numerical finite differences, count against the hard cap. Actual native spectrum calls are reported separately. Converged searches may use less than the cap.

Native failures abort and propagate rather than being converted into favorable likelihoods. No hidden generating anatomy or articulation is passed to the optimizer.

## Diagnostics and observed limitation

The result reports anatomy and articulation spread among near-optimal multistart solutions (within max(1 objective unit, 5% of best objective)). This operational threshold is not a confidence region. One start explicitly returns `insufficient_multistart_evidence`; all results say `identifiability: not_established` and `spread_is_calibrated_posterior: false`.

A real-native controlled experiment used hidden lengths 4.50 and 6.60 cm, JA −2.9 degrees in /a/ and /i/, and a synthetic hard-palate measurement with sigma 0.02 cm. With seed 1, three starts and 120 evaluations per model, the joint fit reached approximately 3.797 dB spectral RMSE versus 10.393 dB for the equally flexible fixed-anatomy baseline. It estimated lengths 4.543 and 6.792 cm and substantially wrong trial JA values. **This is a recovery failure despite improved fit.** It demonstrates the need for stronger experiments and identifiability assessment; it is not evidence of unique anatomy recovery. A stricter recovery test initially failed and was replaced by independently recomputed physical residual and honest diagnostic assertions, rather than claiming the scientific target had passed.

Tests exercise actual native predictions, immutable input, state restoration, deterministic held-out exclusion, budget accounting, baseline dynamic flexibility, invalid data/provenance/geometry, and native failure propagation. Run with the installed science environment and `PYTHONPATH=science/src python -m pytest science/tests/test_joint.py -q`.


## Predeclared recovery challenge

Before running the extended challenge, the approach was fixed to half-budget differential evolution followed by local refinement, at 1,000 evaluations per model with three local starts. The development case remains the failed case above (4.50/6.60 cm, JA −2.9 in both trials, same synthetic geometry measurement). The prior 120-evaluation result is descriptive context, not an equal-compute algorithm comparison. After development, the algorithm is frozen for one new challenge generated with seed 349; no repeated tuning against that challenge is permitted. The fresh case samples lengths uniformly from [4.0, 4.9] and [5.9, 7.2] cm and independent trial JA uniformly from [−4.5, −1.5] degrees. It retains /a/ and /i/ and a synthetic direct hard-palate measurement with sigma 0.02 cm. Both challenge fits use optimizer seed 1 and at most 4,000 combined residual evaluations in total. Ground truth is used solely for generation, the explicitly declared measurement, and post-fit scoring; it never initializes the optimizer.

Development result: the global/local search achieved 0.508615 dB joint RMSE versus 10.392801 dB fixed-anatomy RMSE. Estimated lengths were 4.492862 and 6.578003 cm (errors 0.007138 and 0.021997 cm). Estimated JA was −3.033073 and −3.479748 degrees (errors 0.133073 and 0.579748 degrees). Actual compute was 753 joint plus 552 baseline residual calls, totaling 1,305 calls and 2,610 native spectra. This improves the development fit and geometry separation but retains articulation error.

Fresh seed-349 challenge (single run after freezing): joint RMSE 0.189047 dB versus fixed-anatomy baseline 49.656440 dB. Ground-truth lengths were 4.322516 and 6.645172 cm; estimates were 4.324485 and 6.644708 cm (absolute errors 0.001968 and 0.000464 cm). True JA values were −2.100297 and −3.768593 degrees; estimates were −2.108651 and −2.813065 degrees (errors 0.008355 and 0.955528 degrees). Actual compute was 684 joint plus 558 baseline residual calls, totaling 1,242 calls and 2,484 spectra. The two challenge runs consumed 2,547 residual calls, below the predeclared 4,000-call cap. Routine validation tests are separate from this challenge budget.

The frozen fitter SHA-256 was `f19303d9b56c7ae21fcdcd9f71862b0cd7abbd16a9d0149e184392cf138b9f7a`. The algorithm was not changed after observing the fresh case. The fresh case is an independently generated synthetic subject used to assess the frozen fitting procedure; it is not a held-out spectrum used to tune that subject's state.

These results support better shared-anatomy recovery in these two narrow controlled cases, with a synthetic direct anatomical measurement. They do **not** establish unique recovery, independent real-world validity, or complete anatomy/articulation separation: the fresh /i/ jaw-angle estimate remains almost one degree wrong despite low spectral error. The earlier development failure and this remaining ambiguity are retained rather than erased by the improvement.
