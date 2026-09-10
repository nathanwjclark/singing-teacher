"""Budgeted joint inference for explicitly synthetic, direct-transfer observations."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math

import numpy as np
from scipy.optimize import differential_evolution, least_squares

from .engine import Engine, finite

KIND = "synthetic_transfer_unknown_articulation"
ANATOMY_BOUNDS = {"hard_palate_length": (3.8, 5.1), "pharynx_length": (5.7, 7.4)}
ARTICULATION_BOUNDS = {"JA": (-5., -1.)}
LIP_OPERATOR = "vtl-upper4-lower5-vertex89-distance-v1"
ALIGNMENT_TOLERANCE_SECONDS = .020


def _bounds(values, allowed, label):
    if not isinstance(values, dict) or not values or set(values) - set(allowed):
        raise ValueError(f"Invalid {label} variables")
    result = {}
    for name, interval in values.items():
        if not isinstance(interval, (list, tuple)) or len(interval) != 2:
            raise ValueError(f"Invalid bounds for {name}")
        lo, hi = [finite(x, name) for x in interval]
        if not allowed[name][0] <= lo < hi <= allowed[name][1]:
            raise ValueError(f"Bounds outside supported domain for {name}")
        result[name] = (lo, hi)
    return result


def fit_joint(engine: Engine, document, *, anatomy_bounds=None, articulation_bounds=None,
              budget_per_model=120, starts=3, seed=1):
    """Fit shared anatomy and independent trial controls; compare a fair baseline.

    Budget counts residual calls including finite differences and failed proposals.
    The baseline receives the same budget and articulation variables. No held-out
    spectrum or geometry enters fitting or candidate selection. State is restored
    on success and failure. Direct anatomical measurements are synthetic only.
    """
    if type(budget_per_model) is not int or not 10 <= budget_per_model <= 10000:
        raise ValueError("budget_per_model must be an integer between 10 and 10000")
    if type(starts) is not int or not 1 <= starts <= min(20, budget_per_model // 5):
        raise ValueError("Invalid starts")
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("seed must be an unsigned 32-bit integer")
    doc = deepcopy(document)
    if not isinstance(doc, dict) or doc.get("schema_version") != "0.1.0" or doc.get("kind") != KIND:
        raise ValueError("Only versioned synthetic direct-transfer data are supported")
    if doc.get("provenance") != engine.provenance or doc.get("sample_rate_hz") != engine.sample_rate or doc.get("spectrum_bins") != 512:
        raise ValueError("Observation provenance or spectral profile mismatch")
    ab = _bounds(ANATOMY_BOUNDS if anatomy_bounds is None else anatomy_bounds,
                 ANATOMY_BOUNDS, "anatomy")
    # The narrow JA domain is valid throughout this anatomy search box. Other
    # native controls need their anatomy-dependent domains established first.
    db = _bounds(ARTICULATION_BOUNDS if articulation_bounds is None else articulation_bounds,
                 ARTICULATION_BOUNDS, "articulation")
    observations = doc.get("observations")
    if not isinstance(observations, list) or not 2 <= len(observations) <= 30:
        raise ValueError("Supply 2-30 observations")
    ids = []
    for row in observations:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"] or row.get("split") not in ("calibration", "held_out"):
            raise ValueError("Every trial requires an id and explicit split")
        ids.append(row["id"])
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate trial id")
    excluded_ids = {r["id"] for r in observations if r["split"] == "held_out"}
    rows = [r for r in observations if r["split"] == "calibration"]
    if any(not isinstance(r.get("pose"), str) for r in rows):
        raise ValueError("Calibration pose must be a string")
    if len(rows) < 2 or len({r.get("pose") for r in rows}) < 2:
        raise ValueError("At least two calibration poses are required")
    frequency = np.arange(257) * engine.sample_rate / 512
    mask = (frequency >= 100) & (frequency <= 6000)
    target = []
    for row in rows:
        if row.get("pose") not in engine.poses:
            raise ValueError("Unknown calibration pose")
        try:
            x, y = np.asarray(row.get("frequency_hz"), float), np.asarray(row.get("magnitude_db"), float)
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid calibration spectrum") from exc
        if x.shape != frequency[mask].shape or y.shape != x.shape or not np.isfinite(y).all() or not np.array_equal(x, frequency[mask]):
            raise ValueError("Invalid calibration spectrum")
        target.append(y)
    target = np.concatenate(target)
    sigma_db = finite(doc.get("spectral_sigma_db", 1.), "spectral_sigma_db")
    if sigma_db <= 0:
        raise ValueError("spectral_sigma_db must be positive")
    geometry = []
    visible_geometry = []
    visible_frame_ids = set()
    by_id = {row["id"]: row for row in rows}
    geometry_input = doc.get("geometry_observations", [])
    if not isinstance(geometry_input, list):
        raise ValueError("geometry_observations must be a list")
    held_out_geometry_ids = {
        g.get("evidence_id") for g in geometry_input
        if isinstance(g, dict) and g.get("split") == "held_out"
        and isinstance(g.get("evidence_id"), str) and g.get("evidence_id").strip()
    }
    for g in geometry_input:
        if not isinstance(g, dict) or g.get("split") not in ("calibration", "held_out"):
            raise ValueError("Geometry requires an explicit split")
        if g["split"] == "held_out":
            continue
        if g.get("kind") == "visible_lip_distance":
            if g.get("operator_id") != LIP_OPERATOR:
                raise ValueError("Unsupported visible geometry operator")
            for field in ("trial_id", "evidence_id", "timebase_id", "correspondence_id", "uncertainty_scope"):
                if not isinstance(g.get(field), str) or not g[field].strip():
                    raise ValueError(f"Visible geometry requires {field}")
            if g["evidence_id"] in excluded_ids:
                raise ValueError("Visible geometry references excluded held-out evidence")
            if g["evidence_id"] in held_out_geometry_ids:
                raise ValueError("Visible geometry reuses held-out geometry evidence")
            if g["trial_id"] not in by_id:
                raise ValueError("Visible geometry must reference a calibration trial")
            row = by_id[g["trial_id"]]
            if row.get("timebase_id") != g["timebase_id"]:
                raise ValueError("Visible geometry timebase does not match trial")
            measured_t = finite(g.get("timestamp_seconds"), "geometry timestamp")
            frame_identity = (g["evidence_id"], g["timebase_id"], measured_t, g["operator_id"])
            if frame_identity in visible_frame_ids:
                raise ValueError("Duplicate visible geometry physical frame")
            visible_frame_ids.add(frame_identity)
            trial_t = finite(row.get("timestamp_seconds"), "trial timestamp")
            measured_sync = finite(g.get("sync_uncertainty_seconds"), "geometry sync bound")
            trial_sync = finite(row.get("sync_uncertainty_seconds"), "trial sync bound")
            if min(measured_sync, trial_sync) < 0 or abs(measured_t-trial_t)+measured_sync+trial_sync > ALIGNMENT_TOLERANCE_SECONDS:
                raise ValueError("Visible geometry exceeds experimental 20ms alignment tolerance")
            for field in ("value_m", "sigma_m", "model_sigma_m"):
                if finite(g.get(field), field) <= 0:
                    raise ValueError(f"{field} must be positive")
            if not np.isfinite(math.hypot(g["sigma_m"], g["model_sigma_m"])):
                raise ValueError("Combined visible geometry uncertainty is nonfinite")
            try:
                pixels = np.asarray(g.get("pixels_uv"), float)
            except (ValueError, TypeError) as exc:
                raise ValueError("Invalid visible geometry pixels") from exc
            if pixels.shape != (2, 2) or not np.isfinite(pixels).all() or np.any(pixels < 0) or np.array_equal(pixels[0], pixels[1]):
                raise ValueError("Invalid visible geometry pixels")
            visible_geometry.append(g)
            continue
        if g.get("kind") != "synthetic_direct_anatomy" or g.get("parameter") not in ab or g.get("unit") != "cm":
            raise ValueError("Only synthetic direct anatomy measurements in cm are supported")
        value, sigma = finite(g.get("value"), "geometry value"), finite(g.get("sigma"), "geometry sigma")
        if sigma <= 0:
            raise ValueError("Invalid geometry observation")
        geometry.append((g["parameter"], value, sigma))
    calibration_hash = hashlib.sha256(json.dumps({"rows": rows, "geometry": geometry,
        "sigma_db": sigma_db, "visible_geometry": visible_geometry}, sort_keys=True, allow_nan=False).encode()).hexdigest()
    saved = engine.anatomy()
    totals = {"residual_calls": 0, "spectrum_calls": 0, "explicit_pose_calls": 0, "geometry_calls": 0}

    def solve(free_anatomy):
        names = list(ab) if free_anatomy else []
        intervals = [ab[k] for k in names] + [db[k] for _ in rows for k in db]
        low = np.array([v[0] for v in intervals]); span = np.array([v[1]-v[0] for v in intervals])
        calls = 0
        candidates = []
        best = None
        first_objective = None
        best_point = None
        rng = np.random.default_rng(seed)
        initial = [np.full(len(intervals), .5), *rng.uniform(.05, .95, (starts-1, len(intervals)))]

        class Exhausted(Exception):
            pass

        def residual(x):
            nonlocal calls, best, first_objective, best_point
            if calls >= limit:
                raise Exhausted
            calls += 1
            totals["residual_calls"] += 1
            physical = low + np.asarray(x)*span
            anatomy = dict(zip(names, physical[:len(names)].tolist()))
            trial = {r["id"]: dict(zip(db, physical[len(names)+i*len(db):len(names)+(i+1)*len(db)].tolist())) for i, r in enumerate(rows)}
            engine.set_anatomy(anatomy)
            predicted = []
            applied_controls = {}
            for row in rows:
                totals["explicit_pose_calls"] += 1
                _, controls = engine.pose(row["pose"], overrides=trial[row["id"]])
                applied_controls[row["id"]] = controls
                totals["spectrum_calls"] += 1
                predicted.append(engine.spectrum(row["pose"], overrides=trial[row["id"]], bins=512)[1][mask])
            raw = np.concatenate(predicted) - target
            penalties = [(anatomy.get(k, engine.base_anatomy[k])-v)/s for k, v, s in geometry]
            geometry_predictions = []
            native_lips = {}
            for measurement in visible_geometry:
                trial_id = measurement["trial_id"]
                if trial_id not in native_lips:
                    totals["geometry_calls"] += 1
                    native_lips[trial_id] = engine.lip_markers(
                        by_id[trial_id]["pose"], articulation=trial[trial_id])
                native = native_lips[trial_id]
                if native.get("operator_id") != LIP_OPERATOR:
                    raise RuntimeError("Native visible geometry operator mismatch")
                prediction = finite(native.get("distance_m"), "native lip distance")
                sigma = math.hypot(measurement["sigma_m"], measurement["model_sigma_m"])
                penalties.append((prediction-measurement["value_m"])/sigma)
                geometry_predictions.append({"trial_id": trial_id, "evidence_id": measurement["evidence_id"],
                    "operator_id": LIP_OPERATOR, "correspondence_id": measurement["correspondence_id"],
                    "predicted_distance_m": prediction, "observed_distance_m": measurement["value_m"],
                    "combined_sigma_m": sigma, "positions_m": native["positions_m"]})
            result = np.concatenate((raw/sigma_db, penalties))
            if not np.isfinite(result).all():
                raise RuntimeError("Nonfinite physical residual")
            candidate = {"anatomy": {**engine.base_anatomy, **anatomy}, "trial_articulation": trial,
                         "trial_controls": applied_controls, "geometry_predictions": geometry_predictions, "objective": float(np.dot(result, result)), "rmse_db": float(np.sqrt(np.mean(raw**2)))}
            if first_objective is None:
                first_objective = candidate["objective"]
            if best is None or candidate["objective"] < best["objective"]:
                best = candidate
                best_point = np.asarray(x).copy()
            return result

        global_calls = 0
        if budget_per_model >= 80:
            limit = budget_per_model // 2
            try:
                differential_evolution(
                    lambda x: float(np.sum(residual(x)**2)), [(0., 1.)]*len(intervals),
                    seed=seed, popsize=6, maxiter=budget_per_model, tol=1e-8,
                    polish=False, workers=1,
                )
                status = "global_converged"
            except Exhausted:
                status = "budget_exhausted"
            global_calls = calls
            candidates.append({**best, "termination": status, "start": -1,
                               "phase": "global", "initial_objective": first_objective})
            initial[0] = best_point.copy()
        remaining = budget_per_model - global_calls
        for index, point in enumerate(initial):
            limit = global_calls + (index+1)*remaining//starts
            best = None
            first_objective = None
            try:
                result = least_squares(residual, point, bounds=(0., 1.), diff_step=1e-4,
                                       max_nfev=budget_per_model, ftol=1e-7, xtol=1e-7, gtol=1e-7)
                status = "converged" if result.success else "optimizer_limit"
            except Exhausted:
                status = "budget_exhausted"
            if best is not None:
                candidates.append({**best, "termination": status, "start": index,
                                   "phase": "local", "initial_objective": first_objective})
        candidates.sort(key=lambda c: c["objective"])
        near = [c for c in candidates if c["objective"] <= candidates[0]["objective"] + max(1., .05*candidates[0]["objective"])]
        spread = {k: float(np.ptp([c["anatomy"][k] for c in near])) for k in names}
        articulation_spread = {r["id"]: {k: float(np.ptp([c["trial_articulation"][r["id"]][k] for c in near]))
                               for k in db} for r in rows}
        return {"best": candidates[0], "candidates": candidates, "residual_calls": calls,
                "spectrum_calls": calls * len(rows), "explicit_pose_calls": calls * len(rows),
                "global_residual_calls": global_calls,
                "geometry_calls": calls * len({g["trial_id"] for g in visible_geometry}),
                "near_optimal_articulation_spread": articulation_spread,
                "diversity_assessment": "insufficient_multistart_evidence" if starts < 2 else "bounded_multistart_only",
                "near_optimal_anatomy_spread_cm": spread, "near_optimal_candidates": len(near),
                "identifiability": "not_established", "spread_is_calibrated_posterior": False}

    try:
        joint = solve(True)
        baseline = solve(False)
    finally:
        engine.set_anatomy(saved)
    return {"schema_version": "0.1.0", "kind": "synthetic_joint_fit", "joint": joint,
            "fixed_anatomy_baseline": baseline, "anatomy_bounds": ab, "articulation_bounds": db,
            "calibration_ids": [r["id"] for r in rows],
            "excluded_held_out_ids": [r["id"] for r in observations if r["split"] == "held_out"],
            "calibration_sha256": calibration_hash, "provenance": deepcopy(engine.provenance),
            "budget_per_model": budget_per_model, "seed": seed, **totals,
            "geometry_measurement_count": len(geometry)+len(visible_geometry),
            "visible_geometry_measurement_count": len(visible_geometry),
            "alignment_tolerance_seconds": ALIGNMENT_TOLERANCE_SECONDS, "evidence": "same-simulator direct transfer only"}
