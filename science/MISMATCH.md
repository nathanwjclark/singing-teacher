# Fixed-budget model-mismatch development challenge

This investigation challenges the existing two-anatomy transfer fitter. It does
not replace B's independent EVAL-01, establish human recovery, or test the newer
joint-articulation algorithm. All three attempts are retained without selecting a
winning seed or changing optimizer settings.

## Predeclared protocol

One generating anatomy has hard-palate length **4.42 cm** and pharynx length
**6.83 cm**. Calibration uses template a/i/u; e is held out until the fit is
written. Three cases use the same optimizer seed **47**, one start, and a hard
**900 native spectrum-call fitting budget each**, including their baseline:

1. Clean, same-simulator transfer observations.
2. The generating palate depth is changed to **4.2 cm**; the fitter retains its
   reference palate depth. This creates an omitted anatomical variable.
3. Clean observations receive **3 dB/octave** tilt relative to 1 kHz. This is a
   deliberately narrow capture-response proxy, not a microphone or room model.

Only observation spectra, pose names, frequency grid and simulator provenance
enter `fit`. Truth, perturbation labels/parameters and held-out spectra remain in
generation/scoring. A successful numerical call is not an anatomical recovery
pass. All attempts may be budget-limited; optimization error can therefore
confound attribution of poor results exclusively to mismatch.

The fitted call budget totals 2,700 spectra. Generating calibration spectra and
scoring held-out predictions require 15 additional spectra. Native parameter
updates and geometry limiting are not spectrum calls.

## Reproduction

Use the installed scientific Python environment and certified native build,
from the repository root:

```sh
PYTHONPATH=science/src python science/scripts/mismatch_challenge.py --output science/artifacts/mismatch-new-run
```

The output must be a fresh directory. Every case preserves observation-only
input, fit output and scoring results. `report.json` includes engine provenance,
the exact script hash, settings, anatomy drift and limitations. Failed attempts
are recorded and cause a nonzero exit. No clinical or human precision claim is
attached to these values.

## Observed results

The single predeclared run completed all three attempts. Every attempt exhausted
its 900-call fitting budget; none is reported as optimizer convergence.

| Case | Palate absolute error (cm) | Pharynx absolute error (cm) | Palate drift from clean (cm) | Pharynx drift from clean (cm) | Calibration RMSE (dB) | Held-out RMSE (dB) | Fixed-anatomy baseline RMSE (dB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| clean | 0.000315 | 0.000672 | 0.000000 | 0.000000 | 0.018096 | 0.022111 | 41.038662 |
| fixed_geometry_mismatch | 0.015064 | 0.020538 | 0.015378 | -0.021209 | 1.558766 | 2.301906 | 40.783415 |
| smooth_transfer_tilt | 0.002252 | 0.020184 | 0.002567 | -0.020855 | 4.625649 | 4.749758 | 38.468460 |

Both perturbations increase held-out error and shift the inferred anatomy. This
is evidence of sensitivity to omitted geometry and spectral coloration in this
one controlled example, not a general failure rate or a calibrated detection
threshold. All three fits strongly improve on the fixed-template calibration
baseline, including the mismatched cases: improvement alone does not establish
correct anatomy or adequate physics.

The fitter does not detect model mismatch or return calibrated uncertainty. Its
returned candidate spread cannot establish that the generating anatomy is covered.
No interval-coverage or automatic mismatch-detection pass is claimed. A subsequent
experiment must add nuisance-response/geometry freedom and independently test
whether it reduces anatomy drift under equal budgets without destroying
identifiability. These results motivate that experiment rather than proving its
solution.

Validation: the fixed three-case command exited successfully; all fits report
exactly 900 spectrum evaluations and finite scores. Fresh-directory protection
was verified separately without rerunning numerical optimization.
