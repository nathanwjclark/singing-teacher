# Predeclared PCM robustness challenge

Protocol `pcm-robustness-1` is fixed in the script before the actual six-case run:
clean, 6 dB additive Gaussian noise, 1200 Hz one-pole low-pass coloration, two
positive echoes at 15/35 ms, altered source/articulation controls and anatomy
outside the candidate grid. Seeds, transforms, controls, feature scales and the
126-call hard native synthesis cap are explicit. Two anatomical candidates and
two per-vowel source/control settings yield four hypotheses. Every fixed-anatomy
baseline receives the identical nuisance-control list and eight actual fit calls
per model (sixteen combined).
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

## Actual frozen run and negative findings

Protocol was committed as `c8aef83` before running the fresh cases; protocol SHA-256
is `b043762ac33363d666981a6daaacbd0f48b50ea73639350726e8b4db49106418`.
The matrix made **126 actual native synthesis calls**, 21 per case: two calibration
generations, sixteen fitting calls (eight per model), one held-out generation and
two predictions. No case was omitted and no thresholds or fits were retuned.

| Case | Joint calibration discrepancy | Joint held-out discrepancy | Max anatomy error (cm) | Joint engineering warning | Baseline calibration discrepancy |
|---|---:|---:|---:|---|---:|
| Clean | 0.01251 | 0.001382 | 0.25 | Not triggered | 18.7881 |
| Noise | 40.5374 | Unavailable: missing pitch | 0.25 | Triggered | 48.5665 |
| Coloration | 0.03810 | 0.002187 | 0.25 | Not triggered | 18.9613 |
| Echo | 0.37853 | 0.518820 | 0.25 | Not triggered | 23.9024 |
| Control mismatch | 0.07519 | 0.200702 | 0.25 | Not triggered | 18.1578 |
| Out-of-grid anatomy | 0.04221 | 0.226852 | **1.00** | **Not triggered** | 20.1734 |

Every baseline held-out prediction was flagged as clipping and is **unscorable**;
its raw descriptor differences remain diagnostic output only. A scoring audit
found the initial comparator incorrectly assigned finite held-out scores despite
these quality flags. The corrected comparator rejects observed or predicted
clipping, invalid, dropped and low-SNR/missing-quality frames. Stored canonical
records were re-scored into `report-quality-reviewed.json` with **zero additional
native calls**. The original `report.json` remains intact, with its hash referenced
by the correction. The joint results above were unchanged; baseline held-out
comparisons are unavailable rather than favorable numerical evidence. Twelve
targeted tests pass, including the quality-regression cases.

The out-of-grid generator had hard-palate/pharynx lengths **3.2/7.6 cm**. The chosen
candidate had **4.2/6.6 cm**, a 1 cm error in each dimension, yet the coarse-feature
residual warning did not trigger. Even clean interpolation missed anatomy by
0.15/0.25 cm despite a very small held-out discrepancy. Thus a small canonical
PCM residual must **not** approve anatomical accuracy or model adequacy. The
warning's lack of sensitivity is retained as a failed detection outcome, not
repaired by choosing a threshold after seeing these scores. Coloration, echo and
control mismatch also went unflagged under the predeclared rule.

These observations are consistent with the existing transfer-function challenge's
warning that prediction error and anatomical recovery are different objectives.
Transfer-function experiments use much richer, idealized information; this PCM
challenge uses the current five coarse canonical descriptors. Neither proves
identifiability for recorded human voices.

## Next measurement requirements

Before interpreting a selected candidate anatomically, require more discriminating
measurements and independent validation: a jointly agreed next version of B's
canonical spectral-envelope/harmonic measurements, declared source-pitch and
articulation conditions, independent gain/noise/room calibration, and supported
visible-geometry constraints with their uncertainty. These must be evaluated on
new frozen cases, with equal nuisance freedom and out-of-grid/model-mismatch
checks. A richer extractor should remain one shared B-owned implementation, not
a parallel scientific feature path. Hidden anatomy needs independent anatomical
reference evidence; face depth and successful waveform matching alone cannot
supply it. No additional lane or extractor was implemented in this challenge.

Retained local artifacts: `science/artifacts/pcm-robustness-v1/`, including protocol,
all calibration/held-out float32 frames and canonical receipts, separated generating
truth, frozen fits, initial scores, and the quality-reviewed report. Replays should
compare hashes of source PCM, numerical descriptors and scores; genuine extractor
receipt timestamps can differ.
