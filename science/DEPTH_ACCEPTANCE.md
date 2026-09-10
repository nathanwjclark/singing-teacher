# Independent target diagnostics for native depth

B's latest `scripts/preview-native-depth.py` now executes single-frame inverse-LUT projection, private RGB/depth visualization and a temporal residual diagnostic. `docs/implementation/NATIVE-DEPTH-PREVIEW.md` reports an actual-calibration LUT roundtrip check, but explicitly states that no independent calibration target was captured. No original phone bundle, private region file or known-target annotations were publicly committed in the inspected merge at `3ccfaa9`. A cannot independently reproduce that physical capture from repository metadata alone.

## What this unlocks

`observations.geometry.acceptance.assess_capture_targets(original_directory, annotation)` supplies the next executable acceptance step over the original hash-verified native directory. It uses the existing A reader and LUT projection. A caller provides a independently measured physical target, its geometry in the camera coordinate system and fixed tolerances. The function **does not fit** a plane/pose to the evaluated depth or optimize the supplied target. Doing that would hide exactly the calibration errors being tested.

Supported target operators:

- `camera_plane`: residual `unit_normal_camera dot measured_point_camera - offset_m`; independently establish the target's camera-frame plane equation.
- `endpoint_distance`: residual between two annotated visible target endpoints and their independently known straight-line separation. This scalar requires no camera-to-world/head registration, but still needs correct endpoint correspondence.

Every observation retains annotated target/reference IDs, reference protocol, reference error bound, frame evidence/timestamp/timebase and projection lineage. `reference_kind` distinguishes `independently_measured_target` from `analytic_fixture`. The reported reference error bound is retained separately and is not silently subtracted from residuals or treated as sensor noise. The tolerance decision applies to raw observed residuals.

## Annotation input

Top-level fields:

- `schema_version`: `native-target-diagnostic-0.1.0`.
- `capture_id` and exact original `manifest_sha256`.
- `tolerances`: positive `minimum_valid_fraction` up to one, `maximum_absolute_median_m`, and `maximum_p95_absolute_m`, fixed before evaluating this capture.
- `observations`: one or more explicit records.

Each record includes source `sequence`; `target_id`, `reference_evidence_id`, `reference_protocol_id`, `reference_kind`; nonnegative `reference_error_bound_m`; unique integer `pixels_depth_uv`; explicit `depth_to_reference` affine and `reference_mapping_id`; and `target`.

Plane targets use `{kind: camera_plane, unit: m, unit_normal_camera: [nx,ny,nz], offset_m: d}` with a unit-length normal. Endpoint targets use `{kind: endpoint_distance, unit: m, distance_m: positive_distance}` with exactly two pixels. Target/source identities and units are validated, duplicate observations/pixels are rejected, and missing samples are not replaced by zeros.

Returned metrics include valid coverage, median signed bias, median absolute residual, 95th percentile absolute residual, RMS and median absolute deviation. No standard error or independent-pixel count is claimed: neighboring sensor errors may be correlated. Missing depth/calibration or incomplete endpoints remain explicitly unavailable. `all_within_declared_tolerances` is a diagnostic threshold result; `sensor_noise_calibrated` and `physiological_fusion_accepted` remain false even when an analytic fixture passes.

The CLI writes private permissions and refuses to overwrite an existing result:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m observations.geometry.acceptance \
  /private/native-capture /private/target-annotations.json \
  --output /private/target-diagnostics.json
```

## B/A projection consistency

B's preview uses depth coordinates `(x+0.5, y+0.5)` and scales intrinsic rows into the depth resolution. The equivalent A mapping for its integer-index input is diagonal scale `reference_dimensions/depth_dimensions` with translation `0.5*scale` in each axis. Applying this explicit mapping yields camera points equal to B's actual numerical projection functions within `1e-12` on a nonzero LUT analytic fixture. The test executes those exact function definitions from the current B script without loading its unrelated Pillow visualization dependency.

An integer-center map with zero translation gives measurably different points on the fixture; that difference is expected because it encodes a different pixel convention. It is not evidence that either convention has passed a physical target test. A additionally rejects folded LUTs and out-of-domain points; B's preview clamps LUT interpolation at the radius endpoints. Both use the SDK-prescribed inverse LUT for distorted-point-to-rectilinear-point mapping.

## Verification and remaining ownership

13 tests pass: exact plane/distance targets, bias and an outlier, missing endpoints/depth, invalid annotation/manifest binding, duplicate pixels, reference unit-normal checks, B/A analytical parity, and private CLI execution/overwrite rejection. A `.51/.51/.70/missing` meter fixture against a `.50 m` plane reports 75% coverage, approximately 10 mm median bias and an absolute p95 above 150 mm; it correctly fails declared millimeter tolerances. This is software evidence only.

B/human capture owner supplies the original bundle and predeclared visible target pixels. The independent calibration owner supplies target dimensions or camera-plane pose, reference error estimates and protocol evidence. A runs this diagnostic, investigates bias/coverage and designs follow-up distance/angle trials. Head-pose, audio synchronization, mouth-specific correspondence and repeated physical error validation remain separate gates. A cheek-adjusted temporal residual mixes motion, articulation, tracking and noise and cannot substitute for these target measurements.
