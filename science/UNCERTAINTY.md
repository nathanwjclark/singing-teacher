# Candidate spread and omitted-geometry investigation

This fixed development experiment tests what optimizer candidate spread can and
cannot say about anatomical accuracy. It uses the existing joint fitter and
keeps all six attempts. It does not estimate coverage, calibrate intervals, or
replace B's independent evaluation. No microphone/capture-response experiment is
included.

## Protocol fixed before execution

Three hard-palate/pharynx pairs (cm) are **4.50/6.60**, **4.40/6.50**, and
**4.47/6.57**. Each is generated once with reference geometry and once with an
omitted palate-depth change to **4.2 cm**. Calibration uses a/i/u at JA −3°.
The fitter receives spectra and pose labels, but independently estimates JA for
each calibration vowel alongside the two shared anatomical dimensions.

Every case uses seed **53**, **three starts**, and **75 residual calls per model**
for both free-anatomy and fixed-anatomy fitting. This is below the fitter's global
search activation threshold; these are bounded local searches. The total cap is
**2,700 fitting spectra**, plus 30 generation/held-out spectra. No seed, anatomy,
threshold or budget is selected after inspecting the output.

Report the range across all optimizer candidates and the fitter's near-optimal
candidate subset separately. The latter uses its existing objective tolerance,
not a statistical confidence cutoff. A singleton subset has a numerical range of
zero, but supplies **no dispersion evidence**. All convergence/budget statuses
are retained for joint and baseline fits.

Predeclared illustrative diagnostics are calibration RMSE ≤1 dB, near-candidate
range ≤0.02 cm, and anatomy error >0.05 cm. These are neither clinical accuracy
requirements nor a calibrated uncertainty rule. The multi-candidate diagnostic
requires at least two near candidates; a singleton cannot qualify.

Only after saving `fit.json` does scoring load generating anatomy. The held-out
/e/ uses the predeclared JA −3° for truth and prediction. This is a conditional
known-articulation check, not a prospective cue-execution forecast. Protocol,
script/fitter hashes, engine provenance, inputs, fits and scores are preserved.

## Reproduction and verification

From the repository root, using the installed scientific Python environment and
certified native build:

```sh
PYTHONPATH=science/src python science/scripts/uncertainty_challenge.py --output science/artifacts/uncertainty-new-run
PYTHONPATH=science/src python -m pytest science/tests/test_uncertainty_challenge.py -q
```

Choose a fresh directory. Reusing an output path fails before any computation or
overwrite. A failed numerical attempt remains in the report and causes a nonzero
exit after all cases have been attempted. The targeted tests use a real small
native fit, verify scoring-only truth does not alter saved fit bytes, and reject
reporting singleton spread as multi-candidate evidence.
