# A geometry consumer for B's native capture

`observations.geometry.native_capture.read_native_capture(directory)` reads the original private SingingDepth directory. It does not rewrite B's KIT importer or accept browser landmark estimates as native depth. Supported input is `singing-native-rgbd-1.0.0`, `one-held-pose`, unmirrored front TrueDepth, as emitted by `apps/ios/SingingDepth/SingingDepth/DepthCapture.swift` and consumed by `scripts/import-native-capture.ts`.

The consumer verifies every referenced original artifact (including audio/RGB) against manifest SHA-256 and byte count, rejects unsafe paths/symlinks and duplicate JSON keys, bounds reads to 512 MiB by default, and decodes packed row-major little-endian float32 depth in meters. Invalid/nonpositive samples remain in the raw array; positive finite counts are coverage only. Arrays are read-only. Camera intrinsics, their **reference resolution**, sensor calibration extrinsics and distortion tables are validated and preserved. Native calibration extrinsics are explicitly **not** treated as world/head pose. Source capture and depth clocks are checked separately for reversal, rational timestamp consistency and epoch changes.

Returned `NativeCapture` contains capture ID, original manifest hash, verified artifact lineage and ordered `NativeDepthFrame` objects. Each frame contains the original sequence/frame ID, depth array (or `None`), calibration/source metadata, mapped source timestamp, evidence ID and readiness report. IDs match B's import convention:

- Depth evidence: `<capture_id>/artifact/<original depth filename>`.
- Depth clock: `<capture_id>/depth/synchronizer/epoch-<epoch>`.

The timestamps remain source-clock seconds. No equality with the audio clock, measured physical synchronization uncertainty or RGB/depth rectification is inferred from callback timing. Byte verification proves package consistency, not physical-device authenticity. Software fixtures must remain labeled as fixtures.

## Current readiness result

For the current native format, `metric_points_ready` and `joint_fusion_ready` are false. This is a derived acceptance decision for the actual producer's unsupported calibration steps, not a reconstruction fallback. Blocking reasons explicitly include unrectified native distortion, uncalibrated depth noise, unmeasured audio clock alignment/absolute synchronization uncertainty, absent world/head pose and unvalidated landmark correspondence. Additional reasons identify missing depth/calibration, relative accuracy, filtered depth without a measured-sample mask, or no positive finite samples.

This consumer deliberately stops before `DepthFrame(rectified=True)`. Null distortion lookup tables do not prove zero distortion. Intrinsics at the reference resolution cannot silently be used at depth resolution. Finite metric samples do not establish an accurate mouth surface, and `depth_accuracy_label='absolute'` does not quantify measurement noise.

**Next executable gate:** independently validate a rectification/resampling procedure with its transformed intrinsics and validity mask, supply measured error estimates and clock alignment, and preserve source-manifest/artifact hashes through that derivative. For dynamic head-relative motion, additionally supply rigid head-pose evidence and declared visible-region correspondence. Existing `reconstruct`, `joint_lip_measurement` and `analyze_motion` then consume that validated derivative. No such derivative is present in the current capture schema, so this implementation does not create one by assertion.

## Verification

14 targeted tests cover exact packed-depth decoding, KIT-compatible lineage, original calibration preservation, missing/relative/filtered depth gating, invalid formats/calibration/timestamps, reversed depth clocks, all-artifact verification, path traversal, symlinks, duplicate JSON and byte limits.

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_native_capture_geometry.py -q
```

**BLOCKED for physical-device validation:** no actual phone bundle, known-target error measurements or validated rectification/alignment derivative was supplied. The software fixture tests make no human reconstruction claim.
