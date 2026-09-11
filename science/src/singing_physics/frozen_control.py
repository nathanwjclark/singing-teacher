"""Single-vowel articulation reconstruction against an immutable physical snapshot."""
from copy import deepcopy
import math

import numpy as np
from scipy.optimize import minimize_scalar

from .engine import ANATOMY, Engine, finite
from .joint import ALIGNMENT_TOLERANCE_SECONDS, LIP_OPERATOR, observed_landmarks
from .prediction import Artifact, _encode, _identity, _timestamp, freeze_candidates

KIND = "frozen_anatomy_dynamic_transfer"


def _snapshot(engine, snapshot, expected_digest, candidate_id):
    if not isinstance(snapshot, Artifact) or snapshot.sha256 != expected_digest:
        raise ValueError("Frozen snapshot digest mismatch")
    data = snapshot.data
    if not isinstance(data, dict) or data.get("schema_version") != "0.1.0" or data.get("kind") != "frozen_anatomy_candidates":
        raise ValueError("Expected frozen anatomy candidates")
    # Reuse the existing artifact's complete identity/time/lineage validation.
    canonical = freeze_candidates(**{key: data.get(key) for key in
        ("model_id", "evidence_ids", "provenance", "candidates", "frozen_at")})
    if canonical.content != snapshot.content:
        raise ValueError("Frozen snapshot is not its canonical validated representation")
    if data["provenance"] != engine.provenance:
        raise ValueError("Frozen snapshot native provenance mismatch")
    candidates = [c for c in data["candidates"] if c["candidate_id"] == candidate_id]
    if len(candidates) != 1:
        raise ValueError("Unknown frozen candidate id")
    anatomy = candidates[0]["anatomy"]
    if set(anatomy) != {a[0] for a in ANATOMY}:
        raise ValueError("Frozen control requires all native anatomy parameters explicitly")
    for name, _, lower, upper in ANATOMY:
        if not lower <= finite(anatomy[name], name) <= upper:
            raise ValueError(f"Frozen anatomy {name} exceeds native bounds")
    minimum_pharynx = sum(anatomy[k] for k in
        ("palate_height", "upper_molars_height", "lower_molars_height", "mandible_height"))
    if anatomy["pharynx_length"] < minimum_pharynx:
        raise ValueError("Frozen anatomy violates mouth/jaw height constraint")
    return data, anatomy


def _lip(measurement, row):
    if not isinstance(measurement, dict) or measurement.get("kind") != "visible_lip_distance" or measurement.get("operator_id") != LIP_OPERATOR:
        raise ValueError("Expected declared native visible-lip operator")
    if measurement.get("trial_id") != row["id"] or measurement.get("split") != "calibration":
        raise ValueError("Geometry trial or split mismatch")
    for key in ("evidence_id", "timebase_id", "correspondence_id", "uncertainty_scope"):
        _identity(measurement.get(key), key)
    if measurement["timebase_id"] != row["timebase_id"]:
        raise ValueError("Geometry timebase mismatch")
    t = finite(measurement.get("timestamp_seconds"), "geometry timestamp")
    bound = finite(measurement.get("sync_uncertainty_seconds"), "geometry synchronization bound")
    if bound < 0 or abs(t-row["timestamp_seconds"])+bound+row["sync_uncertainty_seconds"] > ALIGNMENT_TOLERANCE_SECONDS:
        raise ValueError("Geometry exceeds experimental alignment tolerance")
    for key in ("value_m", "sigma_m", "model_sigma_m"):
        if finite(measurement.get(key), key) <= 0:
            raise ValueError(f"{key} must be positive")
    if not math.isfinite(math.hypot(measurement["sigma_m"], measurement["model_sigma_m"])):
        raise ValueError("Combined geometry uncertainty is nonfinite")
    try:
        pixels = np.asarray(measurement.get("pixels_uv"), float)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid geometry pixels") from exc
    if pixels.shape != (2, 2) or not np.isfinite(pixels).all() or np.any(pixels < 0) or np.array_equal(pixels[0], pixels[1]):
        raise ValueError("Invalid geometry pixels")
    return measurement


