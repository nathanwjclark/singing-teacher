"""Metric geometry with explicit capture coordinates and conditional uncertainty."""
from dataclasses import dataclass
import numpy as np


def _finite(value, name, positive=False):
    if not np.isfinite(value) or (positive and value <= 0):
        raise ValueError(f"{name} must be finite" + (" and positive" if positive else ""))


@dataclass(frozen=True)
class DepthFrame:
    """Rectified depth at integer pixel centers in +x right,+y down,+z forward.

    K belongs to THIS depth array, not the source RGB resolution. world_from_camera
    uses meters and the stated camera convention. Clock mapping is
    session_seconds = source_seconds * clock_scale + clock_offset_seconds.
    """
    evidence_id: str
    timebase_id: str
    timestamp_seconds: float
    depth: np.ndarray | None
    intrinsics: np.ndarray
    world_from_camera: np.ndarray
    units: str
    rectified: bool
    depth_sigma_m: float
    pixel_sigma: float
    sync_uncertainty_seconds: float
    confidence: np.ndarray | None = None
    visible_mask: np.ndarray | None = None
    measured_mask: np.ndarray | None = None
    missing_reason: str | None = None
    representation: str = "axial_depth"
    clock_scale: float = 1.0
    clock_offset_seconds: float = 0.0


@dataclass(frozen=True)
class SurfaceObservation:
    evidence_id: str
    timebase_id: str
    timestamp_seconds: float
    sync_uncertainty_seconds: float
    points_m: np.ndarray
    covariance_m2: np.ndarray
    pixels_uv: np.ndarray
    valid_mask: np.ndarray
    rejection_reasons: dict
    uncertainty_scope: str = "independent depth/pixel noise conditional on exact calibration and pose"


def reconstruct(frame: DepthFrame, *, reference_seconds=None, max_alignment_seconds=0.02,
                min_confidence=0.5, depth_range_m=(0.02, 5.0)) -> SurfaceObservation:
    """Unproject measured visible samples, keeping holes rather than filling them.

    Confidence is a normalized adapter-provided quality score, NOT a probability.
    Sync uncertainty is an absolute error bound, NOT a standard deviation.
    Missing/unsynchronized frames return empty observations with explicit reasons;
    malformed calibration/metadata raises ValueError.
    """
    if not frame.evidence_id or not frame.timebase_id:
        raise ValueError("evidence_id and timebase_id are required")
    for name in ("timestamp_seconds", "clock_offset_seconds", "sync_uncertainty_seconds"):
        _finite(getattr(frame, name), name)
    for name in ("clock_scale", "depth_sigma_m", "pixel_sigma"):
        _finite(getattr(frame, name), name, positive=True)
    if frame.sync_uncertainty_seconds < 0:
        raise ValueError("sync uncertainty cannot be negative")
    _finite(max_alignment_seconds, "max_alignment_seconds", positive=True)
    if not np.isfinite(min_confidence) or not 0 <= min_confidence <= 1:
        raise ValueError("min_confidence must lie in [0, 1]")
    lo, hi = depth_range_m
    if not np.isfinite([lo, hi]).all() or not 0 < lo < hi:
        raise ValueError("depth_range_m must be positive increasing bounds")
    k = np.asarray(frame.intrinsics, dtype=float)
    t = np.asarray(frame.world_from_camera, dtype=float)
    if (k.shape != (3, 3) or not np.isfinite(k).all() or k[0, 0] <= 0 or k[1, 1] <= 0
            or not np.allclose(k[2], [0, 0, 1]) or abs(k[1, 0]) > 1e-12):
        raise ValueError("invalid pinhole intrinsics")
    if (t.shape != (4, 4) or not np.isfinite(t).all() or not np.allclose(t[3], [0, 0, 0, 1])
            or not np.allclose(t[:3, :3].T @ t[:3, :3], np.eye(3), atol=1e-7)
            or not np.isclose(np.linalg.det(t[:3, :3]), 1, atol=1e-7)):
        raise ValueError("world_from_camera must be a proper rigid transform in meters")
    if frame.units not in ("m", "mm") or frame.representation != "axial_depth":
        raise ValueError("convert disparity/range to axial depth with units m or mm first")
    if frame.rectified is not True:
        raise ValueError("depth must be rectified with its matching intrinsics")
    timestamp = frame.timestamp_seconds * frame.clock_scale + frame.clock_offset_seconds
    if not np.isfinite(timestamp):
        raise ValueError("mapped timestamp is not finite")
    empty = lambda shape, reason: SurfaceObservation(
        frame.evidence_id, frame.timebase_id, timestamp, frame.sync_uncertainty_seconds,
        np.empty((0, 3)), np.empty((0, 3, 3)), np.empty((0, 2), dtype=int),
        np.zeros(shape, dtype=bool), reason)
    if frame.depth is None:
        if not frame.missing_reason:
            raise ValueError("missing depth requires missing_reason")
        return empty((0, 0), {"missing_depth": frame.missing_reason})
    if frame.missing_reason is not None:
        raise ValueError("present depth cannot carry missing_reason")
    z = np.asarray(frame.depth, dtype=float)
    if z.ndim != 2 or 0 in z.shape:
        raise ValueError("depth must be a nonempty 2-D array")
    z = z * (0.001 if frame.units == "mm" else 1)
    if reference_seconds is not None:
        _finite(reference_seconds, "reference_seconds")
        if abs(timestamp - reference_seconds) + frame.sync_uncertainty_seconds > max_alignment_seconds:
            return empty(z.shape, {"unsynchronized_frame": int(z.size)})
    elif frame.sync_uncertainty_seconds > max_alignment_seconds:
        return empty(z.shape, {"excessive_sync_uncertainty": int(z.size)})
    masks = {"invalid_depth": ~np.isfinite(z) | (z <= 0),
             "outside_depth_range": np.isfinite(z) & (z > 0) & ((z < lo) | (z > hi))}
    if frame.confidence is not None:
        c = np.asarray(frame.confidence, dtype=float)
        if c.shape != z.shape or not np.isfinite(c).all() or np.any((c < 0) | (c > 1)):
            raise ValueError("confidence must match depth and contain finite scores in [0, 1]")
        masks["low_confidence"] = c < min_confidence
    for field, reason in (("visible_mask", "outside_visible_region"), ("measured_mask", "unmeasured_or_filled")):
        value = getattr(frame, field)
        if value is not None:
            value = np.asarray(value)
            if value.shape != z.shape or value.dtype != np.bool_:
                raise ValueError(f"{field} must be a boolean array matching depth")
            masks[reason] = ~value
    valid = ~np.logical_or.reduce(list(masks.values()))
    v, u = np.nonzero(valid)
    pixels = np.column_stack((u, v))
    inv_k = np.linalg.inv(k)
    rays = np.column_stack((u, v, np.ones(len(u)))) @ inv_k.T
    depth = z[valid]
    camera_points = rays * depth[:, None]
    rotation = t[:3, :3]
    points = camera_points @ rotation.T + t[:3, 3]
    # Jacobian columns are derivatives with respect to u, v and axial depth z.
    jac = np.empty((len(u), 3, 3))
    jac[:, :, 0] = depth[:, None] * inv_k[:, 0]
    jac[:, :, 1] = depth[:, None] * inv_k[:, 1]
    jac[:, :, 2] = rays
    jac = np.einsum("ij,njk->nik", rotation, jac)
    variances = np.array([frame.pixel_sigma**2, frame.pixel_sigma**2, frame.depth_sigma_m**2])
    covariance = (jac * variances) @ np.swapaxes(jac, 1, 2)
    return SurfaceObservation(frame.evidence_id, frame.timebase_id, timestamp,
                              frame.sync_uncertainty_seconds, points, covariance, pixels,
                              valid, {key: int(mask.sum()) for key, mask in masks.items()})


