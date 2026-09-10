# Optional rear LiDAR implementation status

This is partial software delivery under the A-owned LIDAR-01–05 plan. It does not establish physical sensor performance or completed inference.

| Ticket | Implemented software | Remaining acceptance |
|---|---|---|
| LIDAR-01 | Camera-only optional rear scanner, supported-format discovery, synchronized original RGB/depth, actual calibration/filtering/timestamps, missing-confidence metadata, bounded capture and protected archive. | Full iOS SDK build and physical device runs, including permission, interruption and return-to-front-camera cases. |
| LIDAR-02 | Existing independent plane/distance target diagnostic can explicitly admit rear captures; original reference annotation requirements and error bounds remain unchanged. | Predeclared physical target dimensions/error, acquisition distance/angle and repeated captures from each sensor, evaluated independently of implementation. No comparative result exists yet. |
| LIDAR-03 | Opt-in KIT and geometry ingestion preserve actual rear sensor identity and hashes. Original valid pixels project through the existing calibrated ray operator; missing samples stay missing. | Real calibration/pixel-map validation, coverage and source-error characterization. |
| LIDAR-04 | Optional native scanner sheet and raw preview; front camera is paused before rear activation and restored only after rear release. Rear archives use the existing share and USB pull path with dated, review-only status. | iPhone UI/device validation. This host has Command Line Tools, not a full Xcode/iOS SDK installation. |
| LIDAR-05 | Fusion remains disabled. The existing readiness gates still require registration, correspondence and error evidence; Astra receives capability status and uses supported baseline actions. | A verified geometry likelihood consuming accepted real rear observations and equal-budget comparisons. Preview/ingestion must not be described as completed fusion. |

## Use and gates

In the native app, expand **Optional rear LiDAR**, enable separate rear scans, then open the scanner between recordings. No microphone is acquired by the rear scanner. Share its `rear-lidar-<capture-id>.zip` or use the existing USB pull button.

Rear capture is off by default. For automatic rear ZIP coverage verification on the Mac, enable `LIDAR_PREVIEW_ENABLED=1` once when starting the app. Without it the original archive is still retained, but optional rear validation stays disabled. Core capture and the current model remain available. KIT callers opt in with `allowRearLidar: true`; the Python geometry reader and target diagnostic use `allow_rear_lidar=True`. The target CLI also accepts `--allow-rear-lidar`. None of these enables model fusion.

The rear archive mode is `separate-rear-lidar-held-pose`; device provenance declares the rear LiDAR camera. Apple AVDepthData can represent vendor-fused depth rather than individual independent laser returns. Filtering flags and unknown confidence are retained. A separate scan never becomes the pose of a previous recording, and calibration extrinsics never become a head/world transform.

## Evidence

- 39 geometry/rectification/target/ZIP tests passed, including default-disabled rear handling, sensor mismatch, original-byte projection with missing pixels and no fusion.
- Four KIT importer tests passed, including rear provenance and unchanged legacy behavior.
- Build/typecheck and lint passed; all Swift files parse and the Xcode project passes plist validation.
- Independent code review identified and resolved background camera ownership, rear archive discovery and sensor labeling issues.

Swift parsing is not an iOS SDK typecheck. No phone test, hardware accuracy, model contribution or complete native build is claimed.

Primary API references: [Apple LiDAR depth camera](https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicetype-swift.struct/builtinlidardepthcamera), [supported depth formats](https://developer.apple.com/documentation/avfoundation/avcapturedevice/format/supporteddepthdataformats), [depth output](https://developer.apple.com/documentation/avfoundation/avcapturedepthdataoutput).
