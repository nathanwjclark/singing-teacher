# MOT-01 empirical cue-conditioned execution

Internal API, pending B's public ControlProfile contract:

```python
from singing_physics.control import fit_control_profile, execution_distribution
profile = fit_control_profile(attempts, anatomy_model_id="stable-model-id",
                              fitted_at="2026-01-02T00:00:00Z")
distribution = execution_distribution(profile, cue_id="reviewed-cue-id",
    cue_version="1", context={"pitch_hz": 160., "vowel": "a",
    "level": "comfortable", "posture": "seated"}, mode="elicited")
```

Every attempt requires attempt/evidence IDs; cue ID/version; the exact four-field
context; mode (`elicited`, `recalled`, `transfer`); timezone-aware `observed_at`;
`operator_id`; `comfortable` boolean; sensor status (`valid`/`invalid`) and nullable
sensor reason; execution status (`successful`/`unsuccessful`/`unknown`); nullable
`JA` in degrees and `measurement_sigma_deg`; `source_kind` (`direct_measurement`,
`inferred_articulation`, `synthetic`); `uncertainty_scope`; nullable
`derived_model_id` (required for inferred articulation). Optional sensation text
is retained subjectively and never used to update anatomy or numerical control
estimates. Level is a declared matching task label, not invented calibrated SPL.
Missing/sensor-invalid movement is null, never fabricated zero motion.

The profile retains all attempts and evidence IDs, checks duplicates and rejects
post-freeze observations. `profile_sha256` hashes sorted compact JSON of every
profile field except that hash. `execution_distribution` reconstructs and
validates the profile and hash before use. Callers must separately exclude target
evidence, enforce prospective collection ordering, verify cue review and supply
the complete attempt log; retrospective timestamps cannot prove these properties.

A distribution needs three measured or inferred states in the exact cue/version,
context and mode. Unknown contexts and small samples return explicit unsupported
or insufficient-data status without forecast samples. Measurement operators and
source kinds cannot be silently pooled. Successful and unsuccessful measured
attempts enter the empirical atoms equally. Each atom's weight is 1 divided by
all matching attempts: weights sum to observed support mass, with missing mass
explicit. Forecast callers must not silently renormalize away missing execution.
Failure and sensor-invalid frequencies retain their separate denominators.
Recorded frequencies are not established unconditional future success rates;
selective logging invalidates that interpretation.

For declared direct measurements/synthetic controls with independent zero-mean
measurement errors, observed sample variance and supplied measurement variance
are separated; the nonnegative difference estimates between-attempt variation.
This assumption is explicit, and variation beneath measurement noise is marked
unresolved. Inferred MAP articulation points have no such decomposition: their
spread is not calibrated motor variance. Inferred uncertainty may be null and is
preserved, never manufactured from optimizer spread. Empirical point forecasts
remain conditional on the upstream model; these atoms are not posterior samples.

Comfortable observed minima/maxima and successful comfortable repetitions are
reported separately by mode. Neither is a physiological maximum or guaranteed
future reachability. This module does not alter anatomy, invent muscle controls,
fit motion trajectories, prescribe new cues or establish learning improvement.
Retention and transfer efficacy require independent longitudinal evidence.

Run `PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_control.py -q`.
Acceptance covers known synthetic variation/noise, measured failures, occlusion,
context/mode separation, freeze integrity, sensations, small samples and inferred
uncertainty. No native simulator or additional dependencies are needed.
