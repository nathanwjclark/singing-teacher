# GEO-01: calibrated visible surface measurements

Implemented in `observations/geometry/`, independently of the native physics process. Run from the repository root:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_geometry.py -q
```

This lane consumes calibrated recorded or synthetic arrays, reconstructs only visible measured points, and supplies conditional measurement uncertainty and an explicit residual interface. No phone recordings have been supplied. **BLOCKED: device acceptance requires B's exported iPhone capture, rectification/calibration provenance, and known-target measurements.** FUSE-01's physiological observation operator also requires an explicit correspondence between measured visible surfaces and model surfaces; this module does not invent one.

## Input contract (internal adapter boundary)

`DepthFrame` carries evidence ID, session timebase ID, original source timestamp and an affine mapping from source seconds into session seconds. `clock_scale` is dimensionless, `clock_offset_seconds` is seconds, and `sync_uncertainty_seconds` is an absolute error bound already expressed in session seconds. B's adapter must estimate that bound, including clock-fit uncertainty/drift over the recording. When comparing to audio, `reference_seconds` must be in that same session timebase. Frame age plus the bound must not exceed `max_alignment_seconds` (default 20 ms, an explicit policy threshold). Otherwise reconstruction returns an empty observation and a reason. No frame replication or arrival-time alignment occurs.

Depth is a 2-D rectified **axial depth** array in explicitly declared `m` or `mm`, with integer pixel centers `(u, v)`. Camera axes are x right, y down, z forward. `intrinsics` belongs to this depth resolution and orientation, including any crop/resize; it is not automatically borrowed from RGB. `world_from_camera` is a proper rigid 4x4 transform with translation in meters, converted to the stated camera convention by the adapter. It must refer to the depth timestamp. Static scans and dynamic singing poses must retain separate evidence identities; this implementation does not rigidly merge moving tongues/jaws.

Unrectified maps and disparity/radial-range representations are rejected. [Apple's AVDepthData documentation](https://developer.apple.com/documentation/avfoundation/avdepthdata) specifically cautions that its nonrectilinear maps require correction for 3-D correlation. [Camera intrinsics](https://developer.apple.com/documentation/arkit/arcamera/intrinsics) define the pinhole projection. The acquisition adapter must perform documented sensor-specific conversion/rectification before calling this module and preserve its provenance. This is not a raw AVDepthData decoder.

Optional confidence must be finite scores normalized to [0,1] by the adapter; these scores are quality categories, not statistical probabilities. Optional `visible_mask` limits the selected visible region. Optional `measured_mask` removes filled/interpolated samples. When masks are omitted, the caller asserts the input contains measured visible samples throughout; no anatomical face-mesh vertices qualify as raw depth. Confidence/visibility/measurement masks and invalid or out-of-range depth are intersected. Rejection counts may overlap, and holes remain holes. Missing depth is `None` with a required explicit `missing_reason`.

`depth_sigma_m` and `pixel_sigma` must be positive, supplied from a calibrated error model (or explicitly marked assumed in the enclosing experiment provenance). Covariance propagates independent axial-depth and pixel-location noise through inverse intrinsics and the rigid transform. It is **conditional on exact intrinsics and pose**: systematic scale bias, shared calibration error, synchronization-induced motion, reflectivity bias and spatial correlation are not estimated here. Confidence does not masquerade as variance. Reject or inflate the upstream error model when these omissions matter; do not report these conditional sigmas as total anatomical uncertainty.

## Outputs and fusion

`reconstruct(frame)` returns compact world points in meters, 3x3 covariance matrices in square meters, their original pixel coordinates, a full-resolution validity mask, rejection reasons, evidence ID and mapped session timestamp/uncertainty. Missing and rejected frames contribute zero points rather than zero-valued anatomy observations.

`surface_distance(observation, first_uv, second_uv)` measures the straight-line distance between two valid measured endpoints and propagates independent endpoint covariance. It returns meters, conditional sigma, endpoint pixels and evidence/timebase metadata. This is not surface geodesic length or an estimate of internal tract length. Endpoints must be distinct integer pixel centers.

`surface_residuals(observation, predicted_points_m, operator_id=..., model_sigma_m=...)` computes Cholesky-whitened world-coordinate residuals. A predeclared operator must produce predicted points in exactly the measured pixel correspondence and world frame. Additional isotropic model discrepancy sigma is explicit. It must be specified independently of the held-out score. Empty observations yield an empty residual vector. The returned operator/evidence IDs preserve provenance for a joint likelihood. This is an interface for an actual observation model, not a claim that VTL's sagittal SVG already predicts measured 3-D facial surfaces. No nearest-neighbor fitting, external-face-to-hidden-anatomy relation, hidden cavity completion or statistical independence across neighboring pixels is assumed by this layer.

## Evidence and remaining device gate

22 targeted tests pass: metric known target and projection; mm/m conversion; rigid transforms and covariance rotation; distance uncertainty; confidence/visibility/filled-depth masking; affine clock mapping and stale/uncertain frame rejection; explicit missing/all-invalid depth; malformed metadata; and residual whitening against a known solution. Inputs in these tests are deterministic mathematical fixtures, not device accuracy measurements.

Next, B supplies a rectified known-target recording and the sensor calibration/error model. A will compare scale bias, repeatability and holes against independent target dimensions, then admit validated observations to a declared physiological surface operator. Internal nasal/throat surfaces remain unmeasured unless independently observed; no unsupported internal dimensions are generated here.
