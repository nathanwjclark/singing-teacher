# Independent third-wave scientific review

Scope: richer spectral observation models, mechanical source hypotheses, continuous motion, learned cue execution, app probe calibration, and full score reproduction. The prototype already connects the research loop; this wave tests its scientific assumptions and expands supported operators.

## Frozen review criteria

The independent protocol in `evaluation/wave3/protocol.json` was fixed against main `304ee87`, before reading the new implementations. Its generated truth is deliberately absent from the four-member anatomy/source grid. The cases are a clean observation, gain change, spectral coloration, noise, incorrectly fixed jaw/F0, anatomy outside support, wholly missing evidence, and exact duplicate hypotheses.

1. Both old and new objectives receive identical candidate PCM and the same calibration observations. Freeze candidate predictions and calibration ranking before opening held-out target PCM. Report actual synthesis and extraction counts separately; reused predictions are declared reuse, not free extra search.
2. Report per-case failures, missing predictions and ties. A wholly missing record cannot produce a finite fit. Identical candidates must remain indistinguishable to the objective; deterministic list ordering is not evidence of uniqueness.
3. Distinguish fixed JA/F0/source/gain assumptions from learned values. A smaller residual is not proof of anatomy recovery. A compensating source or capture parameter may explain the same signal.
4. Nuisance gain/tilt estimated separately for each candidate is a conditional profile discrepancy. It is not calibrated likelihood or Bayesian marginalization. Preserve the fitted nuisance values and declared bounds.
5. A mechanical simulator controls masses, spring forces and collision according to its implementation. Selecting its parameters from microphone audio does not establish actual vocal-fold closure, tissue properties, muscle activation or contact measurements.
6. A learned cue predictor must bind attempts to the actual instruction and model version. Score later execution prospectively. Reusing the same attempt for calibration and success evaluation is leakage; sensations alone are not measured kinematics.
7. Changes to native source family, extractor, scoring policy or capture calibration invalidate incompatible frozen predictions. Keep original receipts and explicit incompatibility reasons.
8. State implementation, evidence source and scientific outcome independently. Passing generated/native tests establishes execution under those conditions; physical-device and human reference evidence remain separate.

## Review limits

This is a small falsification/stress suite, not a representative benchmark or a calibrated uncertainty study. Its results may be negative or inconclusive. Model parameters must not be tuned to make these fixed cases pass. New tuning requires a new training set and a separately frozen evaluation revision.
