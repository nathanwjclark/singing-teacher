# Dynamic tongue review: A handoff acceptance

Reviewed B's `review-dynamic-tongue.py` from the `d70401d` update, present in the local merge of `origin/main` at `703492f`. This is a substantive advance over translation/cheek-offset alignment: it estimates a full rigid current-camera-to-reference-camera transform from facial depth correspondences, reserves every fifth feature ID from fitting, and scores those reserved anchors. A separate seeded optical-flow mask supplies candidate tongue support. Each frame fits its own quadratic patch with a spatial holdout; this is local interpolation, not a frozen prediction of another pose.

## Verified behavior and fixes

Eleven tests execute the actual B numerical functions and check the source's validation/evaluation boundaries. A known 0.18-radian rotation and `[12,-7,4]` millimeter translation are recovered from training anchors with large outliers; untouched anchors have errors below `1e-10 mm` on the exact analytic fixture. Fewer than twelve or collinear anchors cannot produce a robust transform. Sampled axial depth is converted from meters into millimeters consistently, and invalid/out-of-image samples remain invalid.

Two bounded corrections were made in B's script:

1. Annotations previously lacked bounds/containment checks. A mouth-exclusion rectangle could omit the seeded tongue, allowing evaluated tissue into head anchors. `validate_annotations` now runs before features are selected; it requires valid integer face/exclusion rectangles, a finite nonzero-area tongue polygon entirely inside the mouth exclusion, an existing paired seed frame and boolean visibility labels for known frames. Facial masks may overlap the mouth rectangle because the latter is explicitly removed before feature selection. Geometric exclusion is not proof of physiological rigidity or semantic tissue identity.
2. A missing forward/backward Lucas–Kanade result previously caused array access on `None`. Those frames now retain their frame/time identity with explicit rejection reasons and empty observed/fitted/face arrays. No surface is copied from another frame.

The viewer already suppresses rejected head/patch fits and breaks plotted trajectories across failed frames. It does not interpolate a new surface across failure. Failed fits can remain in diagnostic records, so consumers must respect `head.valid` and `tongue.fit_valid`, rather than assuming an existing coefficient is accepted evidence.

## What is newly available to A

The transform convention is now concrete: `p_reference_mm = R_current_to_reference @ p_current_mm + translation_mm`. Converting the translation to meters supplies a camera-to-reference transform for A's geometry coordinates. It remains a **sensor-derived estimated** head transform with spatial holdout residuals, not independently measured pose ground truth or calibrated pose covariance. The reserved anchors share the sensor/frame and may have correlated errors.

Observed reference-frame patch points and per-frame surfaces can be retained as derived visible geometry. The patch centroid describes the currently selected support, not a persistent anatomical tongue tip. Changes can reflect real movement, occlusion, changing support, correspondence errors or sensor noise. No native `TCX`/`TCY` or tongue-side parameter can be assigned directly from it.

## Required integration evidence

The current analysis output records sequence and relative seconds, rigid matrices/translation, aggregate anchor counts and conditional fit results. It does not alone supply the complete A dynamic contract: original frame/artifact IDs and hashes, source timebase plus synchronization bounds, cue/attempt/context/split bindings, audio windows, per-landmark/native-surface correspondence or calibrated uncertainty. A must join the report to the verified original manifest, preserve registration/annotation/calibration lineage, retain rejected frames and explicitly label pose as inferred. Aggregate holdout residuals cannot be silently used as standard deviations.

A native tongue observation operator also needs declared correspondence to the supported model surface. B's seeded patch is not already matched to VTL tongue EMA vertices or a registered native mesh. Physical target accuracy, head rigidity, tissue identity and same-state audio alignment remain external acceptance gates. No actual private recording or derived patch data was available in this worktree to independently validate them.

Run the software checks:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_dynamic_tongue_handoff.py -q
```

These tests avoid the optional OpenCV/Pillow runtime by compiling B's exact pure numerical functions from their source. They validate those functions and source wiring, not full optical-flow execution or the private capture's physical accuracy.
