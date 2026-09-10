# App source-bank budget

The optional source fit preserves the same pulse-skew support for every retained anatomy. One or two geometries use PS values `[-0.2, 0, 0.2]`; three through eight geometries use `[-0.2, 0.2]`. More than eight geometries are explicitly unsupported by this app profile. Geometry count never silently collapses source support to one fixed PS value.

The normal five-geometry profile therefore fits ten source/tract candidates. Its joint, fixed-source and fixed-anatomy comparisons require 30 native synthesis calls; the corresponding prospective bank freezes all 30 alternatives with another 30 calls. The maximum eight-geometry profile has 16 candidates and 48 alternatives. Each app phase retains its 90-second numerical deadline; missing or timed-out alternatives remain explicit, and incomplete source fitting does not replace a valid prior model.

These are bounded simulator alternatives, not inferred vocal-fold contact or calibrated anatomical probabilities. Held-out bank scoring extracts the original observation once, performs no new synthesis, preserves the baseline anatomy model, and retains conditional ranking provenance separately.

`test_source_app_budget.py` checks equal PS support and the numerical call bounds. `test_app_source_loop.py` verifies actual fit/bank call counts, two later recordings, ranking parents and replay through the app and native worker; its runtime depends on available compute.
