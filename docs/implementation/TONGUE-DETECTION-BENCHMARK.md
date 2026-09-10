# Tongue detection diagnosis and comparison

## Observed runtime blocker

On September 10, 2026, the local application listening on port 5173 returned HTTP 404 for `/api/tongue-neural/manifest`. Its process working directory was the `singing-teacher-source-integration` checkout. No `tongue.onnx` file was found in the project workspace, including ignored private directories. This establishes that the inspected running instance did not serve the required model; it does not prove weights do not exist elsewhere on the computer.

The current implementation is a private ResNet18-derived tip heatmap, visibility classifier and conditional depth regressor. It is not a visible-surface segmentation network. The live status now preserves the loader's actual error instead of replacing every failure with “Tip lost.” Camera capture and existing scientific analysis continue when the tongue model is missing.

## Collect independent labels in Tongue Lab

Freeze a frame, mark its tip or mark the tip hidden. Select **Visible tongue outline**, click around the visible tongue boundary, and save the polygon. Alternatively mark no visible tongue surface. Tip and surface labels are independent: a hidden tip does not imply an invisible tongue. Unreviewed, absent, and present labels remain distinct. Blue outlines are manual annotations, never automatic detector output.

Exports preserve the original image before any overlay. Existing `tongue-tip-review/v1` tip fields remain unchanged; `surface` is additive (polygon, null for absent, or omitted for unreviewed). Exports also include a session ID. Record held-out sessions separately; adjacent frames do not provide independent generalization evidence. Closing the lab still discards in-memory captures unless exported.

## Run the benchmark

`node scripts/tongue-benchmark.mjs review.json - report.json`

This evaluates the tip predictions already captured in the export. Reports contain image hashes and metrics, not images. Report files are created with private permissions and cannot overwrite existing files.

For another detector, run it locally on the same original crops and provide its output:

`node scripts/tongue-benchmark.mjs review.json predictions.json report.json`

The prediction document must contain `schema: "tongue-predictions/v1"`, `reviewSha256` (SHA-256 of the exact review file bytes), a nonempty `modelId`, optional `modelSha256`, and a `samples` array. Each prediction identifies its zero-based `index`, optional verified `imageSha256`, optional `tip` point, and optional `surface` polygon. Coordinates are unmirrored normalized crop coordinates, identical to the labels. Explicit null means abstention; omitted predictions remain misses on reviewed positive frames. This interface accepts actual detector outputs; it does not contain or substitute a trained segmentation model.

Tip reporting separates visible-frame coverage, localization error on detections and false detections on hidden frames. Surface reporting includes misses in mean intersection-over-union and reports false detections on absent-surface frames. Surface overlap uses a declared 128×128 raster. Missing segmentation capability is unavailable, not a score of zero or a successful result. Compare held-out sessions, not only pooled frame counts.

## Candidate to evaluate when data are available

[TongueSAM](https://github.com/cshan-github/TongueSAM) publishes tongue segmentation code and links to weights. Its tongue-image results are not evidence of reliable singing-mouth segmentation. First benchmark on independent singing sessions with lips, teeth, shadow, saliva, hidden tips and partially visible tongue surfaces. Check upstream code/weight/data licenses separately before redistribution. No private recordings have been uploaded or external model outputs substituted for human labels.

## Verification and remaining block

Three numerical/contract tests pass: independent surface/tip labels and misses, missing capability, and rejection of mismatched/duplicate/invalid predictions. A Chrome component check with a synthetic canvas stream verified freeze → outline → hidden tip → export, preserving both annotations and session ID without page errors. This is software verification, not detector accuracy.

The actual head-to-head model comparison remains blocked on private trained weights and labeled recording locations. No new tongue detector has been trained, installed or claimed accurate by this change. Next: locate those assets, verify model hash/loading and real inference, then run both detectors against reviewed session-held-out frames.
