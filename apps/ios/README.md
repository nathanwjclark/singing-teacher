# Private native RGB-D capture prototype

`SingingDepth/SingingDepth.xcodeproj` builds a minimal iOS 17+ SwiftUI app for a **physical front TrueDepth camera**. There is no simulated sensor fallback, account, backend, tunnel or automatic upload.

## Build and run

Unsigned device compilation (does not install or authorize any device):

```sh
xcodebuild -project apps/ios/SingingDepth/SingingDepth.xcodeproj \
  -scheme SingingDepth -sdk iphoneos -configuration Debug \
  -derivedDataPath /tmp/singing-depth-build CODE_SIGNING_ALLOWED=NO build
```

For device testing, open the project in Xcode, choose the user's signing team and an attached compatible iPhone/iPad, then run. This repository does not include signing credentials or a provisioning profile. Simulator compilation cannot establish TrueDepth functionality.

The app requests camera and microphone permissions. Camera preview does not record files. Microphone denial leaves RGB-D capture available with an explicit missing reason. Choose a comfortable held pose, press **Start capture**, hold the phone and pose comfortably still, then **Stop**. Capture stops automatically after ten seconds or when the app backgrounds. Each capture is independent; don't fuse a changing tongue/jaw into a static scan. Share the resulting ZIP through the system share sheet only when ready. Files have complete file protection and are excluded from device backups; the chosen share destination determines its subsequent storage. Captures remain in the app's local Documents container; remove the app to delete its local capture history.

## Exact acquisition and export

- Front `builtInTrueDepthCamera`; supported RGB format up to 1280 wide, depth up to 320 wide, 15 fps requested when supported. Export reports actual dimensions and source format IDs.
- `AVCaptureDataOutputSynchronizer` aligns the video/depth outputs. Actual output timestamps, rational CMTime components, observed timestamp deltas, dropped flags and raw drop reasons are retained. Sensor synchronization error has **not** been measured; timestamp agreement is not a claim of physical synchronization accuracy.
- RGB is JPEG encoded from actual BGRA buffers, native output orientation without EXIF rotation. Sensor outputs have mirroring disabled; preview appearance does not transform exported data.
- Depth is `AVDepthData` converted to `DepthFloat32`: packed row-major little-endian IEEE float32 **meters**, preserving invalid/nonpositive values. Consumers must mask them. Filtering is requested off, and the actual `isDepthDataFiltered`, quality and accuracy enum values are exported. A relative-accuracy result must not be treated as calibrated absolute geometry.
- Each depth sample preserves available intrinsics, intrinsic reference dimensions, the native 3x4 calibration extrinsic matrix, pixel size, distortion center and distortion lookup buffers (base64). These are **not world/head poses**. No rectification is applied and no distortion-free backprojection is implied. Camera calibration may be absent and is then explicitly missing.
- Optional microphone input uses a separate `AVCaptureAudioDataOutput` from the same capture session, **not** the RGB-D synchronizer. Native interleaved LPCM bytes are preserved with full ASBD, exact source presentation timestamps, duration, sample count and gap measurements. Compressed/noninterleaved or unavailable output is explicitly missing instead of guessed. No resampling, encoder padding assumption, acoustic extraction or per-video-frame audio association is performed.
- `manifest.json` uses `schema_version: singing-native-rgbd-1.0.0`, contains the held-pose task/start/end/stop reason, camera info, source timebase, `frames` and `audio.samples`. Every recorded media artifact contains relative `path`, exact `bytes` and SHA-256 `sha256`. The ZIP writer stores the original bytes without compression.

Example depth entry: `frames[i].depth = {path: "<capture>-frame-N.depth.f32", bytes: width * height * 4, sha256: "…"}`. Calibration lives in `frames[i].calibration`; audio chunks in `audio.samples[i].artifact` alongside per-sample `asbd`. A missing artifact never means a zero-valued observation.

## Scientific boundary and acceptance

This supplies the native acquisition **software**, not a demonstrated inside-mouth scan. TrueDepth may return invalid depths on small, occluded, reflective or close mouth surfaces. Visible camera color does not establish valid measured depth there. Review finite positive depth coverage against real mouth pixels and calibration metadata before fitting.

Held-pose overlapping RGB-D views can constrain visible geometry only after calibration/distortion treatment and registration. Different articulation poses remain separate surfaces. Hidden anatomy, world/head transforms, anatomical correspondence and sensor noise are not manufactured. Lead A's motion/inverse interface still requires independently justified head references, correspondence, uncertainty and actual device evidence. Raw depth artifacts are not accepted as fitted anatomy by this app.

**Evidence obtained here:** Xcode 26.6 unsigned iPhoneOS Debug build passed, including the optional audio capture implementation. A focused ZIP fixture roundtrip checks CRC and original bytes. No connected device was available; no real depth/audio capture, permission-denial flow, close-mouth coverage, audio continuity, physical synchronization or share-sheet destination has been verified. These remain the physical acceptance gate.

Primary API references: [Apple TrueDepth streaming](https://developer.apple.com/documentation/avfoundation/streaming-depth-data-from-the-truedepth-camera), [synchronized depth capture](https://developer.apple.com/documentation/avfoundation/capturing-depth-using-the-lidar-camera), [depth output formats](https://developer.apple.com/documentation/avfoundation/avcapturedepthdataoutput), and [camera calibration](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata). The LiDAR sample supplies the synchronized-output pattern; this app selects the front TrueDepth device explicitly.
