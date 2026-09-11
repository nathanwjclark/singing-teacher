# Frozen independent wave-three evaluation

This directory compares the production coarse objective (`canonical-coarse-v1`) with the multi-resolution spectral objective (`multires-log-spectrum-v1`) on **the same native PCM predictions and observation frames**. Both objectives therefore use the same native synthesis budget. Generated truth anatomy is absent from the candidate grid. Evidence source: synthetic (native generator); no recordings of people or API credentials are used.

## Revisions

- **Revision 1** (`protocol.json`, frozen before the spectral code was reviewed): four anatomy/source candidates, calibration vowels a and i, held-out vowel e, eight stress cases, 21 native calls. It was executed once by `run.py` from harness commit `b442c1e`; the identical file is `git show ba38700:evaluation/wave3/run.py` on this branch. Its results are in `results/first-*.json` and stay unchanged.
- **Revision 2** (`protocol-2.json`, committed before it was run): responds to review of revision 1's method. Per-vowel gains come from a declared rule over the frozen prediction bank, so no candidate prediction clips by construction; candidates within a declared margin of 0.1 standardized RMS count as tied; the prediction bank is checked for level jumps between neighbouring anatomies before any target exists; both objectives are scored by the production `fit_pcm` per-trial scorer (`score_prediction`, `candidate_discrepancy`); a near-duplicate case tests ambiguity; there are three held-out vowels (e, o, u). Targets are new, so no revision-1 observation is reused, and nothing was tuned on revision-1 held-out scores. Its decision rule is fixed in the protocol.

## Running revision 2

From the repository root:

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest evaluation/wave3/test_protocol.py -q
PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/run.py --output /tmp/singing-wave3-independent-2
```

The output directory must be new. The hard limit is 40 native calls: 5 bank members × 5 vowels, then 3 truth groups × 5 vowels. The prediction bank (with gains and level checks) is written first. Calibration rankings are written before any held-out truth frame is synthesized. The report retains every candidate's held-out score per vowel, the calibration retained set, the held-out retained set (scoring only), regret, level differences, failures and extraction counts. Raw PCM files, SHA-256 hashes, native control receipts and the objective policy are written next to them.

## Reading the results

Compare hits, regret, coverage and ambiguity within each objective. The two objectives use different numerical scales, so a smaller spectral number than a coarse number is not an improvement claim. Per-resolution centering and bounded level/tilt profiling trade sensitivity against nuisance invariance; fitted nuisance values are diagnostics, not measurements of capture response or source physiology. The coloration case applies a causal low-pass with initial rest to the finite frame, so it includes that boundary transient.

Generated native success does not validate anatomical uniqueness, physical microphone calibration, posterior coverage, human vocal-fold contact or learning efficacy. See `docs/physiology/wave3-review.md` for the review criteria and recorded findings.
