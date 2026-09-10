# Head-compensated visible tongue surface review

`review-dynamic-tongue.py` processes a private native capture into a self-contained interactive camera/surface/motion viewer and a per-frame JSON analysis. It uses existing native ZIP integrity checks and lens-corrected camera projection. Dependencies: NumPy, SciPy, Pillow and OpenCV (`opencv-python-headless`).

```sh
science/.venv/bin/python scripts/review-dynamic-tongue.py /private/capture.zip \
  --annotations /private/dynamic-annotations.json \
  --output .local-data/capture/dynamic-review
open .local-data/capture/dynamic-review/index.html
```

Annotations are private and bound to `capture_id`. They provide a visible `seed_frame`, `face_regions_depth_xyxy`, `mouth_exclusion_depth_xyxy`, `tongue_seed_polygon_depth_xy`, and a sparse `visibility_review` mapping of frame number to manually observed visibility. Coordinates refer to the native 320×180 unmirrored depth grid. The visibility-review labels are used only after processing, never as tracking input. They are a sparse check, not a segmentation benchmark.

## Independent motion paths

Non-mouth facial corners are tracked directly from the reference frame using pyramidal Lucas–Kanade optical flow with a forward/backward consistency check. Features without valid depth are removed. Three-dimensional RANSAC estimates a rigid current-to-reference transform, with translation in millimeters and rotation separately recorded as matrix, rotation vector in radians and total angle in degrees. Every fifth feature ID is excluded from fitting and used to report an independent-anchor residual. Insufficient support or median validation residual ≥5 mm rejects that frame's head correction. These are empirical diagnostic thresholds, not validated sensor uncertainty.

Tongue correspondence uses a separate manually seeded polygon and bidirectional dense optical flow. Color, photometric consistency, round-trip flow, connected support, area retention and valid depth restrict the candidate region. It cannot independently establish tongue identity; occlusion can still cause drift onto lips. Candidate failures remain visible as failures and do not generate a surface.

Accepted tongue points are transformed into the reference head frame. A per-frame robust quadratic surface is fitted to 75% of spatial samples; the remaining pixels assess local fit error. This is spatial interpolation validation, not prediction of the next pose. The surface is accepted only below a 2.5 mm spatial-holdout mean error. Output retains all attempted errors, including failed fits, and summarizes both all evaluated fits and passing fits. No temporal fusion, gap interpolation or hidden tissue geometry is produced.

The displayed motion is the center of a visible tracked patch, not anatomical tip position. Motion can reflect changing visibility, real articulation, tracking error or depth noise. Axes in the viewer are rotated into upright portrait orientation; stored 3D values remain native reference camera coordinates.

## Scope and validation

The live app stays disconnected. A successful diagnostic on one recording does not satisfy generalized tongue segmentation, physical metric calibration, independent timing error, or native anatomical surface correspondence needed by the scientific model. Head transforms are estimates with holdout residuals, not external tracking ground truth or calibrated uncertainty.

Light checks cover known rigid rotation/translation with outliers, insufficient-anchor rejection, browser playback/frame controls, blank failed frames, and absence of external viewer requests. Manually inspect both exposed- and closed-mouth frames. Private images and derived geometry stay outside public Git.

Primary optical-flow references: [OpenCV tracking API](https://docs.opencv.org/4.10.0/dc/d6b/group__video__track.html), [OpenCV dense flow example](https://github.com/opencv/opencv/blob/4.x/samples/python/tutorial_code/video/optical_flow/optical_flow_dense.py). Calibration follows the Apple SDK method documented in [NATIVE-DEPTH-PREVIEW.md](NATIVE-DEPTH-PREVIEW.md).

## Capture-independent preview and RGB fallback

`preview_depth_xyxy` optionally selects a native-depth-grid camera crop; older annotations retain their original crop. `temporal_split` metadata is copied verbatim into output provenance and must be frozen before processing if a downstream anatomical fit will use held-out frames. This diagnostic does not itself enforce a downstream fit boundary. `analysis.json` and the image-free `surfaces.json` retain capture, annotation and script hashes, seed frame, split and coordinate meaning. Never treat head-reference camera coordinates as anatomical model registration.

A separate RGB-only path retains non-mouth face features even when their depth is missing. It estimates a 2D similarity transformation with RANSAC, excluding every fifth anchor for validation; at least 12 inliers, six independent checks and a median check error below two pixels at 640×360 are required. The seeded RGB patch is reported separately from its available depth. Accepted RGB patch centers can be shown after this image-plane correction, in pixels. This does not create metric geometry, 3D pose, or depth-backed surface fits. Missing tongue depth still produces no 3D surface. Empty and failed output frames remain present in the animated viewer.

The separate measured-camera-depth view displays actual valid samples from the annotation's broad mouth-exclusion image rectangle, with a two-pixel grid stride. This rectangle is a display crop, not a semantic mouth/tissue mask. Neutral triangles connect adjacent retained samples only when their depth span is below 4 mm; absent samples stay holes. This view uses unregistered camera axes and never substitutes these samples for a missing tongue surface. Switching to the tongue-fit view retains its original rejection rules.
