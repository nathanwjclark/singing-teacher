# Lead-A joint recovery challenge

Protocol version `joint-recovery-challenge-1` is frozen in the script before the
fresh matrix is run: seeds 72103, 84317, 95609, 106631; three calibration vowels
(a/i/u), independently sampled JA per vowel, two shared anatomical dimensions,
160 residual evaluations per model, two starts, optimizer seed 81. The fixed
anatomy baseline receives the same cap and the same independent JA freedom.
A hard wrapper counts native spectrum calls, capped at 3900 for the entire run.

Generating truth is written separately and never enters the fitting observation
payload. After the fit file is frozen, a fourth vowel (e) is generated and scored.
Its true JA is supplied only for conditional anatomy-generalization scoring. This
is not a blind motor forecast. No settings or candidate selection change after
held-out results. All nonconvergence, failed cases and scoring failures are kept.

Predeclared joint recovery acceptance: both anatomy errors at most 0.1 cm, all
calibration applied-JA errors at most 0.5 degrees, and held-out RMSE at most 1 dB.
This strict gate is an experiment outcome, not a promise of recovery.

```sh
PYTHONPATH=science/src science/.venv/bin/python science/scripts/joint_recovery_challenge.py --output science/artifacts/joint-recovery-v1
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_joint_recovery_challenge.py -q
```

Output contains the protocol, separated truths/observations, frozen fit files,
held-out scoring-only targets and all per-case results. Existing outputs cannot
be overwritten. This is a Lead-A noiseless same-simulator direct-transfer
investigation, not Lead B's independent evaluator or evidence of human anatomical
reconstruction. Predictive equivalence cannot establish anatomical uniqueness;
limited-search failure cannot alone establish non-identifiability.