def fit_frozen_control(engine: Engine, snapshot: Artifact, document, *, expected_digest,
                       candidate_id, budget=240, seed=1):
    """Fit JA only, with a hard total forward-call budget and no anatomy updates.

    Every attempt is declared captured strictly after the frozen snapshot. All
    capture identities must be absent from snapshot training lineage. Held-out
    numeric values remain unread. This is conditional reconstruction, not forecast.
    """
    if type(budget) is not int or not 5 <= budget <= 10000 or type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("Invalid integer compute budget or seed")
    frozen, anatomy = _snapshot(engine, snapshot, expected_digest, candidate_id)
    doc = deepcopy(document)
    if not isinstance(doc, dict) or doc.get("schema_version") != "0.1.0" or doc.get("kind") != KIND:
        raise ValueError("Expected frozen-anatomy dynamic transfer profile")
    if doc.get("provenance") != engine.provenance or doc.get("sample_rate_hz") != engine.sample_rate or doc.get("spectrum_bins") != 512:
        raise ValueError("Capture spectral profile or provenance mismatch")
    sigma_db = finite(doc.get("spectral_sigma_db", 1.), "spectral_sigma_db")
    gap_threshold = finite(doc.get("max_gap_seconds", .1), "max_gap_seconds")
    if sigma_db <= 0 or gap_threshold <= 0:
        raise ValueError("Spectral sigma and gap threshold must be positive")
    attempts = doc.get("attempts")
    if not isinstance(attempts, list) or not 1 <= len(attempts) <= 30:
        raise ValueError("Supply 1-30 attempts")
    frozen_ids = set(frozen["evidence_ids"])
    held_ids, calibration_ids, seen_frames, seen_attempts = set(), set(), set(), set()
    seen_audio, seen_depth, contexts = set(), set(), {}
    fitted_frames, output_attempts = [], []
    frequency = np.arange(257)*engine.sample_rate/512
    mask = (frequency >= 100) & (frequency <= 6000)
    frozen_at = _timestamp(frozen["frozen_at"])
    for attempt in attempts:
        if not isinstance(attempt, dict):
            raise ValueError("Attempt must be a mapping")
        metadata = {key: _identity(attempt.get(key), key) for key in
                    ("attempt_id", "cue_id", "cue_version", "context_id")}
        if metadata["attempt_id"] in seen_attempts:
            raise ValueError("Duplicate attempt id")
        seen_attempts.add(metadata["attempt_id"])
        observed_at = _timestamp(attempt.get("observed_at"))
        if observed_at <= frozen_at:
            raise ValueError("Attempt must be observed strictly after anatomy freeze")
        context = attempt.get("context")
        if not isinstance(context, dict) or not context:
            raise ValueError("Attempt context required")
        encoded_context = _encode(context)
        if metadata["context_id"] in contexts and contexts[metadata["context_id"]] != encoded_context:
            raise ValueError("Conflicting context identity")
        contexts[metadata["context_id"]] = encoded_context
        split = attempt.get("split")
        capture_outcome = attempt.get("outcome", "unknown")
        if capture_outcome not in ("completed", "unsuccessful", "unknown"):
            raise ValueError("Invalid capture outcome")
        execution = attempt.get("execution_status", "unsuccessful" if capture_outcome == "unsuccessful" else "unknown")
        mode = attempt.get("mode", "elicited")
        if split not in ("calibration", "held_out") or execution not in ("successful", "unsuccessful", "unknown") or mode not in ("elicited", "recalled", "transfer"):
            raise ValueError("Invalid attempt split, execution status or mode")
        cue_time = finite(attempt.get("cue_delivered_seconds"), "cue delivery")
        frames = attempt.get("frames")
        if not isinstance(frames, list) or not frames:
            raise ValueError("Attempt frames required")
        output = {**metadata, "context": context, "observed_at": attempt["observed_at"],
                  "split": split, "execution_status": execution, "capture_outcome": capture_outcome, "mode": mode,
                  "cue_delivered_seconds": cue_time, "frames": []}
        previous, timebase, segment = None, None, 0
        for frame in frames:
            if not isinstance(frame, dict):
                raise ValueError("Frame must be a mapping")
            frame_id = _identity(frame.get("id"), "frame id")
            if frame_id in seen_frames:
                raise ValueError("Duplicate frame id")
            seen_frames.add(frame_id)
            if len(seen_frames) > 30:
                raise ValueError("At most 30 frames are supported")
            for key, value in metadata.items():
                if key in frame and frame[key] != value:
                    raise ValueError("Frame attempt/cue/context identity mismatch")
            t = finite(frame.get("timestamp_seconds"), "frame timestamp")
            clock = _identity(frame.get("timebase_id"), "timebase_id")
            sync = finite(frame.get("sync_uncertainty_seconds"), "frame sync bound")
            if sync < 0 or (previous is not None and t <= previous) or (timebase is not None and clock != timebase):
                raise ValueError("Invalid frame ordering, timebase or synchronization bound")
            gap = previous is not None and t-previous > gap_threshold
            if gap:
                segment += 1
            previous, timebase = t, clock
            audio_id = _identity(frame.get("audio_evidence_id"), "audio_evidence_id")
            audio_key = (audio_id, clock, t)
            if audio_key in seen_audio:
                raise ValueError("Duplicate physical audio frame")
            seen_audio.add(audio_key)
            raw_geometry = frame.get("geometry_observation")
            nested_id = raw_geometry.get("evidence_id") if isinstance(raw_geometry, dict) else None
            top_id = frame.get("evidence_id")
            if top_id is not None:
                _identity(top_id, "depth evidence id")
            if nested_id is not None:
                _identity(nested_id, "nested depth evidence id")
            if top_id is not None and nested_id is not None and top_id != nested_id:
                raise ValueError("Conflicting depth evidence aliases")
            identities = {frame_id, audio_id, *(x for x in (top_id, nested_id) if x is not None)}
            if identities & frozen_ids:
                raise ValueError("Capture evidence overlaps frozen anatomy training lineage")
            (held_ids if split == "held_out" else calibration_ids).update(identities)
            row = {"id": frame_id, "audio_evidence_id": audio_id, "timestamp_seconds": t,
                   "timebase_id": clock, "sync_uncertainty_seconds": sync, "gap_before": gap,
                   "segment": segment, "state": None}
            output["frames"].append(row)
            if split == "held_out":
                row.update(geometry_status="held_out", geometry_reason="held_out_numeric_values_not_read")
                continue
            visibility = frame.get("visibility")
            status = frame.get("geometry_status", visibility)
            if visibility not in ("visible", "missing", "occluded") or status not in ("visible", "missing", "occluded"):
                raise ValueError("Explicit visibility and geometry status required")
            measurement = None
            if status == "visible":
                if visibility != "visible":
                    raise ValueError("Visible geometry conflicts with visibility")
                measurement = _lip(raw_geometry, row)
                depth_key = (measurement["evidence_id"], measurement["timebase_id"], measurement["timestamp_seconds"], measurement["operator_id"])
                if depth_key in seen_depth:
                    raise ValueError("Duplicate physical depth frame")
                seen_depth.add(depth_key)
                reason = None
            else:
                reason = _identity(frame.get("geometry_reason"), "geometry_reason")
            pose = frame.get("pose")
            if not isinstance(pose, str) or pose not in engine.poses:
                raise ValueError("Unknown calibration pose")
            try:
                hz, target = np.asarray(frame.get("frequency_hz"), float), np.asarray(frame.get("magnitude_db"), float)
            except (TypeError, ValueError) as exc:
                raise ValueError("Invalid spectral observation") from exc
            if hz.shape != frequency[mask].shape or target.shape != hz.shape or not np.array_equal(hz, frequency[mask]) or not np.isfinite(target).all():
                raise ValueError("Invalid spectral observation")
            row.update(pose=pose, visibility=visibility, geometry_status=status,
                       geometry_reason=reason, measured_visible_geometry=measurement,
                       observed_landmarks=observed_landmarks(frame))
            fitted_frames.append((row, target))
        if cue_time > output["frames"][-1]["timestamp_seconds"]:
            raise ValueError("Cue delivery follows captured attempt")
        onset = attempt.get("actual_onset_seconds")
        if onset is not None:
            onset = finite(onset, "actual onset")
            if not output["frames"][0]["timestamp_seconds"] <= onset <= previous:
                raise ValueError("Actual onset lies outside capture")
        output["actual_onset_seconds"] = onset
        output_attempts.append(output)
    if calibration_ids & held_ids:
        raise ValueError("Calibration and held-out capture evidence overlap")
    costs = [1 + int(row["measured_visible_geometry"] is not None) for row, _ in fitted_frames]
    if not fitted_frames or len(seen_frames) > 30 or budget < 5*sum(costs):
        raise ValueError("Require 1-30 frames and budget for five spectrum/geometry evaluations per frame")
    allocations = [budget//sum(costs)] * len(costs)
    remaining = budget-sum(a*c for a, c in zip(allocations, costs))
    for i, cost in enumerate(costs):
        if remaining >= cost:
            allocations[i] += 1
            remaining -= cost
    operator_id = f"frozen-native-JA-v1:{snapshot.sha256}:{candidate_id}"
    calls, geometry_calls, pose_calls = 0, 0, 0
    saved = engine.anatomy()
    try:
        engine.set_anatomy(anatomy)
        for index, (row, target) in enumerate(fitted_frames):
            allocation = allocations[index]
            frame_calls, best = 0, None
            visited = []

            class Exhausted(Exception):
                pass

            def objective(ja):
                nonlocal calls, geometry_calls, pose_calls, frame_calls, best
                if frame_calls >= allocation:
                    raise Exhausted
                frame_calls += 1; calls += 1
                hz, spectrum, _ = engine.spectrum(row["pose"], overrides={"JA": float(ja)}, bins=512)
                raw = spectrum[mask]-target
                residual = list(raw/sigma_db)
                prediction = None
                measurement = row["measured_visible_geometry"]
                if measurement is not None:
                    geometry_calls += 1
                    prediction = engine.lip_markers(row["pose"], articulation={"JA": float(ja)})
                    if prediction["operator_id"] != LIP_OPERATOR:
                        raise RuntimeError("Native lip operator mismatch")
                    residual.append((prediction["distance_m"]-measurement["value_m"])/math.hypot(measurement["sigma_m"], measurement["model_sigma_m"]))
                value = float(np.dot(residual, residual))
                if not math.isfinite(value):
                    raise RuntimeError("Nonfinite frozen control objective")
                visited.append((float(ja), value))
                if best is None or value < best["objective"]:
                    pose_calls += 1
                    _, controls = engine.pose(row["pose"], overrides={"JA": float(ja)})
                    best = {"JA": controls["JA"]["applied"], "requested_JA": float(ja),
                        "native_controls": controls, "objective": value,
                        "spectral_rmse_db": float(np.sqrt(np.mean(raw**2))),
                        "predicted_visible_geometry": prediction}
                return value

            grid = np.linspace(-5., -1., min(41, max(3, allocation//2)))
            # Seed controls grid tie order only; the same complete grid is searched.
            rng = np.random.default_rng(seed + index)
            for point in rng.permutation(grid):
                objective(point)
            best_index = int(np.argmin(np.abs(grid-best["requested_JA"])))
            lower, upper = grid[max(0, best_index-1)], grid[min(len(grid)-1, best_index+1)]
            try:
                optimized = minimize_scalar(objective, bounds=(lower, upper), method="bounded",
                    options={"maxiter": allocation, "xatol": 1e-7})
                termination = "converged" if optimized.success else "optimizer_limit"
            except Exhausted:
                termination = "budget_exhausted"
            row["state"] = {**best, "source_kind": "inferred_articulation", "derived_model_id": frozen["model_id"],
                "snapshot_sha256": snapshot.sha256, "candidate_id": candidate_id, "operator_id": operator_id,
                "measurement_sigma_deg": None, "uncertainty_scope": "uncalibrated_conditional_on_frozen_anatomy_and_observations",
                "reconstruction_only": True, "termination": termination, "forward_evaluations": frame_calls,
                "native_forward_calls": frame_calls*costs[index], "identifiability": "not_established",
                "sampled_near_optimal_requested_JA_range_deg": [min(x for x, y in visited if y <= best["objective"]+1.),
                                                     max(x for x, y in visited if y <= best["objective"]+1.)],
                "range_is_calibrated_posterior": False}
            if engine.anatomy() != anatomy:
                raise RuntimeError("Frozen anatomy changed during control inference")
    finally:
        engine.set_anatomy(saved)
    return {"schema_version": "0.1.0", "kind": "frozen_anatomy_articulation_reconstruction",
        "model_id": frozen["model_id"], "snapshot_sha256": snapshot.sha256, "candidate_id": candidate_id,
        "frozen_anatomy": deepcopy(anatomy), "snapshot_frozen_at": frozen["frozen_at"],
        "anatomy_training_evidence_ids": list(frozen["evidence_ids"]), "provenance": deepcopy(engine.provenance), "attempts": output_attempts,
        "calibration_evidence_ids": sorted(calibration_ids), "excluded_held_out_evidence_ids": sorted(held_ids),
        "budget": budget, "forward_evaluations": calls, "geometry_calls": geometry_calls,
        "native_forward_calls": calls+geometry_calls, "explicit_pose_calls": pose_calls,
        "seed": seed, "search": "deterministic_grid_then_bounded_scalar_refinement", "JA_bounds_deg": [-5., -1.],
        "temporal_model": "independent_frames_no_interpolation", "max_gap_seconds": gap_threshold,
        "anatomy_optimized": False, "physiological_limits_established": False, "prospective_prediction": False}
