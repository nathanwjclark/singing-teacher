# One-frame visible tongue patch experiment

This diagnostic fits a small observed tongue surface patch and tests the frozen shape on other frames from the same held-pose capture. It does not fit whole-tongue anatomy, muscles, or hidden tissue, and does not update the live app model.

```sh
science/.venv/bin/python scripts/fit-native-tongue.py /private/capture.zip \
  --regions /private/regions.json --output .local-data/capture/tongue-fit
open .local-data/capture/tongue-fit/index.html
```

Requires NumPy and Pillow and the private capture-bound region annotations described in [NATIVE-DEPTH-PREVIEW.md](NATIVE-DEPTH-PREVIEW.md). Original capture bytes/hashes are verified first. Supported inputs currently use unmirrored 1280×720 RGB and 320×180 depth. Output directories must be new. Private data must never go in `public/` or Git.

## Selection and fit

The manual visible-tongue rectangle is eroded by one depth pixel. Fixed RGB gates require red-dominant, sufficiently illuminated samples and reject near-white highlights. Finite 80–500 mm depth, at least seven valid neighbors, and a local median residual under 2.5 mm further restrict samples. This is conservative manual selection with heuristics, not validated semantic segmentation. Inspect the included sample overlay.

A six-coefficient quadratic depth surface is fitted in normalized calibrated camera XY using eight Huber reweighting iterations (1.5 mm threshold), with a small fixed penalty on curvature. A three-coefficient plane is the baseline. Both models use only the designated reference frame. Coefficients, input depth hash, settings, and support bounds are persisted in `frozen-model.json` before held-out evaluation; `evaluation.json` records its SHA-256.

No unseen surface is fitted. The exported PLY connects only adjacent accepted reference pixels, in meters. Excluded pixels remain holes. The viewer shows this fixed patch in green and held-out observed points in white, with prediction residuals in orange.

## Evaluation

A separate face image template supplies approximate XY translation; a separate cheek region supplies depth offset. Neither is estimated by fitting the held-out tongue samples. This nuisance alignment does not correct full head rotation. The shape coefficients remain frozen throughout evaluation.

Frames with face NCC below 0.9, tracking at the search boundary, insufficient cheek support, or fewer than 30 target samples inside the trained XY support are excluded with reasons. The reference frame is explicitly labeled training and excluded from held-out summaries. Metrics include per-frame mean, median, and 90th-percentile absolute depth error, plus the plane baseline.

The experiment's fixed success gate is median held-out frame MAE ≤2 mm AND at least 10% improvement over the plane. These are exploratory thresholds, not clinical or sensor specifications. A failed comparison remains a reported failure; a visually pleasing fit does not override it. Correlated frames from one pose do not establish generalization to other tongue positions.

## Light validation

Focused checks cover recovery of a known curved surface with large outliers; exclusion of bright tooth-like pixels, missing depth, spikes and ROI boundaries; frozen-model hash consistency; single-frame train/holdout separation; and browser frame/mesh controls with no external requests. Actual capture results and images remain private.
