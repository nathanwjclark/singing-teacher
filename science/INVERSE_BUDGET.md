# Transfer fitter compute accounting

`fit(..., max_spectrum_evaluations=20000)` enforces one total native spectrum-call
budget across the fixed-template baseline, global search, finite differences and
local refinements. Every objective predicts every observation; a remaining budget
smaller than one complete objective is deliberately unused. The minimum budget
is the observation count, which permits a finite baseline candidate.

`max_evaluations` remains the per-local-refinement SciPy `max_nfev` setting; it is
not a total compute budget. `objective_evaluations` counts complete residual
vectors. `spectrum_evaluations` and `actual_forward_evaluations` count actual
native spectrum calls. Baseline and optimization counts are reported separately
and sum to the total. This corrects the old `actual_forward_evaluations` field,
which counted residual vectors rather than native calls.

On exhaustion the fitter reports `termination: spectrum_budget_exhausted` and
returns the best finite evaluated candidate, including the baseline if no search
point improves it. An interrupted optimizer is not reported as converged. Retain
up to `starts` candidates; a better intermediate evaluation can replace the
worst completed endpoint. These candidates are not a calibrated posterior.

Native-backed bounded checks:

```sh
python -m pytest science/tests/test_inverse_budget.py -q
```

The tests exercise baseline-only, partial-objective remainder, global-search
exhaustion, invalid budgets and deterministic replay, without an expensive sweep.
