"""Apple radial LUT point rectification; no resampling or hidden surface filling."""
import base64
import hashlib
import json
import numpy as np
from .native_capture import NativeDepthFrame


_SOURCE = "https://developer.apple.com/videos/play/wwdc2017/507/"


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def map_radial_points(points_reference_uv, calibration, *, direction="rectify"):
    """Map reference-resolution pixel coordinates using the declared radial LUT.

    direction rectify: native/distorted -> rectilinear (inverseLensDistortionLookupTable).
    direction distort: rectilinear -> native (lensDistortionLookupTable).
    Invalid/nonfinite/out-of-LUT-radius coordinates are NaN with an explicit mask.
    """
    if direction not in ("rectify", "distort"):
        raise ValueError("direction must be rectify or distort")
    points = np.asarray(points_reference_uv, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2:
        raise ValueError("points require N by 2 reference pixel coordinates")
    dimensions = np.asarray(calibration.get("intrinsic_reference_dimensions"), float)
    center = np.asarray(calibration.get("lens_distortion_center"), float)
    if (dimensions.shape != (2,) or center.shape != (2,) or not np.isfinite(dimensions).all()
            or not np.isfinite(center).all() or np.any(dimensions <= 0)
            or np.any(center < 0) or np.any(center > dimensions)):
        raise ValueError("invalid reference dimensions or distortion center")
    field = "inverse_lens_distortion_table_base64" if direction == "rectify" else "lens_distortion_table_base64"
    encoded = calibration.get(field)
    if not isinstance(encoded, str) or not encoded:
        raise ValueError(f"{field} must contain measured float32 LUT data; null is not zero distortion")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid LUT encoding") from exc
    if len(raw) % 4 or len(raw) < 8:
        raise ValueError("radial LUT needs at least two float32 entries")
    table = np.frombuffer(raw, dtype="<f4").astype(float)
    if not np.isfinite(table).all():
        raise ValueError("nonfinite radial LUT")
    maximum_radius = float(np.linalg.norm(np.maximum(center, dimensions-center)))
    knots = np.linspace(0, maximum_radius, len(table))
    slopes = np.diff(table)/np.diff(knots)
    # r_out = r * (1 + LUT(r)); reject nonpositive radial derivatives.
    derivatives_left = 1 + table[:-1] + knots[:-1]*slopes
    derivatives_right = 1 + table[1:] + knots[1:]*slopes
    if np.any(derivatives_left <= 0) or np.any(derivatives_right <= 0):
        raise ValueError("radial LUT folds or collapses the calibrated radius domain")
    finite = np.isfinite(points).all(axis=1)
    radii = np.full(len(points), np.inf)
    radii[finite] = np.linalg.norm(points[finite]-center, axis=1)
    valid = finite & (radii <= maximum_radius)
    mapped = np.full(points.shape, np.nan)
    magnification = np.interp(radii[valid], knots, table)
    mapped[valid] = center + (points[valid]-center)*(1 + magnification[:, None])
    valid &= np.isfinite(mapped).all(axis=1)
    mapped[~valid] = np.nan
    mapped.setflags(write=False); valid.setflags(write=False)
    return {"points_reference_uv": mapped, "valid_mask": valid, "direction": direction,
        "lut_field": field, "lut_sha256": hashlib.sha256(raw).hexdigest(), "maximum_radius_reference_pixels": maximum_radius,
        "invalid_reasons": {"nonfinite_input": int((~finite).sum()),
                            "outside_calibrated_radius": int((finite & (radii > maximum_radius)).sum())}}


def rectify_depth_points(frame: NativeDepthFrame, *, depth_to_reference, reference_mapping_id):
    """Correct rays of original raw depth samples and unproject to camera meters.

    depth_to_reference is an explicitly validated affine map from integer-center
    depth pixels to calibration-reference coordinates, including crop/scale/offset.
    No default resize convention, calibration-to-world transform, or interpolation.
    """
    if not isinstance(reference_mapping_id, str) or not reference_mapping_id.strip():
        raise ValueError("a validated reference_mapping_id is required")
    if frame.depth_m is None or frame.calibration is None or frame.evidence_id is None:
        raise ValueError("verified native depth and camera calibration are required")
    if frame.source_metadata.get("depth_filtered") is not False:
        raise ValueError("filtered depth needs a measured-sample mask not available in this adapter")
    if frame.source_metadata.get("depth_accuracy_label") != "absolute":
        raise ValueError("metric unprojection requires declared absolute axial depth")
    matrix = np.asarray(depth_to_reference, float)
    if (matrix.shape != (3, 3) or not np.isfinite(matrix).all()
            or not np.allclose(matrix[2], [0, 0, 1], atol=1e-12, rtol=0)
            or abs(np.linalg.det(matrix[:2, :2])) <= 1e-12):
        raise ValueError("depth_to_reference must be an invertible affine pixel map")
    k = np.asarray(frame.calibration.get("intrinsics_row_major"), float)
    if (k.shape != (3, 3) or not np.isfinite(k).all() or k[0, 0] <= 0 or k[1, 1] <= 0
            or not np.allclose(k[2], [0, 0, 1], atol=1e-12, rtol=0) or abs(np.linalg.det(k)) <= 1e-12):
        raise ValueError("invalid calibrated pinhole intrinsics")
    depth = np.asarray(frame.depth_m)
    raw_depth_digest = hashlib.sha256(np.asarray(depth, dtype="<f4").tobytes(order="C")).hexdigest()
    if raw_depth_digest != frame.source_metadata["depth"]["sha256"]:
        raise ValueError("decoded depth no longer matches original artifact hash")
    h, w = depth.shape
    v, u = np.indices((h, w))
    pixels = np.column_stack((u.ravel(), v.ravel()))
    reference = np.column_stack((pixels, np.ones(w*h))) @ matrix.T
    dimensions = np.asarray(frame.calibration["intrinsic_reference_dimensions"], float)
    in_reference = ((reference[:, :2] >= 0) & (reference[:, :2] < dimensions)).all(axis=1)
    mapped = map_radial_points(reference[:, :2], frame.calibration)
    valid_depth = np.isfinite(depth.ravel()) & (depth.ravel() > 0)
    valid = mapped["valid_mask"] & in_reference & valid_depth
    corrected = mapped["points_reference_uv"][valid]
    corrected.setflags(write=False)
    rays = np.column_stack((corrected, np.ones(len(corrected)))) @ np.linalg.inv(k).T
    points = rays * depth.ravel()[valid, None]
    if not np.isfinite(points).all():
        raise ValueError("nonfinite calibrated point projection")
    lineage = {"source_evidence_id": frame.evidence_id,
        "source_artifact_sha256": frame.source_metadata["depth"]["sha256"],
        "source_manifest_sha256": frame.readiness["manifest_sha256"],
        "calibration_sha256": _hash(frame.calibration), "lut_field": mapped["lut_field"], "lut_sha256": mapped["lut_sha256"],
        "reference_mapping_id": reference_mapping_id, "depth_to_reference": matrix.tolist(),
        "algorithm": "apple-relative-radial-lut-original-sample-rays-v1"}
    lineage["derivation_sha256"] = _hash(lineage)
    points.setflags(write=False)
    valid = valid.reshape(h, w); valid.setflags(write=False)
    source_pixels = pixels[valid.ravel()]; source_pixels.setflags(write=False)
    return {"points_camera_m": points, "pixels_depth_uv": source_pixels, "valid_mask": valid,
        "rectified_reference_uv": corrected, "evidence_id": frame.evidence_id,
        "timestamp_seconds": frame.timestamp_seconds, "timebase_id": frame.timebase_id,
        "lineage": lineage, "source": _SOURCE,
        "rejected": {**mapped["invalid_reasons"], "outside_reference_image": int((~in_reference).sum()),
                     "invalid_depth": int((~valid_depth).sum())},
        "joint_fusion_ready": False,
        "remaining_gates": ["reference_pixel_mapping_requires_device_validation", "depth_noise_not_calibrated",
                            "audio_clock_alignment_not_measured", "absolute_sync_uncertainty_unknown",
                            "world_head_pose_not_measured", "landmark_correspondence_not_validated"],
        "uncertainty": "not_estimated; geometry conditional on calibration and declared pixel mapping"}
