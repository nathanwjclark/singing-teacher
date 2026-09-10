# Private calibrated surface diagnostic

`preview-native-depth.py` verifies a native capture ZIP, projects individual depth frames using the recorded intrinsics and radial calibration, and creates a self-contained interactive HTML preview plus a reference-frame PLY surface. It makes no network requests. Output belongs in an ignored `.local-data` directory, never in `public/` or the repository.

Requires Python, NumPy, and Pillow. Example:

```sh
science/.venv/bin/python scripts/preview-native-depth.py /private/path/capture.zip \
  --regions /private/path/regions.json \
  --output .local-data/capture-review/surface-preview
open .local-data/capture-review/surface-preview/index.html
```

The private region file binds manual annotations to a capture ID and reference frame. Coordinates are native, unmirrored 320×180 depth coordinates. This diagnostic currently rejects other depth dimensions. Keys: `capture_id`, `reference_frame`, `tracking_template_xyxy`, `regions_xyxy` (mouth, tongue, cheek), and `preview_xyxy`. Rectangles must leave a 22-pixel translation-search margin. Annotate them from the accompanying native camera frame rather than reusing them for another capture.

## Calibration and alignment

Apple's AVDepthData contract says the native depth map shares the accompanying image's lens distortion. RGB is area-downsampled to the native depth grid; there is no arbitrary color/depth shift optimization. Same aspect ratio is required when scaling intrinsics and lens distortion center. Each depth pixel center is mapped to a rectilinear ray, then projected using the scaled intrinsic matrix and axial depth. The exported surface uses meters in native camera coordinates, not head/world coordinates.

The direction of the radial lookup is important: the reference implementation in Apple's `AVCameraCalibrationData.h` explicitly uses **inverseLensDistortionLookupTable** to map a distorted sample to its rectilinear coordinate. The forward table supplies distorted source coordinates when inverse-warping an output image. This script follows that header and reports a forward/inverse round-trip check. Missing depth is never interpolated or filled.

Primary references:
- [AVDepthData](https://developer.apple.com/documentation/avfoundation/avdepthdata)
- [AVCameraCalibrationData](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata)
- [Lens distortion table](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/lensdistortionlookuptable)
- Apple SDK `AVCameraCalibrationData.h`, reference implementation after `lensDistortionCenter`.

Following the capture contract and calibration is not an independent measurement of RGB/depth registration or absolute scale. A calibration target was not part of this capture protocol. The preview must not claim validated metric accuracy.

## Temporal diagnostic

Normalized cross-correlation tracks a manually selected face patch against the reference image over a ±22-depth-pixel search. Frames below 0.8 correlation, or at the search boundary, are excluded from temporal aggregate metrics and plotted curves. Manual mouth/tongue/cheek rectangles follow that translation. Median cheek depth change supplies only an approximate axial-motion adjustment.

Reported absolute temporal residuals include actual articulation, rigid rotation, registration error, and sensor noise. They are not sensor precision or anatomical tracking accuracy. The preview shows individual frames, with no temporal fusion. Low-confidence sample frames remain inspectable and are explicitly labeled.

Optional connected surfaces only join neighboring valid depth samples with edges ≤5 mm and depth jumps ≤4 mm. This threshold is a conservative visualization heuristic, not validated tissue segmentation. Isolated artifacts can remain. Nothing in this diagnostic fits hidden anatomy or updates the application's musculoskeletal model.

Validation: identity radial calibration, known pinhole projection, and known image translation checked on small synthetic inputs; forward/inverse lookup consistency checked on actual calibration; generated viewer checked in Chrome for frame switching, rotation, color/surface controls, and no external requests.
