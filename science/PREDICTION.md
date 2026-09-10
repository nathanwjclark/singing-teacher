# PRED-01: frozen physical forecasts

`singing_physics.prediction` forecasts simulated tract-transfer magnitude for each
explicit candidate geometry. This is a numerical component for Lead B's prospective
prediction ledger, not an audio assessment or physiological truth claim.

## API and ownership

1. Capture `Engine.provenance` from the native build used for fitting; close that
   engine before forecasting. The pinned reference speaker supplies unspecified
   anatomy controls and template poses.
2. Call `freeze_candidates(model_id=..., evidence_ids=[...], provenance=...,
   candidates=[{"candidate_id": "c1", "anatomy": {"hard_palate_length": 4.4}}],
   frozen_at="2026-01-01T00:00:00Z")` to receive an `Artifact`.
3. Call `predict(snapshot, expected_digest=snapshot.sha256,
   prediction_id="p1", target_evidence_id="next-trial",
   generated_at="2026-01-01T00:01:00Z",
   intervention={"kind": "named_pose", "pose": "a", "articulation": {"JA": -2.0}},
   bins=512)` to receive the immutable prediction `Artifact`.
4. Commit its exact `.content` bytes and `.sha256` through Lead B's ledger **before**
   capturing target evidence. `.write(path)` refuses to overwrite an existing file.
   `.data` provides a detached JSON object; editing it cannot mutate the artifact.

The caller owns timestamp attestation, author identity, storage access controls and
commit-before-capture enforcement. This component checks ordering against model
freeze, rejects the target ID if it is fitting or repeat evidence, and checks native
provenance and content digest. A digest proves content identity, not authenticity.

## Numerical meaning

Output includes the frequency grid (Hz), each candidate's transfer magnitude (dB),
complete applied anatomy with units, requested/applied articulation controls,
engine provenance and evidence lineage. Global geometry is fixed within a candidate;
intervention articulation is passed through the native anatomy-dependent bounds and
pose limiter. The report records any coupled limiting instead of silently claiming
that all requested controls were achieved.

Candidate dispersion reports unweighted population SD, range per frequency, and RMS
SD across the entire returned 0-to-Nyquist grid. These are disagreement summaries of
the supplied candidate set, **not a calibrated posterior or measurement noise model**.
A single candidate gives zero dispersion, which does not establish certainty.

An optional `repeat_variability` mapping supplies `frequency_hz`, nonnegative finite
`sd_db`, nonempty distinct `evidence_ids`, and
`quantity="tract_transfer_magnitude_db"`. It must match the exact output grid; the
result flags bins whose candidate SD exceeds measured repeat SD. No variance is
invented when absent. Microphone-level variation cannot be substituted for transfer
variation without a validated measurement transformation outside this component.

Only native named poses and bounded articulation controls are supported. Nasal
outlet plugging, microphone transfer, future human behavior, and tissue mechanics
are not predicted. Current trial articulation in a joint fit must be explicitly
mapped to the proposed intervention by the coordinator; it is not implicitly reused.

## Verification

Run against a built native simulator:

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_prediction.py -q
```

Tests use real native spectra for differing geometries, deterministic replay,
immutable/no-overwrite artifacts, digest/provenance mismatch, evidence leakage,
invalid timing, unsupported interventions and controls, nonfinite values, measured
repeat validation, and process-global engine release after success and failure.
