# Empirical cue-execution forecasts

`control_forecast.py` integrates native tract-transfer spectra across frozen anatomy
candidates **and** the observed distribution of executed jaw controls for one exact
cue/version/context/mode. A cue does not set jaw position deterministically.

## Prospective local API

Build a motor profile using `control.fit_control_profile`, then freeze its canonical
bytes with `freeze_control_profile(profile)`. Freeze anatomy with
`prediction.freeze_candidates` as before. Call:

```python
forecast = predict_control(
    anatomy_snapshot, control_snapshot,
    expected_anatomy_digest=anatomy_snapshot.sha256,
    expected_control_digest=control_snapshot.sha256,
    prediction_id="prospective-1", target_evidence_id="next-attempt",
    generated_at="2026-01-01T00:02:00Z",
    cue_id="jaw-cue", cue_version="1",
    context={"pitch_hz": 160.0, "vowel": "a", "level": "comfortable", "posture": "seated"},
    mode="elicited", bins=512, max_native_calls=256,
)
```

The function returns immutable `prediction.Artifact` bytes with kind
`prospective_empirical_execution_transfer_forecast`. Save and externally commit the
exact artifact and digest before collecting target evidence. Repeating identical
inputs produces identical bytes. `Artifact.write` refuses existing paths.

The control helper validates the profile's internal hash, recorded observation
cutoff, and exact context. The forecast additionally checks both expected artifact
digests, matching anatomy model identity, engine provenance, generation after both
freezes, and absence of target evidence from either fitting history. Timestamps and
current expected model digests must be attested by the external coordinator; local
hash checks do not provide signature authenticity or actual capture-order proof.

Unsupported contexts, fewer than three measured control attempts, unsupported
operator/source mixtures, invalid native jaw angles and excess candidate × node
work all fail explicitly. There is no implicit fallback to a perfect cue.

## Numerical interpretation

Each anatomy candidate has equal support weight. Each executed-control node retains
its empirical unconditional recorded-attempt weight. Successful, unsuccessful and
execution-status-unknown attempts with valid measured controls all contribute native
spectra. Sensor-invalid or otherwise unmeasured execution contributes missing mass,
not an invented acoustic outcome. These empirical frequencies are not calibrated
future success probabilities and may reflect selection in recorded attempts.

The result reports mean and variance of **dB transfer features conditional on measured
execution support**, plus the weighted known contribution before normalization.
A full unconditional feature mean is provided only with zero missing mass; otherwise
it is null. The expectation of dB features is neither the transfer function of mean
jaw position nor a mean waveform. Failure, unknown execution and sensor-invalid
fractions remain separately labeled. They need not be disjoint events.

Per-node sensor uncertainty is retained, not treated as a latent posterior or
propagated through arbitrary Gaussian nodes. Explicitly inferred controls may have
unknown uncertainty, retained as null. Their empirical point dispersion does not
establish motor variability. Candidate dispersion is likewise not a calibrated
anatomical posterior. Context pitch/level select observed motor support; this
tract-transfer calculation does not model sound-source amplitude or pitch changes.

## Post-capture conditional API

`condition_on_execution(prospective, anatomy_snapshot, ...)` generates a separate
`postcapture_measured_execution_transfer_forecast` artifact with the prospective
hash, a new prediction ID, target observation ID, observation time and supplied
measured JA/uncertainty. Its observation must follow the prospective timestamp and
precede conditional generation. It cannot modify or relabel the prospective bytes.
The calculation conditions on the observed JA across the original anatomy support;
cue success is not assessed, and sensor uncertainty is retained rather than silently
converted into an unsupported latent distribution.

Both APIs predict simulated tract transfer, not microphone recordings or nasal
occlusion. Commit-before-capture, actual cue delivery and independent scoring remain
Lead B responsibilities.

## Tests

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_control_forecast.py -q
```

Native tests compare bimodal support to explicit weighted native spectra and reject
the shortcut of simulating mean JA. They verify failed/missing/unknown mass,
inferred uncertainty limits, deterministic replay, context and identity checks,
computational bounds, and conditional artifact isolation/no-overwrite behavior.

Conditional intake also cross-checks the prospective model ID, native provenance,
anatomy evidence IDs and freeze time against the supplied anatomy snapshot. Its
embedded control distribution must agree with the top-level control model, profile,
evidence, cue and context identities. Rehashing an inconsistent artifact does not
bypass these checks, which run before native calculation. This verifies internal
lineage consistency; it does not authenticate externally supplied hashes.
