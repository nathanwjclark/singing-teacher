"""Time-indexed conditional reconstruction without rigid motion fusion."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json

from .engine import Engine, finite
from .joint import KIND as JOINT_KIND, fit_joint

KIND = "dynamic_synthetic_transfer_unknown_articulation"


def _identifier(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty identifier")
    return value


def fit_dynamic(engine: Engine, document, *, budget_per_model=120, starts=3, seed=1,
                anatomy_bounds=None, articulation_bounds=None):
    """Reconstruct shared anatomy and independent frame states, retaining gaps.

    Audio is required for every calibration frame even when geometry is missing.
    Cue labels supply grouping/context only, never commanded articulation. No
    temporal smoothing, surface averaging, interpolation or maximum-limit inference
    is performed. Held-out values do not enter the underlying joint fitter.
    """
    doc = deepcopy(document)
    if not isinstance(doc, dict) or doc.get("schema_version") != "0.1.0" or doc.get("kind") != KIND:
        raise ValueError("Expected versioned dynamic synthetic transfer observations")
    gap_threshold = finite(doc.get("max_gap_seconds", .1), "max_gap_seconds")
    if gap_threshold <= 0:
        raise ValueError("max_gap_seconds must be positive")
    attempts = doc.get("attempts")
    if not isinstance(attempts, list) or not attempts or len(attempts) > 30:
        raise ValueError("Supply 1-30 attempts")
    seen_attempts, seen_frames, seen_audio = set(), set(), set()
    contexts = {}
    held_out_geometry_ids = set()
    rows, geometry, groups, excluded_geometry = [], [], [], []
    for attempt in attempts:
        if not isinstance(attempt, dict):
            raise ValueError("Attempt must be a mapping")
        identity = {k: _identifier(attempt.get(k), k) for k in
                    ("attempt_id", "cue_id", "cue_version", "context_id")}
        if identity["attempt_id"] in seen_attempts:
            raise ValueError("Duplicate attempt id")
        seen_attempts.add(identity["attempt_id"])
        split = attempt.get("split")
        if split not in ("calibration", "held_out"):
            raise ValueError("Attempt requires explicit split")
        context = attempt.get("context")
        if not isinstance(context, dict) or not context:
            raise ValueError("Attempt requires nonempty context")
        try:
            encoded_context = json.dumps(context, sort_keys=True, allow_nan=False)
        except (ValueError, TypeError) as exc:
            raise ValueError("Context must contain finite JSON data") from exc
        context_id = identity["context_id"]
        if context_id in contexts and contexts[context_id] != encoded_context:
            raise ValueError("Context id refers to inconsistent context")
        contexts[context_id] = encoded_context
        capture_outcome = attempt.get("outcome", "unknown")
        if capture_outcome not in ("completed", "unsuccessful", "unknown"):
            raise ValueError("Invalid captured attempt outcome")
        execution = attempt.get("execution_status", "unsuccessful" if capture_outcome == "unsuccessful" else "unknown")
        mode = attempt.get("mode", "elicited")
        if execution not in ("successful", "unsuccessful", "unknown") or mode not in ("elicited", "recalled", "transfer"):
            raise ValueError("Invalid attempt execution status or mode")
        cue_time = finite(attempt.get("cue_delivered_seconds"), "cue_delivered_seconds")
        frames = attempt.get("frames")
        if not isinstance(frames, list) or not frames:
            raise ValueError("Attempt must contain frames")
        metadata, previous, timebase, segment = [], None, None, 0
        for frame in frames:
            if not isinstance(frame, dict):
                raise ValueError("Frame must be a mapping")
            frame_id = _identifier(frame.get("id"), "frame id")
            if frame_id in seen_frames:
                raise ValueError("Duplicate dynamic frame id")
            seen_frames.add(frame_id)
            for key, expected in identity.items():
                if key in frame and frame[key] != expected:
                    raise ValueError(f"Frame {key} does not match attempt")
            timestamp = finite(frame.get("timestamp_seconds"), "frame timestamp")
            frame_timebase = _identifier(frame.get("timebase_id"), "frame timebase")
            sync = finite(frame.get("sync_uncertainty_seconds"), "frame synchronization bound")
            if sync < 0:
                raise ValueError("Frame synchronization bound cannot be negative")
            if timebase is not None and timebase != frame_timebase:
                raise ValueError("An attempt must use one declared timebase")
            timebase = frame_timebase
            if previous is not None and timestamp <= previous:
                raise ValueError("Frame timestamps must strictly increase within each attempt")
            interval = None if previous is None else timestamp-previous
            gap = interval is not None and interval > gap_threshold
            if gap:
                segment += 1
            previous = timestamp
            state = {"id": frame_id, "timestamp_seconds": timestamp, "timebase_id": timebase,
                     "sync_uncertainty_seconds": sync, "interval_seconds": interval,
                     "gap_before": gap, "segment": segment}
            audio_id = _identifier(frame.get("audio_evidence_id"), "audio_evidence_id")
            audio_identity = (audio_id, timebase, timestamp)
            if audio_identity in seen_audio:
                raise ValueError("Duplicate physical audio frame")
            seen_audio.add(audio_identity)
            if split == "held_out":
                if frame.get("evidence_id") is not None:
                    held_out_geometry_ids.add(_identifier(frame["evidence_id"], "held-out depth evidence id"))
                rows.append({"id": frame_id, "split": "held_out"})
                metadata.append({**state, "audio_evidence_id": audio_id,
                                 "geometry_status": "held_out", "geometry_reason": "held_out_not_read"})
                continue
            row = {"id": frame_id, "split": split, "audio_evidence_id": audio_id, "pose": frame.get("pose"),
                   "frequency_hz": frame.get("frequency_hz"), "magnitude_db": frame.get("magnitude_db"),
                   "timestamp_seconds": timestamp, "timebase_id": timebase, "sync_uncertainty_seconds": sync}
            rows.append(row)
            visibility = frame.get("visibility")
            status = frame.get("geometry_status", visibility)
            if visibility not in ("visible", "occluded", "missing") or status not in ("visible", "occluded", "missing"):
                raise ValueError("Explicit frame visibility and geometry status are required")
            if status == "visible":
                if visibility != "visible":
                    raise ValueError("Visible geometry conflicts with frame visibility")
                measurement = frame.get("geometry_observation")
                if not isinstance(measurement, dict) or measurement.get("kind") != "visible_lip_distance":
                    raise ValueError("Visible geometry requires a calibrated lip observation")
                if measurement.get("trial_id") != frame_id or measurement.get("split") != split:
                    raise ValueError("Geometry trial/split does not match frame")
                geometry.append(measurement)
                reason = None
            else:
                reason = _identifier(frame.get("geometry_reason"), "geometry_reason")
                excluded_geometry.append({"frame_id": frame_id, "attempt_id": identity["attempt_id"],
                                          "status": status, "reason": reason, "audio_retained": True})
            metadata.append({**state, "audio_evidence_id": audio_id, "pose": frame.get("pose"),
                             "visibility": visibility, "geometry_status": status, "geometry_reason": reason,
                             "measurement": measurement if status == "visible" else None,
                             "observed_landmarks": deepcopy(frame.get("landmarks", {})),
                             "head_pose_evidence_id": frame.get("head_pose_evidence_id"),
                             "head_pose_uncertainty": frame.get("head_pose_uncertainty")})
        if cue_time > metadata[-1]["timestamp_seconds"]:
            raise ValueError("Cue delivery cannot follow all attempt frames")
        onset = attempt.get("actual_onset_seconds")
        if onset is not None:
            onset = finite(onset, "actual_onset_seconds")
            if not metadata[0]["timestamp_seconds"] <= onset <= metadata[-1]["timestamp_seconds"]:
                raise ValueError("Actual onset must lie inside the observed attempt")
        groups.append({**identity, "context": context, "split": split, "mode": mode,
                       "execution_status": execution, "capture_outcome": capture_outcome,
                       "coordinate_frame": attempt.get("coordinate_frame"),
                       "cue_delivered_seconds": cue_time,
                       "actual_onset_seconds": onset, "frames": metadata})
    if len(rows) > 30:
        raise ValueError("Current joint profile supports at most 30 frames")
    if any(isinstance(g.get("evidence_id"), str) and g["evidence_id"] in held_out_geometry_ids for g in geometry):
        raise ValueError("Calibration geometry reuses held-out depth evidence")
    joint_document = {"schema_version": "0.1.0", "kind": JOINT_KIND,
        "sample_rate_hz": doc.get("sample_rate_hz"), "spectrum_bins": doc.get("spectrum_bins"),
        "provenance": doc.get("provenance"), "spectral_sigma_db": doc.get("spectral_sigma_db", 1.),
        "observations": rows, "geometry_observations": geometry}
    result = fit_joint(engine, joint_document, anatomy_bounds=anatomy_bounds,
        articulation_bounds=articulation_bounds, budget_per_model=budget_per_model, starts=starts, seed=seed)
    best = result["joint"]["best"]
    model_id = hashlib.sha256(json.dumps({"fit": best, "calibration_sha256": result["calibration_sha256"],
        "provenance": result["provenance"]}, sort_keys=True, allow_nan=False).encode()).hexdigest()
    predictions = {p["trial_id"]: p for p in best["geometry_predictions"]}
    for attempt in groups:
        for frame in attempt["frames"]:
            if attempt["split"] == "held_out":
                frame["state"] = None
                continue
            frame["state"] = {"source_kind": "inferred_articulation", "reconstruction_only": True,
                "derived_model_id": model_id, "requested_articulation": best["trial_articulation"][frame["id"]],
                "native_controls": best["trial_controls"][frame["id"]],
                "measurement_sigma_deg": None,
                "uncertainty_scope": "uncalibrated_conditional_on_model_and_observations"}
            frame["predicted_visible_geometry"] = predictions.get(frame["id"])
            frame["measurement_label"] = "observed_visible_distance" if frame["measurement"] is not None else "unobserved_geometry"
    return {"schema_version": "0.1.0", "kind": "dynamic_conditional_reconstruction", "model_id": model_id,
        "shared_anatomy": best["anatomy"], "anatomy_label": "hypothesis_not_direct_measurement",
        "attempts": groups, "excluded_geometry": excluded_geometry, "joint_fit": result,
        "max_gap_seconds": gap_threshold, "temporal_model": "independent_states_no_interpolation_or_smoothing",
        "physiological_limits_established": False, "prospective_prediction": False,
        "evidence": "synthetic_direct_transfer_with_explicit_visible_geometry"}
