# Predeclared PCM robustness challenge

Protocol `pcm-robustness-1` is fixed in the script before the actual six-case run:
clean, 6 dB additive Gaussian noise, 1200 Hz one-pole low-pass coloration, two
positive echoes at 15/35 ms, altered source/articulation controls and anatomy
outside the candidate grid. Seeds, transforms, controls, feature scales and the
126-call hard native synthesis cap are explicit. Two anatomical candidates and
two per-vowel source/control settings yield four hypotheses. Every fixed-anatomy
baseline receives the identical nuisance-control list and 16 actual fit calls.
The clean and out-of-grid generating geometries are both absent from the grid.

The actual native PCM is transformed before B's unchanged canonical extractor.
Generated source PCM hashes, stored frame bytes/hashes, declared transforms and
canonical receipts are retained separately from fitting observations. The fit is
written before generating the held-out e vowel. Predictions use predeclared
nominal held-out controls; the control-mismatch case deliberately violates that
assumption. No candidate, threshold or transform is retuned on held-out scores.

Engineering mismatch warning: calibration or held-out weighted discrepancy above
4, unavailable features, or fitting failure. This is deliberately conservative
and is not a calibrated test, voice diagnosis or proof of which assumption failed.
The score also reports anatomy error using scoring-only truth, without using that
error to choose candidates or issue the numerical warning. Low residual error
cannot establish accurate or unique anatomy.

```sh
PYTHONPATH=science/src science/.venv/bin/python science/scripts/pcm_robustness_challenge.py --output science/artifacts/pcm-robustness-v1
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_pcm_robustness_challenge.py -q
```

Node with TypeScript stripping must be on PATH. Output is fresh-only. Every case,
including failed/quiet/clipped cases, is retained. This is a Lead-A investigator
stress test using synthetic waveforms, not Lead B's independent evaluation or
human-recording validation.
