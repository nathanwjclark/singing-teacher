# Joint shared-anatomy and trial-articulation inference

`singing_physics.joint.fit_joint(engine, document, budget_per_model=120, starts=3, seed=1)` is a complete, bounded scientific fitter for **synthetic direct-transfer data**. It does not consume human microphone spectra or infer internal geometry from external depth.

The model fits shared hard-palate length (3.8–5.1 cm) and pharynx length (5.7–7.4 cm), with independent jaw angle JA (−5 to −1 degrees) for each calibration trial. Callers can narrow these declared boxes or choose a subset of the two anatomy variables. All other anatomy and pose controls use the pinned reference speaker. JA denotes the requested native control; native anatomical limiting still applies. This limited parameterization is an explicit experiment, not a complete anatomical reconstruction.

## Observation contract

The document uses `schema_version: "0.1.0"`, `kind: "synthetic_transfer_unknown_articulation"`, `sample_rate_hz` and `provenance` from the engine, `spectrum_bins: 512`, and an `observations` list. Each row declares a unique `id`, `split` (`calibration` or `held_out`), reference `pose`, and matching `frequency_hz` / `magnitude_db` arrays. Calibration uses the 512-point native frequency grid between 100 and 6000 Hz, with at least two different poses. `spectral_sigma_db` defaults to 1 and must be positive.

Optional `geometry_observations` have explicit split, `kind: "synthetic_direct_anatomy"`, `parameter` naming one free anatomy variable, `unit: "cm"`, finite `value`, and positive `sigma`. This maps a synthetic observation directly to the identically named native anatomy control. Neither a face scan nor a mouth opening measures hard-palate or pharynx length through this interface. External depth records are rejected, and no inferred prior is relabeled a measurement.

Held-out spectra and geometry values are never read for fitting or candidate selection. Held-out IDs are returned for independent evaluation; held-out articulation is not fitted. The calibration digest excludes held-out values. Caller inputs are copied and never modified. Engine anatomy is restored even when a native operation fails.

## Objective and compute

The objective is the sum of squared spectral residuals divided by declared spectral variance, plus squared standardized synthetic geometry residuals. These are user-declared weights; correlated frequency bins mean this objective does not establish calibrated probabilistic confidence.

Seeded bounded multistart least squares estimates the joint model. A separate fixed-reference-anatomy baseline fits the **same number of independent JA controls using the same bounds and total evaluation cap**. Both receive any geometry residual; it is constant for the fixed-anatomy model. Initial objective, retained best objective, spectral RMSE, start index, and termination are returned for every start. `budget_exhausted` is not reported as convergence. All actual residual calls, including numerical finite differences, count against the hard cap. Actual native spectrum calls are reported separately. Converged searches may use less than the cap.

Native failures abort and propagate rather than being converted into favorable likelihoods. No hidden generating anatomy or articulation is passed to the optimizer.

## Diagnostics and observed limitation

The result reports anatomy and articulation spread among near-optimal multistart solutions (within max(1 objective unit, 5% of best objective)). This operational threshold is not a confidence region. One start explicitly returns `insufficient_multistart_evidence`; all results say `identifiability: not_established` and `spread_is_calibrated_posterior: false`.

A real-native controlled experiment used hidden lengths 4.50 and 6.60 cm, JA −2.9 degrees in /a/ and /i/, and a synthetic hard-palate measurement with sigma 0.02 cm. With seed 1, three starts and 120 evaluations per model, the joint fit reached approximately 3.797 dB spectral RMSE versus 10.393 dB for the equally flexible fixed-anatomy baseline. It estimated lengths 4.543 and 6.792 cm and substantially wrong trial JA values. **This is a recovery failure despite improved fit.** It demonstrates the need for stronger experiments and identifiability assessment; it is not evidence of unique anatomy recovery. A stricter recovery test initially failed and was replaced by independently recomputed physical residual and honest diagnostic assertions, rather than claiming the scientific target had passed.

Tests exercise actual native predictions, immutable input, state restoration, deterministic held-out exclusion, budget accounting, baseline dynamic flexibility, invalid data/provenance/geometry, and native failure propagation. Run with the installed science environment and `PYTHONPATH=science/src python -m pytest science/tests/test_joint.py -q`.
