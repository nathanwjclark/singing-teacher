"""Predeclared physical-target diagnostics over verified native depth evidence."""
import hashlib
import json
import math
import numpy as np
from .native_capture import read_native_capture
from .rectification import rectify_depth_points


def _positive(value, name, *, zero=False):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or (not zero and value == 0):
        raise ValueError(f"{name} must be finite and {'nonnegative' if zero else 'positive'}")
    return float(value)


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be nonempty text")
    return value


def _stats(residual):
    values = np.asarray(residual, float)
    if not len(values):
        return None
    median = float(np.median(values))
    return {"count": len(values), "median_signed_residual_m": median,
        "median_absolute_residual_m": float(np.median(np.abs(values))),
        "p95_absolute_residual_m": float(np.quantile(np.abs(values), .95)),
        "rms_residual_m": float(np.sqrt(np.mean(values**2))),
        "median_absolute_deviation_m": float(np.median(np.abs(values-median)))}


def assess_capture_targets(directory, annotation, *, allow_rear_lidar=False):
    """Score independently supplied camera-plane/distance targets without fitting.

    Annotation thresholds and target geometry must be fixed independently of the
    evaluated depth. No target pose, calibration or noise parameters are optimized.
    """
    try:
        annotation_bytes = json.dumps(annotation, sort_keys=True, allow_nan=False).encode()
        spec = json.loads(annotation_bytes)
    except (ValueError, TypeError) as exc:
        raise ValueError("annotation must be finite JSON") from exc
    if not isinstance(spec, dict) or spec.get("schema_version") != "native-target-diagnostic-0.1.0":
        raise ValueError("unsupported target annotation schema")
    capture = read_native_capture(directory, allow_rear_lidar=allow_rear_lidar)
    if spec.get("capture_id") != capture.capture_id or spec.get("manifest_sha256") != capture.manifest_sha256:
        raise ValueError("target annotation does not match the verified capture/manifest")
    limits = spec.get("tolerances", {})
    coverage_min = _positive(limits.get("minimum_valid_fraction"), "minimum_valid_fraction")
    if coverage_min > 1:
        raise ValueError("minimum_valid_fraction cannot exceed one")
    median_limit = _positive(limits.get("maximum_absolute_median_m"), "maximum_absolute_median_m")
    p95_limit = _positive(limits.get("maximum_p95_absolute_m"), "maximum_p95_absolute_m")
    rows = spec.get("observations")
    if not isinstance(rows, list) or not rows:
        raise ValueError("at least one target observation is required")
    frames = {f.sequence: f for f in capture.frames}
    seen = set()
    results = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("target observation must be an object")
        sequence = row.get("sequence")
        if type(sequence) is not int or sequence not in frames:
            raise ValueError("target sequence is not in verified capture")
        target_id = _text(row.get("target_id"), "target_id")
        if (sequence, target_id) in seen:
            raise ValueError("duplicate target observation")
        seen.add((sequence, target_id))
        for field in ("reference_evidence_id", "reference_protocol_id"):
            _text(row.get(field), field)
        kind = row.get("reference_kind")
        if kind not in ("independently_measured_target", "analytic_fixture"):
            raise ValueError("reference_kind must distinguish physical target from analytic fixture")
        reference_bound = _positive(row.get("reference_error_bound_m"), "reference_error_bound_m", zero=True)
        pixels = np.asarray(row.get("pixels_depth_uv"))
        if (pixels.ndim != 2 or pixels.shape[1] != 2 or len(pixels) == 0
                or not np.issubdtype(pixels.dtype, np.number) or not np.isfinite(pixels).all()
                or not np.equal(pixels, np.floor(pixels)).all() or np.any(pixels < 0)
                or len(np.unique(pixels, axis=0)) != len(pixels)):
            raise ValueError("target requires unique nonnegative integer depth pixels")
        model = row.get("target", {})
        target_type = model.get("kind")
        if model.get("unit") != "m":
            raise ValueError("target units must be m")
        if target_type == "camera_plane":
            normal = np.asarray(model.get("unit_normal_camera"), float)
            offset = model.get("offset_m")
            if (normal.shape != (3,) or not np.isfinite(normal).all()
                    or not np.isclose(np.linalg.norm(normal), 1, atol=1e-8, rtol=0)
                    or type(offset) not in (int, float) or not math.isfinite(offset)):
                raise ValueError("camera plane requires unit normal and finite signed offset")
        elif target_type == "endpoint_distance":
            distance = _positive(model.get("distance_m"), "known endpoint distance")
            if len(pixels) != 2:
                raise ValueError("endpoint_distance requires exactly two annotated endpoints")
        else:
            raise ValueError("unsupported target geometry")
        frame = frames[sequence]
        report = {"sequence": sequence, "target_id": target_id, "reference_kind": kind,
            "reference_evidence_id": row["reference_evidence_id"], "reference_protocol_id": row["reference_protocol_id"],
            "reference_error_bound_m": reference_bound, "target": model,
            "source_evidence_id": frame.evidence_id, "timestamp_seconds": frame.timestamp_seconds,
            "timebase_id": frame.timebase_id, "requested_samples": len(pixels)}
        if frame.depth_m is None or frame.calibration is None:
            results.append({**report, "status": "unavailable", "reason": "depth_or_calibration_missing",
                "valid_samples": 0, "valid_fraction": 0., "statistics": None, "within_declared_tolerances": False})
            continue
        height, width = frame.depth_m.shape
        if np.any(pixels[:, 0] >= width) or np.any(pixels[:, 1] >= height):
            raise ValueError("annotated target pixel is outside the depth array")
        projected = rectify_depth_points(frame, depth_to_reference=row.get("depth_to_reference"),
            reference_mapping_id=row.get("reference_mapping_id"))
        lookup = {tuple(pixel): point for pixel, point in zip(projected["pixels_depth_uv"], projected["points_camera_m"])}
        selected = [lookup[tuple(pixel)] for pixel in pixels if tuple(pixel) in lookup]
        count = len(selected)
        fraction = count/len(pixels)
        if target_type == "camera_plane":
            residual = np.asarray(selected) @ normal-offset if selected else np.empty(0)
        else:
            residual = np.array([np.linalg.norm(selected[1]-selected[0])-distance]) if count == 2 else np.empty(0)
        stats = _stats(residual)
        passes = stats is not None and fraction >= coverage_min and abs(stats["median_signed_residual_m"]) <= median_limit and stats["p95_absolute_residual_m"] <= p95_limit
        results.append({**report, "status": "scored" if stats is not None else "unavailable",
            "reason": None if stats is not None else "no_complete_valid_target_measurement",
            "valid_samples": count, "valid_fraction": fraction, "statistics": stats,
            "within_declared_tolerances": bool(passes), "lineage": projected["lineage"]})
    return {"schema_version": "native-target-diagnostic-0.1.0", "capture_id": capture.capture_id,
        "manifest_sha256": capture.manifest_sha256, "annotation_sha256": hashlib.sha256(annotation_bytes).hexdigest(),
        "tolerances": limits, "observations": results,
        "all_within_declared_tolerances": all(r["within_declared_tolerances"] for r in results),
        "physical_target_observation_count": sum(r["reference_kind"] == "independently_measured_target" for r in results),
        "sensor_noise_calibrated": False, "physiological_fusion_accepted": False,
        "limitations": ["No target geometry or pose estimated from evaluated depth.",
            "Residuals include calibration, target-reference and correspondence error; not sensor noise alone.",
            "Pixel residuals may be correlated; no standard error or independent sample claim.",
            "Tolerance decisions are diagnostic only; physical target identity and annotation protocol require independent review."]}


if __name__ == "__main__":
    import argparse
    import os
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory")
    parser.add_argument("annotations", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-rear-lidar", action="store_true")
    args = parser.parse_args()
    report = assess_capture_targets(args.capture_directory, json.loads(args.annotations.read_text()), allow_rear_lidar=args.allow_rear_lidar)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write("\n")
