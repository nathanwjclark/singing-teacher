# Private native RGB-D capture prototype

`SingingDepth/SingingDepth.xcodeproj` builds a minimal iOS 17+ SwiftUI app for a **physical front TrueDepth camera**. There is no simulated sensor fallback, account, backend, tunnel or automatic upload.

## Build and run

Unsigned device compilation (does not install or authorize any device):

```sh
xcodebuild -project apps/ios/SingingDepth/SingingDepth.xcodeproj \
  -scheme SingingDepth -sdk iphoneos -configuration Debug \
  -derivedDataPath /tmp/singing-depth-build CODE_SIGNING_ALLOWED=NO build
```

For the user's **iPhone 13 Pro Max** (iOS 17 or newer):

1. Connect and unlock the iPhone, and accept its **Trust This Computer** prompt if shown.
2. Open `apps/ios/SingingDepth/SingingDepth.xcodeproj` in Xcode. Select the **SingingDepth** target, then **Signing & Capabilities**, and choose your own development team. Keep automatic signing enabled. If that team cannot register `com.singingteacher.depth`, set a unique bundle identifier for your local installation.
3. Select the connected iPhone as the run destination. Enable **Developer Mode** on the phone if Xcode requests it, following the phone's restart/confirmation prompts, then run the **SingingDepth** scheme.
4. Allow camera access. Microphone access is optional. Confirm the preview badge says **Preview · not recording** before pressing **Start capture**.

Signing requires a development identity available to Xcode; this repository does not include signing credentials or a provisioning profile. An unsigned build cannot be installed by itself. Simulator compilation cannot establish TrueDepth functionality. This native capture path needs no HTTPS certificate, QR pairing or web server.

The app requests camera and microphone permissions. Camera preview does not record files. Microphone denial leaves RGB-D capture available with an explicit missing reason. Choose a comfortable held pose, press **Start capture**, hold the phone and pose comfortably still, then **Stop**. Capture stops automatically after ten seconds or when the app backgrounds. Each capture is independent; don't fuse a changing tongue/jaw into a static scan. Share the resulting ZIP through the system share sheet only when ready. Files have complete file protection and are excluded from device backups; the chosen share destination determines its subsequent storage. Captures remain in the app's local Documents container; remove the app to delete its local capture history.

## First physical acceptance check (keep it small)

- With the front camera facing you, frame the whole mouth in comfortable lighting. Record one relaxed, still pose for 2–3 seconds, then stop. The badge must switch from preview to recording to saving; the share button becomes available only after saving.
- Share the ZIP explicitly to the Mac (for example using AirDrop), preserve it unchanged, and inspect its manifest and media. Confirm actual RGB/depth artifacts and timestamp/calibration fields exist; microphone audio must either exist or have a recorded missing reason.
- Inspect finite positive depth coverage **within visible mouth pixels** before attempting fitting. A successful ZIP or readable selfie does not prove inside-mouth depth. Do not ask for more captures until this first one establishes useful coverage.
- For a second quick check, background the app while recording: it should end the capture and save a ZIP with an app-backgrounded stop reason. Permission-denial cases can be checked if a permission issue occurs; no broad automated device suite is required.

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

If saving fails, raw capture files remain on the phone and **Retry saving capture** retries the same manifest and ZIP without recording again. New capture is blocked until that pending save succeeds. Retry state is retained for the current app run; after an app termination the raw folder remains, but a capture-history recovery UI is not yet implemented.

## Acoustic mapping (PROBE-01)

Switch to **Acoustic mapping** to release the camera capture session and use a standalone native full-duplex audio engine. No RGB/depth is claimed for these trials. **Prepare route (silent)** requests the built-in speaker/microphone with measurement mode; hardware processing remains unverified. No automatic playback, volume escalation, Bluetooth or headphones. Ordinary camera capture resumes after leaving this mode.

**Playback remains locked until physical setup acceptance is performed.** Export the route request, obtain a reviewed output-level measurement using a calibrated instrument for this device/route/volume/placement, then import its JSON. The app accepts `probe-level-check-1.0.0` with `id`, matching `routeSignature`, `protocolId` (`external-sweep-pilot-1`), `placementId`, `approvedForHumanPlayback: true`, `calibratedInstrument`, `instrumentCalibrationEvidence`, `measurementEvidence`, `reviewer`, ISO8601 `expiresAt`, and finite positive `measuredPeakDbSPL <= limitPeakDbSPL <= 70`. The 70 dB SPL ceiling is an implementation cap, **not a claim of validated exposure or a substituted physical measurement**. A self-authored checkbox is not provided. Imported records are operator-supplied evidence, not independently verified measurements. Keep the phone external to the lips and do not use this as an in-ear test. Moving it requires a new placement/check.

The versioned pilot waveform is deterministic: mono float32, 300–6000 Hz logarithmic sine sweep, 1 second, 20 ms raised-cosine onset/offset, peak digital amplitude 0.01, three repetitions, 0.5 second silence before/between/after. Actual input/output sample rate and volume are recorded; digital gain is not calibrated pressure. Recording starts before scheduled playback and continues through the trailing interval. Stop, background, route/session interruption, or volume changes cancel playback locally; route/volume changes invalidate the check.

Private `probe-<UUID>.zip` contains `manifest.json` (`schemaVersion: probe-native-1.0.0`), exact `drive.f32le`, original first microphone channel `received.f32le`, and original `level-check.json`, all hashed. The manifest preserves full drive timeline, repeated segment windows, input buffer indices/sample/host timestamps and ASBD metadata, discontinuities/clipping, actual session route/latencies/processing claims, scheduled playback host time, pose/placement and stop/failure status. Alignment is an estimate: hardware/acoustic delay is unverified, uncertainty is unknown, and absolute phase is unsupported. No captured recording is labeled usable or fitted until external verified-media analysis.

Physical acceptance remains: measured output-level/protocol review, one real full-duplex capture, interruption/route/volume stop checks on-device, verified repeated-response replay, and inference-operator integration. Software build success does not satisfy those checks. Optional second-phone capture and calibrated phase/range are not implemented by this first native collector.
