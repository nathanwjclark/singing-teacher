# Calibrated radial point rectification

`observations.geometry.rectification` implements the numerical radial lookup-table mapping and unprojects the **original valid depth samples** into camera coordinates. It does not resample across holes, produce filled surfaces, register a head, estimate sensor noise or establish hardware accuracy.

## Authoritative direction and formula

Apple describes radial float32 lookup tables and camera reference dimensions in its [AVCameraCalibrationData documentation](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata). The [RealityKit radial mapping example](https://developer.apple.com/documentation/realitykit/lensdistortiondata) independently shows linear interpolation and relative magnification: with center `c`, radius `r=norm(p-c)` and lookup value `m(r)`, the mapped point is `c + (1+m(r))*(p-c)`. Zero means no magnification. Radius normalization uses the farthest image corner, not the principal point or half the image diagonal.

**Point mapping direction must be distinguished from image-resampling direction.** The reference implementation in Apple's installed `AVCameraCalibrationData.h`, lines 122–124, explicitly prescribes:

- Distorted/native **point to rectilinear point**: `inverseLensDistortionLookupTable`.
- Rectilinear **point to distorted/native point**: `lensDistortionLookupTable`.
- Rectifying an entire image by pulling samples from the source uses the second mapping at each output pixel.

This reconciles the public property descriptions about rectifying/reapplying images with the point-coordinate operator here. Apple's [WWDC17 capture presentation](https://developer.apple.com/videos/play/wwdc2017/507/) directs developers to that header's reference implementation. The inspected Apple SDK header is `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/AVFoundation.framework/Headers/AVCameraCalibrationData.h`, SHA-256 `50af0d3fcec5cc1cc281204d9c3fc41280cca70b5d61eefd2d5420ae539e6894`. Its `lensDistortionCenter` declaration also explicitly places the center in `intrinsicMatrixReferenceDimensions` coordinates. Only the mathematical mapping is implemented; no Apple sample source is redistributed.

## APIs and explicit domains

`map_radial_points(points_reference_uv, calibration, direction='rectify'|'distort')` returns mapped coordinates, valid mask, LUT identity/hash and rejection counts. It accepts only finite, nonfolding tables with at least two entries. Null tables are not interpreted as an ideal lens. Points beyond the calibrated radial domain are invalid/NaN; the implementation deliberately does not copy the SDK example's constant extension beyond the final radius. Nonfinite inputs are invalid. The two directions use their separate supplied tables; no unverified numerical inverse is invented.

`rectify_depth_points(native_frame, depth_to_reference=..., reference_mapping_id=...)` consumes the verified native reader's output. The explicit invertible affine pixel map includes the caller's validated scaling/crop/orientation and pixel-center offsets. It maps integer depth-sample centers into calibration-reference coordinates before applying the point LUT and inverse reference intrinsics. It does not silently choose either `u*scale` or `(u+0.5)*scale-0.5`. A known mapping is required; its numerical values and protocol ID are hashed into the derivation.

Each valid sample keeps its original axial depth in meters and its corrected camera ray. Positive finite depth, reference-image support and LUT-radius support are intersected. Outputs include camera points in meters, original depth pixels, corrected reference pixels and an image-shaped validity mask. Holes remain absent samples; no output regular raster is constructed. Filtered depth is rejected because this adapter has no independently measured-sample mask. Relative depth accuracy is rejected for metric unprojection.

The original artifact bytes are not modified, and decoded depth is rehashed against its original artifact before projection. Read-only numerical outputs and derivation metadata preserve source artifact/manifest hashes, calibration/LUT hashes and pixel-map hash. Hashes prove data lineage, not device authenticity or calibration correctness.

## Acceptance and remaining gates

Ten targeted tests verify lookup direction, relative magnification, forward/inverse roundtrip in the supported domain, nonconstant interpolation, farthest-corner radius, no extrapolation, reference-resolution scaling and offsets, known metric camera coordinates, retained invalid samples, source immutability/hash checking, folding/missing tables and filtered/relative-depth rejection.

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_depth_rectification.py -q
```

**BLOCKED for device/fusion acceptance:** validate the actual depth-to-reference mapping and LUT application against a known physical target; measure depth/calibration noise, synchronization and any needed rigid head pose; establish visible landmark correspondence. Output `joint_fusion_ready` remains false. The point-rectification algorithm is executable and tested on analytic fixtures; its output is conditional geometry, not validated human anatomy or a calibrated uncertainty estimate.
