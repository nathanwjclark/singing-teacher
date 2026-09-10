# MOT-02 capture and revision 6 interchange

`MotionCapturePanel` accepts the current `TrackingFrame | null`, actual camera stream and optional microphone stream. Mount it where those streams are available. It does not request new permissions, acquire hardware by itself, or start recording automatically. Press **Start 3 repetitions** to record three 2s neutral / 3s comfortable gesture / 2s return cycles. Stop preserves incomplete attempts. Learner-marked onset, return and unsuccessful execution remain distinct from protocol prompts. JSON and companion video downloads preserve timestamps, visible observations, markers and context; load both for later replay.

The component captures browser MediaRecorder RGB/audio and actual incoming tracker observations. It rejects duplicate/out-of-order frame timestamps; timing gaps over 250ms are marked. A tongue point exists only when the tip tracker reports a tip. Missing tongue observations remain missing. Lip landmarks are model-derived image estimates, with unknown confidence where the upstream tracker does not quantify it.

Head motion is represented separately by outer-eye image translation/roll/scale, and articulation by coordinates relative to that image reference. This is a declared 2D normalization, **not calibrated rigid head registration**. Perspective, yaw and movement of the eye references remain confounds. Reported envelopes are bounds of observed samples in eye-span units, not physical maximum ranges. Per-frame gaps/visibility must be considered alongside envelopes. Browser media start time is recorded against performance.now, but actual sensor/encoder synchronization uncertainty is unknown.

## Interchange

`src/contracts/learning.ts` defines separately versioned CueDefinition, CueAttempt, SensationReport, MotionObservation, ControlProfile and TransferEvaluation records and a dependency-free runtime validator. Existing KIT-01 v1 records are unchanged. Sensations require subjective/human provenance. A reviewed cue requires reviewer/time/evidence. Motion records reject duplicate sample IDs, nonmonotonic timestamps, inconsistent source-relative times and coordinates masquerading as missing observations. These schemas do not authorize a cue or supply a motor model.

The coach prototype's local protocol/export types remain a separate application format. Consumers must explicitly map them into these shared records; neither package should be silently passed to the other's importer.

## Lead A calibrated motion adapter

The browser export intentionally does **not** call `observations.geometry.motion.analyze_motion`: that operator requires genuine depth and independently measured head pose. Supplying MediaPipe relative z, a guessed pixel-to-meter conversion, its face transform, or interpolated hidden points would violate the measurement contract.

A native acquisition adapter must provide, for each actual physical frame:

- Unique immutable frame and depth evidence IDs, session-clock timestamps and measured synchronization error bounds, including missing frames.
- Genuine depth or disparity with units, image pixel geometry, calibration/intrinsics, confidence/masking, noise/error estimates and a measured world-from-camera transform compatible with `DepthFrame`.
- `world_from_head` at the same physical instant, head-pose evidence ID, and physically justified rigid reference IDs independent of all moving landmark names/correspondence IDs. Both transforms share the same world frame and meter units.
- Repeatable visible-region annotations using integer depth-pixel centers, declared correspondence IDs, and explicit visibility. Occlusion never creates an inferred direct measurement.
- Cue/version/context/attempt/repetition and calibration-vs-held-out split, failed attempts included. Preserve markers as observations, not proof of success.
- Actual audio windows joined by frame ID with checked synchronization for dynamic inverse acoustic fitting; declare the native outer-lip protocol and a justified positive model-discrepancy sigma before supplying lip likelihoods.

Lead A's integrated `science/MOTION.md` documents the executable transform/fitting boundary. Native depth acquisition and repeated real human capture remain the G6 dependency; a frontend change cannot manufacture those observations. Browser export supports real visible trajectory review now but does not satisfy calibrated-depth fusion acceptance.

## Focused evidence

- `node --experimental-strip-types --test src/capture/motion.test.ts`: image translation/roll/scale normalization versus articulated movement, missing geometry, phase repetition/timing gaps, malformed record rejection.
- Build/typecheck and lint.
- Chrome browser smoke using an explicitly synthetic canvas stream: start, acquire 39 tracker frames, mark onset/failure, stop, export real nonempty WebM + validated JSON, reopen JSON and scrub. No browser errors. This verifies acquisition UI mechanics, not live human tracking accuracy.

Remaining physical evidence: capture three real comfortable repetitions, inspect replay/visibility and return timing, quantify synchronization/measurement uncertainty, and supply genuine native depth/head references for the calibrated inverse path. The lack of physical evidence must not be reported as completed G6.
