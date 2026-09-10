"""Observed visible motion in a measured head frame, without gap filling."""
from dataclasses import dataclass
import numpy as np
from .depth import DepthFrame, reconstruct
from .lips import joint_lip_measurement


@dataclass(frozen=True)
class MotionFrame:
    frame_id: str
    depth_frame: DepthFrame
    world_from_head: np.ndarray | None
    head_pose_evidence_id: str | None
    landmarks: dict
    head_pose_rigid_reference_ids: tuple[str, ...] = ()


def _identifier(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty string")


def _rigid(value):
    t = np.asarray(value, float)
    if (t.shape != (4, 4) or not np.isfinite(t).all()
            or not np.allclose(t[3], [0, 0, 0, 1], atol=1e-9, rtol=0)
            or not np.allclose(t[:3, :3].T @ t[:3, :3], np.eye(3), atol=1e-7, rtol=0)
            or not np.isclose(np.linalg.det(t[:3, :3]), 1, atol=1e-7, rtol=0)):
        raise ValueError("world_from_head must be a measured proper rigid transform in meters")
    return t


def analyze_motion(frames, *, attempt_id, cue_id, cue_version, context_id, context,
                   split, expected_correspondence, outcome="unknown", max_gap_seconds=.1,
                   lip_correspondence_id=None, lip_model_sigma_m=None):
    """Reconstruct trajectories conditional on measured calibration/head poses.

    Each landmark supplies pixel_uv and correspondence_id. Expected correspondence
    is predeclared, not learned from proximity. Head transform refers to the depth
    timestamp and uses the same world frame as DepthFrame.world_from_camera.
    """
    for name, value in (("attempt_id", attempt_id), ("cue_id", cue_id),
                        ("cue_version", cue_version), ("context_id", context_id)):
        _identifier(value, name)
    if split not in ("calibration", "held_out") or outcome not in ("completed", "unsuccessful", "unknown"):
        raise ValueError("explicit valid split and outcome are required")
    if not isinstance(context, dict) or not isinstance(expected_correspondence, dict) or not expected_correspondence:
        raise ValueError("context and nonempty expected_correspondence must be dictionaries")
    for name, identifier in expected_correspondence.items():
        _identifier(name, "landmark name"); _identifier(identifier, "correspondence_id")
    if not np.isfinite(max_gap_seconds) or max_gap_seconds <= 0:
        raise ValueError("max_gap_seconds must be positive")
    if lip_correspondence_id is not None:
        _identifier(lip_correspondence_id, "lip_correspondence_id")
        if not {"upper_lip", "lower_lip"} <= expected_correspondence.keys():
            raise ValueError("lip fusion requires declared upper_lip and lower_lip landmarks")
        if lip_model_sigma_m is None or not np.isfinite(lip_model_sigma_m) or lip_model_sigma_m <= 0:
            raise ValueError("lip_model_sigma_m must be positive")
    elif lip_model_sigma_m is not None:
        raise ValueError("lip sigma requires a declared lip correspondence")
    frames = list(frames)
    if not frames:
        raise ValueError("an attempt requires at least one captured frame")
    output = []
    seen = set()
    seen_depth = set()
    timebase = None
    previous = None
    for frame in frames:
        _identifier(frame.frame_id, "frame_id")
        if frame.frame_id in seen:
            raise ValueError("duplicate frame_id")
        seen.add(frame.frame_id)
        surface = reconstruct(frame.depth_frame)
        if surface.evidence_id in seen_depth:
            raise ValueError("repeated depth evidence cannot count as a fresh motion frame")
        seen_depth.add(surface.evidence_id)
        if timebase is None:
            timebase = surface.timebase_id
        if surface.timebase_id != timebase:
            raise ValueError("an attempt must use one mapped session timebase")
        if previous is not None and surface.timestamp_seconds <= previous:
            raise ValueError("frame timestamps must be strictly increasing")
        gap = previous is not None and surface.timestamp_seconds - previous > max_gap_seconds
        previous = surface.timestamp_seconds
        if not isinstance(frame.landmarks, dict):
            raise ValueError("landmarks must be a dictionary")
        transform = None
        if frame.world_from_head is not None:
            transform = _rigid(frame.world_from_head)
            _identifier(frame.head_pose_evidence_id, "head_pose_evidence_id")
            if not frame.head_pose_rigid_reference_ids:
                raise ValueError("head pose requires declared rigid references independent of moving landmarks")
            for reference in frame.head_pose_rigid_reference_ids:
                _identifier(reference, "head pose rigid reference")
                if reference in expected_correspondence:
                    raise ValueError("moving landmarks cannot be head pose references")
        row = {"id": frame.frame_id, "timestamp_seconds": surface.timestamp_seconds,
               "timebase_id": timebase, "sync_uncertainty_seconds": surface.sync_uncertainty_seconds,
               "evidence_id": surface.evidence_id, "head_pose_evidence_id": frame.head_pose_evidence_id,
               "head_pose_rigid_reference_ids": list(frame.head_pose_rigid_reference_ids),
               "head_pose_uncertainty": "not_quantified; coordinate covariance is conditional on pose",
               "gap_before": gap, "landmarks": {}, "depth_rejection_reasons": surface.rejection_reasons}
        for name, expected in expected_correspondence.items():
            landmark = frame.landmarks.get(name)
            reason = None
            index = None
            if landmark is None:
                reason = "landmark_not_visible"
            elif not isinstance(landmark, dict) or landmark.get("correspondence_id") != expected:
                reason = "inconsistent_correspondence"
            else:
                pixel = np.asarray(landmark.get("pixel_uv"))
                if pixel.shape != (2,) or not np.issubdtype(pixel.dtype, np.number) or not np.isfinite(pixel).all() or not np.equal(pixel, np.floor(pixel)).all():
                    raise ValueError("landmark pixel_uv must contain two integer pixel centers")
                match = np.flatnonzero(np.all(surface.pixels_uv == pixel, axis=1))
                if not len(match):
                    reason = "no_valid_measured_depth"
                elif transform is None:
                    reason = "missing_measured_head_pose"
                else:
                    index = int(match[0])
            if reason:
                row["landmarks"][name] = {"visibility": "missing", "reason": reason,
                                           "correspondence_id": expected}
            else:
                rotation = transform[:3, :3]
                point = rotation.T @ (surface.points_m[index] - transform[:3, 3])
                covariance = rotation.T @ surface.covariance_m2[index] @ rotation
                row["landmarks"][name] = {"visibility": "visible", "correspondence_id": expected,
                    "pixel_uv": surface.pixels_uv[index].tolist(), "position_head_m": point.tolist(),
                    "covariance_head_m2": covariance.tolist()}
        row["visibility"] = "visible" if any(x["visibility"] == "visible" for x in row["landmarks"].values()) else "missing"
        if lip_correspondence_id is not None:
            lip_valid = all(row["landmarks"][n]["visibility"] == "visible" for n in ("upper_lip", "lower_lip"))
            row["geometry_status"] = "visible" if lip_valid else "missing"
            if lip_valid:
                row["geometry_observation"] = joint_lip_measurement(surface,
                    frame.landmarks["upper_lip"]["pixel_uv"], frame.landmarks["lower_lip"]["pixel_uv"],
                    trial_id=frame.frame_id, split=split, correspondence_id=lip_correspondence_id,
                    model_sigma_m=lip_model_sigma_m)
            else:
                row["geometry_reason"] = "lip_correspondence_depth_or_head_pose_unavailable"
        else:
            row["geometry_status"] = "missing"
            row["geometry_reason"] = "lip_operator_not_configured"
        output.append(row)
    summaries = {}
    for name in expected_correspondence:
        segments = []
        current = []
        for row in output:
            landmark = row["landmarks"][name]
            if row["gap_before"] or landmark["visibility"] != "visible":
                if current:
                    segments.append(current)
                current = []
            if landmark["visibility"] == "visible":
                current.append(row)
        if current:
            segments.append(current)
        metrics = []
        for segment in segments:
            points = np.array([r["landmarks"][name]["position_head_m"] for r in segment])
            excursion = None
            if len(points) > 1:
                excursion = max(float(np.linalg.norm(points - p, axis=1).max()) for p in points)
            metrics.append({"frame_ids": [r["id"] for r in segment], "observed_excursion_m": excursion})
        complete = len(segments) == 1 and len(segments[0]) == len(output) and len(output) > 1
        summaries[name] = {"segments": metrics,
            "observed_excursion_m": metrics[0]["observed_excursion_m"] if complete else None,
            "status": "continuous_observation" if complete else "incomplete_or_gapped_observation",
            "anatomical_maximum_estimated": False}
    return {"schema_version": "0.1.0", "attempt_id": attempt_id, "cue_id": cue_id,
            "cue_version": cue_version, "context_id": context_id, "context": dict(context),
            "split": split, "outcome": outcome, "frames": output, "landmark_summaries": summaries,
            "coordinate_frame": "measured_head_local_meters",
            "uncertainty_scope": "independent depth/pixel noise conditional on exact calibration and measured head pose; no interpolation"}


def repeat_variability(attempts, landmark):
    """Between-attempt SD of continuously observed excursions for one cue/context.

    Unsuccessful attempts stay in the record and are counted separately. Their
    measured motion is still observed evidence, not a physiological restriction.
    """
    attempts = list(attempts)
    if not attempts:
        raise ValueError("at least one attempt is required")
    keys = ("cue_id", "cue_version", "context_id", "context")
    if any(any(a[k] != attempts[0][k] for k in keys) for a in attempts):
        raise ValueError("repeat variability requires matching cue and context")
    ids = [a["attempt_id"] for a in attempts]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate attempt_id")
    values, excluded = [], []
    for attempt in attempts:
        summary = attempt["landmark_summaries"].get(landmark)
        if summary is None or summary["observed_excursion_m"] is None:
            excluded.append(attempt["attempt_id"])
        else:
            values.append(summary["observed_excursion_m"])
    return {"landmark": landmark, "attempt_ids": ids, "observed_excursions_m": values,
            "excluded_incomplete_attempt_ids": excluded,
            "sample_sd_m": float(np.std(values, ddof=1)) if len(values) > 1 else None,
            "unsuccessful_attempt_ids": [a["attempt_id"] for a in attempts if a["outcome"] == "unsuccessful"],
            "interpretation": "observed repeat variability, not anatomical limits or latent motor variance"}
