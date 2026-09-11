# Frozen independent wave-three evaluation

`protocol.json` was committed before the new scientific modules were reviewed. `run.py` compares the production coarse and multi-resolution spectral objectives on **the same native PCM predictions**. The suite has four anatomy/source candidates and eight stress cases. Generated anatomy is absent from the candidate grid. No new learned model or positive recovery result is fabricated by this harness.

After the spectral module and its native dependencies are installed, run from the repository root:

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest evaluation/wave3/test_protocol.py -q
PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/run.py --output /tmp/singing-wave3-independent
```

The output must be a new directory. The hard synthesis limit is 21 calls: 12 candidate forecasts, six calibration truth calls and three held-out truth calls. Gain, noise, coloration, missingness and duplicate hypotheses reuse these immutable native frames; this reuse is shared equally by both objectives. Source calls use the declared geometric source family with independently varied pulse skew. This tests anatomy/source compensation; it does not benchmark the separate new two-mass family.

The prediction bank is saved before calibration scoring. Calibration rankings are saved before any held-out target synthesis. The report retains every candidate's held-out score, the calibration-selected tie set and the held-out optimum for scoring only. Never feed the scoring-only optimum back into fitting. Raw PCM files, SHA-256 hashes, exact native control receipts, objective policy, source grid and failures are retained. No recordings of people or API credentials enter this experiment.

Compare candidate selection, within-objective held-out regret, rejected inputs and stability of ranks. The numerical scales of the two objectives differ, so a smaller spectral number than coarse number is not an improvement claim. Per-resolution centering and bounded level/tilt profiling trade sensitivity against nuisance invariance; fitted nuisance values are diagnostics, not measurements of capture response or source physiology. The coloration case applies a causal low-pass with initial rest to the finite analysis frame, so it includes that boundary transient.

Generated/native success does not validate anatomical uniqueness, physical microphone calibration, posterior coverage, human vocal-fold contact or learning efficacy. See `docs/physiology/wave3-review.md` for the review criteria and recorded findings.
