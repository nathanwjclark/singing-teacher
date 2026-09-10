# Personal neural tongue tracking

This supersedes the selected-patch and color-component tongue trackers. The live
path contains no OpenCV. Face landmarks supply a mouth coordinate frame; a
separate private neural network locates the actual tip with a spatial heatmap,
classifies tip visibility, and estimates an independent anterior depth coordinate.
The depth head is supervised by available calibrated iPhone depth samples. It
never derives forward motion from downward image motion. No hidden-tip or
internal-muscle measurement is implied.

The mouth crop spans 2.2 mouth widths in sensor pixels, including 0.6 mouth-width
side margins and room above the upper lip. It is clipped at camera image edges.
This fixes both cropped-off lateral tips and the old portrait/landscape mismatch
from using normalized horizontal distances as vertical distances. The network
consumes 128×128 RGB, with ImageNet normalization, a ResNet18 stage-3 backbone,
a multi-scale spatial head, and separate visibility/depth heads. Inference runs
locally using ONNX Runtime Web. Model bytes are SHA-256 verified before loading.

The learned tip maps to an explicit mouth-relative X/Y/Z state: X follows the
mouth-corner axis, Y follows its image-plane perpendicular, Z is the learned
anterior coordinate. These are approximate mouth-width units, not millimeters or
an independently calibrated camera-space point. Front and side views consume the
same smoothed pose. The sagittal view projects away X; it must not turn lateral
motion into forward motion. Actual front-mesh and side-view endpoints are marked.
The rooted surface is an illustrative deformation, not measured internal tissue.

Weak/hidden detections abstain; stale inference cannot refresh itself just because
a new face frame arrived. Reset clears temporal state without deleting learned
weights or recordings. Recenter stores a user-chosen motion offset. Live template
selection is removed; frozen-frame labeling remains a manual comparison tool.
Tongue Lab shows the detected point, scores, and numerical X/Y/Z with estimated
depth clearly labeled.

## Private training and review

`scripts/train-tongue-neural.py` trains/exports a personal model from private point
labels and manually reviewed native mouth crops. It uses torch, torchvision,
NumPy, Pillow and ONNX; these are optional offline training dependencies, not web
runtime requirements. Direction dropdown tags are ignored. Original webcam-only
exports are reframed with explicit 16:9 source-aspect assumption and edge-padded
missing context; they supply no invented depth labels. Native depth labels are
attached by `scripts/label-tongue-depth.py`, which verifies source archives and
uses native inverse-lens calibration, finite depth support and a mouth-local basis.
Sparse edge samples and manually reviewed tip positions have uncertainty; this is
not precision ground truth. Review annotations when the tip boundary is unclear.

Private model installation is `.local-data/tongue-neural/current/{tongue.onnx,
manifest.json}`. Both endpoints are loopback-only. Training images, point labels,
weights, failed attempts and evaluation receipts remain private. The repository
contains implementation and training utilities, not participant data.

The initial frozen model failed on the new lateral/raised poses; those failures
were retained. The revised model incorporates selected new poses, with other
frames reserved for checks. Those frame holdouts are temporally correlated and
must not be described as independent-session generalization. The inside-mouth
clips contain poses where the anatomical tip is occluded; visible surface texture
or valid cavity depth is not enough to declare that tip observed.

## Focused verification

- `node scripts/check-tongue-model.mjs http://127.0.0.1:5199` against Vite checks the
  real mesh endpoint on six independent axis commands, a fixed root, sagittal
  lateral invariance, stale-observation expiry and crop aspect consistency.
- Private replay checks run actual images through the browser ONNX network.
- Full-app Chrome replay feeds recorded full-frame images through the normal
  webcam/face/crop/network/motion/Three.js path and inspects actual endpoint
  coordinates in both views. It also opens Tongue Lab, detects a quiet test tone,
  exercises the tongue demo and applies the native model geometry comparison.
- Build/lint and focused voice/coaching tests cover integration. The native
  session/model workflow is exercised separately on retained original voice PCM.

References: [ResNet18](https://docs.pytorch.org/vision/main/models/generated/torchvision.models.resnet18.html),
[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).
The [published tongue reconstruction project](https://github.com/steliosploumpis/tongue)
currently lists its implementation as TBA; it was not represented as an available
pretrained replacement or redistributed.
