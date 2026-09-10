# Frozen-anatomy single-vowel control reconstruction

`singing_physics.frozen_control.fit_frozen_control(engine, snapshot, document, *, expected_digest, candidate_id, budget=240, seed=1)` estimates only per-frame JA, including single-vowel trajectories. Anatomy is never optimized. This is an executable internal scientific profile for synthetic direct-transfer spectra, not a public phone-audio contract or a claim of human motor-control accuracy.

## Immutable physical snapshot

`snapshot` is the existing `prediction.Artifact` produced by `freeze_candidates`. Supply the externally recorded `snapshot.sha256` as `expected_digest` and an existing `candidate_id`. The bytes must match that digest **and** the canonical validated representation. The selected candidate must explicitly contain all 13 native anatomy parameters, satisfy individual bounds and the coupled mouth/jaw-height constraint, and match the running engine's full provenance. Unknown candidate IDs, partial anatomy, changed artifacts, stale provenance and noncanonical representations fail before fitting.

The forward basis is the native tract reconstructed by `set_anatomy`. Investigation initially found that an untouched legacy JD3 tract differed from its 13-parameter reconstruction by about 1.24 dB for an otherwise identical /a/ control. This was an operator mismatch, not anatomical recovery error. The engine now canonicalizes initialization and records `geometry_basis: vtl-anatomy-params-reconstructed-v1`; old provenance is rejected. Synthetic observations must use that same declared basis. No assumption is made that 13 scalar controls reproduce every possible original speaker file or a person's full anatomy.

The original snapshot `model_id` is retained as `derived_model_id` in inferred states for control-profile binding. Every state additionally includes the immutable snapshot digest and selected candidate ID. Its operator ID incorporates both, so separately frozen snapshots cannot silently become one measurement operator merely by reusing a model label. Callers remain responsible for retaining the original artifact and trustworthy expected digest; a content hash does not prove anatomical truth or authenticate self-reported timestamps.

## Document and service wiring

The document contains:

- `schema_version: "0.1.0"`, `kind: "frozen_anatomy_dynamic_transfer"`.
- `provenance` from the same engine, `sample_rate_hz`, and `spectrum_bins: 512`.
- Optional positive `spectral_sigma_db` (default 1) and `max_gap_seconds` (default 0.1).
- An `attempts` list with the same frame organization used by dynamic reconstruction.

Each attempt has `attempt_id`, cue ID/version, `context_id`, nonempty finite JSON context, explicit calibration/held-out split, timezone-aware `observed_at`, and `cue_delivered_seconds`. `observed_at` must be strictly later than snapshot `frozen_at`. It is a declared absolute capture time; relative session frame timestamps do not independently prove that ordering. Optional mode is elicited/recalled/transfer; execution status is successful/unsuccessful/unknown. Motion capture `outcome` is preserved; unsuccessful defaults to unsuccessful execution, while completed capture is not automatically successful execution. Actual onset is optional, distinct from cue delivery, and must be within the captured interval.

Frames have unique `id`, `audio_evidence_id`, session timestamp/timebase, nonnegative synchronization bound, pose, frequency and magnitude arrays, and explicit visibility/geometry status. Spectra use the same 100–6000 Hz subset of the native 512-point grid. A single reference vowel is valid. Visible geometry uses the existing calibrated `visible_lip_distance` record, matched to frame ID/split/timebase and the experimental conservative 20 ms alignment limit. Missing or occluded geometry requires a reason; numeric geometry is ignored while valid audio is retained. Measured visible geometry and predicted native geometry remain separate fields.

All capture identity metadata is checked against the frozen anatomy's training evidence. Calibration and held-out capture IDs must be disjoint. Top-level and nested depth aliases must agree; nested held-out IDs are checked even when top-level aliases are absent. Held-out numerical spectra/geometry/pose values are not fitted. Repeated physical audio/depth keys are rejected. One recording artifact may contain distinct timestamped windows; timestamp changes are not treated as fraud without a source manifest proving otherwise. Source-ID exclusion between training/calibration/held-out sets is deliberately conservative for such recordings. Frame order, clock consistency, cue/context identity, gaps, unsuccessful execution and explicit missing states are retained.

The service passes a stored canonical `Artifact`, parsed document, `expected_digest`, and `candidate_id`; optional solver parameters are only `budget` and `seed`. Reusable test fixture `science/tests/test_frozen_control.py::frozen_fixture(engine, occluded=False)` returns `(snapshot, document, truth_JA)` with three fresh /a/ frames, complete anatomy and post-freeze capture dates.

## Compute and results

A deterministic bounded grid over requested JA from −5 to −1 degrees selects a bracket, followed by bounded scalar refinement. Seed controls grid tie order; it does not change the searched grid. The hard budget covers **spectrum calls plus native geometry calls**, not just optimizer iterations. Allocation accounts for whether each frame needs one or both operators. At least five objective evaluations per fitted frame are required. Explicit native pose-metadata calls are reported separately; they are not acoustic/geometry forward evaluations.

Every evaluated incumbent is retained, including when refinement exhausts its budget. Results report per-frame and total forward counts, convergence/limit status, spectral error, complete requested/applied native controls and the sampled near-optimal requested-JA range. That range is not a posterior or confidence interval. `JA` is the native **applied** control; `requested_JA` preserves the optimizer input. `measurement_sigma_deg` remains null and source kind is `inferred_articulation`. Optimizer convergence does not prove physiological correctness or identifiability.

Engine anatomy is restored on success and native failure. There is no temporal interpolation, anatomical update, true movement-limit estimate or prospective forecast. To create a control profile, select one predeclared state/summary per independent attempt, preserve inferred-source labels and unknown uncertainty, and bind `anatomy_model_id` to the snapshot's original model ID. Do not turn multiple frames from one attempt into independent repetitions.

## Verification

Run `PYTHONPATH=.:science/src python -m pytest science/tests/test_frozen_control.py -q -W error` in the installed science environment. Real-native tests cover single-vowel recovery against a frozen anatomy, measured lip constraints, full-state provenance, hard forward budgets, native error restoration, occlusion, canonical/digest/bounds/provenance rejection, freeze cutoffs, physical duplicates, nested held-out aliases, numerical held-out exclusion and control-profile model binding.

The generating JA values remain −2.37, −3.24 and −4.08 degrees. At a 180-call total budget with three visible frames, an additional check achieved errors approximately 0.000000001, 0.000000002 and 0.018107 degrees, using 172 native forward calls; the last frame correctly reported budget exhaustion. The recovery test uses a larger declared 480-call cap. These are controlled same-engine results and do not establish general identifiability, human accuracy, motor-learning benefit or calibrated uncertainty.
