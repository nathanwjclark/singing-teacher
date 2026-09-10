"""Controlled inverse-physics benchmark with known template articulation.

Inputs are synthetic transfer functions, NOT microphone spectra. This isolates
anatomy fitting before the unknown glottal source, articulation and capture model.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import time

import numpy as np
from scipy.optimize import differential_evolution, least_squares

from .engine import Engine, finite, write_json

FREE = ("hard_palate_length", "pharynx_length")
BOUNDS = np.array([[3.8, 5.1], [5.7, 7.4]])
KIND = "synthetic_transfer_known_template_pose"


def make_observations(engine: Engine, anatomy, poses=("a", "i", "u"), noise_db=0., seed=0):
    """Return observation-only data. Truth is deliberately not embedded here."""
    noise_db = finite(noise_db, "noise_db")
    if noise_db < 0 or noise_db > 10:
        raise ValueError("noise_db must be between 0 and 10")
    engine.set_anatomy(anatomy)
    rng = np.random.default_rng(seed)
    rows = []
    for pose in poses:
        hz, db, _ = engine.spectrum(pose, bins=512)
        valid = (hz >= 100) & (hz <= 6000)
        rows.append({"pose": pose, "frequency_hz": hz[valid].tolist(),
                     "magnitude_db": (db[valid] + rng.normal(0, noise_db, valid.sum())).tolist()})
    return {"schema_version": "0.1.0", "kind": KIND, "sample_rate_hz": engine.sample_rate,
            "spectrum_bins": 512, "observations": rows, "provenance": engine.provenance}


def validate_observations(engine, document):
    if not isinstance(document, dict) or document.get("kind") != KIND or document.get("schema_version") != "0.1.0":
        raise ValueError("This fitter accepts only versioned synthetic transfer observations; human audio is not supported")
    if document.get("sample_rate_hz") != engine.sample_rate or document.get("spectrum_bins") != 512:
        raise ValueError("Observation sample rate / transform size differs from this profile")
    if document.get("provenance") != engine.provenance:
        raise ValueError("Observation provenance differs from this engine; cross-engine testing needs an explicit future profile")
    rows = document.get("observations")
    if not isinstance(rows, list) or not 2 <= len(rows) <= 20:
        raise ValueError("Supply 2-20 pose observations")
    if any(not isinstance(r, dict) or r.get("pose") not in engine.poses for r in rows):
        raise ValueError("Observation contains an unknown pose")
    if len({r["pose"] for r in rows}) < 2:
        raise ValueError("At least two different poses are required")
    hz = np.arange(257) * engine.sample_rate / 512
    mask = (hz >= 100) & (hz <= 6000)
    data = []
    for row in rows:
        x, y = np.asarray(row.get("frequency_hz"), dtype=float), np.asarray(row.get("magnitude_db"), dtype=float)
        if x.shape != hz[mask].shape or y.shape != x.shape or not np.isfinite(x).all() or not np.isfinite(y).all():
            raise ValueError("Invalid, missing or nonfinite spectral observations")
        if not np.allclose(x, hz[mask], rtol=0, atol=1e-9):
            raise ValueError("Frequencies must match the versioned observation grid")
        data.append(y)
    return rows, mask, np.concatenate(data)


def fit(engine: Engine, observations, *, starts=6, max_evaluations=100, seed=1):
    if type(starts) is not int or not 1 <= starts <= 32 or type(max_evaluations) is not int or not 5 <= max_evaluations <= 500:
        raise ValueError("starts must be 1-32 and max_evaluations 5-500")
    rows, mask, target = validate_observations(engine, observations)
    begin = time.monotonic()
    calls = 0
    low, span = BOUNDS[:, 0], np.ptp(BOUNDS, axis=1)

    def residual(normalized):
        nonlocal calls
        calls += 1
        engine.set_anatomy(dict(zip(FREE, low + normalized * span)))
        predicted = np.concatenate([engine.spectrum(row["pose"], bins=512)[1][mask] for row in rows])
        return predicted - target

    default = np.array([engine.base_anatomy[n] for n in FREE])
    default_normalized = (default-low)/span
    fixed_rmse = float(np.sqrt(np.mean(residual(default_normalized)**2)))
    rng = np.random.default_rng(seed)
    # Tract geometry and parameter limiting make the objective nonconvex. A
    # bounded global search precedes local refinement; no target anatomy is used.
    global_result = differential_evolution(
        lambda x: float(np.mean(residual(x)**2)), [(0., 1.)] * len(FREE),
        seed=seed, popsize=8, maxiter=60, tol=1e-7, polish=False,
    )
    initial = [global_result.x, *rng.uniform(.05, .95, size=(starts-1, len(FREE)))]
    candidates = []
    # Finite differences need to exceed native geometric discretization noise.
    for point in initial:
        result = least_squares(residual, point, bounds=(np.zeros(2), np.ones(2)),
                               max_nfev=max_evaluations, diff_step=1e-4, ftol=1e-8, xtol=1e-8, gtol=1e-8)
        candidates.append({"anatomy": dict(zip(FREE, (low + result.x*span).tolist())),
                           "rmse_db": float(np.sqrt(np.mean(result.fun**2))),
                           "optimizer_success": bool(result.success), "message": result.message,
                           "function_evaluations": result.nfev})
    candidates.sort(key=lambda x: x["rmse_db"])
    best = candidates[0]
    observation_hash = hashlib.sha256(json.dumps(observations, sort_keys=True, allow_nan=False).encode()).hexdigest()
    return {"schema_version": "0.1.0", "kind": "synthetic_anatomy_fit", "evidence_level": "A: same-simulator only",
            "observation_sha256": observation_hash, "free_parameters": list(FREE),
            "parameter_bounds": {k: list(v) for k, v in zip(FREE, BOUNDS.tolist())},
            "fixed_anatomy": {k: v for k, v in engine.base_anatomy.items() if k not in FREE},
            "articulation": "known reference-pose controls, limited by each candidate geometry",
            "best": best, "candidates": candidates, "candidate_spread_is_calibrated_posterior": False,
            "fixed_anatomy_rmse_db": fixed_rmse, "actual_forward_evaluations": calls,
            "global_search": {"generations": global_result.nit, "evaluations": global_result.nfev,
                              "optimizer_success": bool(global_result.success)},
            "elapsed_seconds": time.monotonic()-begin, "seed": seed, "provenance": engine.provenance}


def benchmark(output, *, seed=7, noise_db=0., starts=6):
    output = Path(output)
    if output.exists():
        raise ValueError("Benchmark output already exists; choose a new directory")
    output.mkdir(parents=True)
    rng = np.random.default_rng(seed)
    truth = dict(zip(FREE, rng.uniform(BOUNDS[:, 0]+.15, BOUNDS[:, 1]-.15).tolist()))
    with Engine() as engine:
        observations = make_observations(engine, truth, noise_db=noise_db, seed=seed)
        write_json(output / "observations.json", observations)
        # The fitter receives no truth, initialization from truth, or target geometry.
        fitted = fit(engine, observations, starts=starts, seed=seed+1)
        write_json(output / "fit.json", fitted)
        held_out = make_observations(engine, truth, poses=("e",), noise_db=0)["observations"][0]
        engine.set_anatomy(fitted["best"]["anatomy"])
        hz, db, _ = engine.spectrum("e", bins=512)
        mask = (hz >= 100) & (hz <= 6000)
        held_out_rmse = float(np.sqrt(np.mean((db[mask]-held_out["magnitude_db"])**2)))
        # Scoring truth is written separately only after the fit has been frozen.
        report = {"kind": "synthetic_recovery_score", "truth": truth,
                  "absolute_error_cm": {k: abs(fitted["best"]["anatomy"][k]-truth[k]) for k in FREE},
                  "calibration_rmse_db": fitted["best"]["rmse_db"], "held_out_pose_rmse_db": held_out_rmse,
                  "fixed_anatomy_rmse_db": fitted["fixed_anatomy_rmse_db"],
                  "noise_db": noise_db, "seed": seed,
                  "limitations": "Same simulator; known articulation; direct transfer function, not microphone audio or human anatomy."}
        write_json(output / "score.json", report)
        engine.export(output / "fitted-forward", anatomy=fitted["best"]["anatomy"])
    return report