def surface_distance(observation: SurfaceObservation, first_uv, second_uv):
    """Euclidean endpoint distance; endpoints must both be measured, distinct pixels."""
    indices = []
    for pixel in (first_uv, second_uv):
        p = np.asarray(pixel)
        if p.shape != (2,) or not np.isfinite(p).all() or not np.equal(p, np.floor(p)).all():
            raise ValueError("endpoints must be integer depth pixel centers")
        matches = np.flatnonzero(np.all(observation.pixels_uv == p, axis=1))
        if len(matches) != 1:
            raise ValueError("endpoint has no valid visible depth measurement")
        indices.append(int(matches[0]))
    a, b = indices
    delta = observation.points_m[b] - observation.points_m[a]
    distance = float(np.linalg.norm(delta))
    if a == b or distance == 0:
        raise ValueError("distance requires distinct noncoincident endpoints")
    direction = delta / distance
    variance = float(direction @ (observation.covariance_m2[a] + observation.covariance_m2[b]) @ direction)
    return {"kind": "visible_endpoint_distance", "value_m": distance, "sigma_m": variance**0.5,
            "evidence_id": observation.evidence_id, "timebase_id": observation.timebase_id,
            "timestamp_seconds": observation.timestamp_seconds,
            "sync_uncertainty_seconds": observation.sync_uncertainty_seconds,
            "pixels_uv": [list(map(int, first_uv)), list(map(int, second_uv))],
            "uncertainty_scope": observation.uncertainty_scope}


def surface_residuals(observation: SurfaceObservation, predicted_points_m, *, operator_id: str,
                      model_sigma_m: float):
    """Whiten residuals for an externally declared visible-surface observation operator.

    Prediction order MUST match pixels_uv; operator registration/correspondence is
    caller-owned. Never performs nearest-neighbor registration or hidden anatomy mapping.
    """
    if not operator_id or not isinstance(operator_id, str):
        raise ValueError("a predeclared operator_id is required")
    _finite(model_sigma_m, "model_sigma_m", positive=True)
    predicted = np.asarray(predicted_points_m, dtype=float)
    if predicted.shape != observation.points_m.shape or not np.isfinite(predicted).all():
        raise ValueError("predictions must be finite corresponding world points with matching shape")
    covariance = observation.covariance_m2 + np.eye(3) * model_sigma_m**2
    cholesky = np.linalg.cholesky(covariance)
    residuals = np.linalg.solve(cholesky, (predicted - observation.points_m)[..., None])[..., 0]
    return {"operator_id": operator_id, "evidence_id": observation.evidence_id,
            "timebase_id": observation.timebase_id, "timestamp_seconds": observation.timestamp_seconds,
            "sync_uncertainty_seconds": observation.sync_uncertainty_seconds,
            "residuals": residuals.reshape(-1), "point_count": len(predicted)}
