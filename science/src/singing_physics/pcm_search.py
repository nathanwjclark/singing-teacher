"""Bounded adaptive anatomy search using canonical PCM features and finite nuisances."""
from copy import deepcopy
import itertools

import numpy as np
import scipy
from scipy.stats import qmc

from .engine import Engine, finite
from .pcm_inverse import _hash, fit_pcm

SUPPORTED_BOUNDS = {"hard_palate_length": (3.8, 5.1), "pharynx_length": (5.7, 7.4)}


class _CountedEngine:
    """Count actual synthesis invocations across all calls to the finite fitter."""
    def __init__(self, engine, budget):
        self.engine, self.budget, self.calls = engine, budget, 0

    def __getattr__(self, name):
        return getattr(self.engine, name)

    def synthesize(self, *args, **kwargs):
        if self.calls >= self.budget:
            raise RuntimeError("Global native synthesis budget exhausted")
        self.calls += 1
        return self.engine.synthesize(*args, **kwargs)


def search_pcm(engine: Engine, document, *, anatomy_bounds, nuisance_profiles,
               max_synthesis_calls=128, rounds=3, seed=1, node_binary=None):
    """Search a declared small parameter box without reading held-out data.

    All nuisance profiles are evaluated at every proposed anatomy. Each finite
    fit also runs the fixed-anatomy baseline at identical literal compute. Its
    redundant evaluations are reported rather than presented as new exploration.
    """
    if type(max_synthesis_calls) is not int or not 1 <= max_synthesis_calls <= 4096:
        raise ValueError("max_synthesis_calls must be an integer in 1-4096")
    if type(rounds) is not int or not 1 <= rounds <= 8 or type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("rounds must be 1-8 and seed an unsigned 32-bit integer")
    doc, profiles = deepcopy(document), deepcopy(nuisance_profiles)
    if not isinstance(doc, dict) or set(doc) != {"schema_version", "kind", "trials"} or doc.get("schema_version") != "0.1.0" or doc.get("kind") != "canonical_pcm_observations":
        raise ValueError("Only canonical PCM calibration observations are accepted; held-out records must stay separate")
    trials = doc["trials"]
    if not isinstance(trials, list) or not 1 <= len(trials) <= 10:
        raise ValueError("Require 1-10 calibration trials")
    trial_ids = [t.get("id") if isinstance(t, dict) else None for t in trials]
    if any(not isinstance(t, str) or not t.strip() for t in trial_ids) or len(set(trial_ids)) != len(trial_ids):
        raise ValueError("Invalid or duplicate trial identities")
    if not isinstance(anatomy_bounds, dict) or not anatomy_bounds or set(anatomy_bounds)-set(SUPPORTED_BOUNDS):
        raise ValueError("Specify one or both supported anatomy bounds")
    bounds = {}
    for name in sorted(anatomy_bounds):
        interval = anatomy_bounds[name]
        if not isinstance(interval, (list, tuple)) or len(interval) != 2:
            raise ValueError("Anatomy intervals need two endpoints")
        low, high = (finite(v, name) for v in interval)
        if not SUPPORTED_BOUNDS[name][0] <= low < high <= SUPPORTED_BOUNDS[name][1]:
            raise ValueError("Anatomy interval exceeds the supported physical box")
        bounds[name] = (low, high)
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= 8:
        raise ValueError("Require 1-8 explicit nuisance profiles")
    profile_ids = set()
    for profile in profiles:
        if not isinstance(profile, dict) or set(profile) != {"profile_id", "trials"}:
            raise ValueError("Nuisance profile needs profile_id and trials")
        identity = profile["profile_id"]
        if not isinstance(identity, str) or not identity.strip() or identity in profile_ids:
            raise ValueError("Invalid or duplicate nuisance profile id")
        profile_ids.add(identity)
        if not isinstance(profile["trials"], dict) or set(profile["trials"]) != set(trial_ids):
            raise ValueError("Each nuisance profile must bind every calibration trial")
        for control in profile["trials"].values():
            if not isinstance(control, dict) or set(control) != {"JA", "f0_hz", "gain"}:
                raise ValueError("Declare JA, f0_hz and gain for every trial")
            for name, low, high in (("JA", -5., -1.), ("f0_hz", 65., 1000.), ("gain", .001, 100.)):
                if not low <= finite(control[name], name) <= high:
                    raise ValueError("Nuisance controls exceed supported bounds")
    profiles.sort(key=lambda p: p["profile_id"])
    if len({_hash(p["trials"]) for p in profiles}) != len(profiles):
        raise ValueError("Duplicate nuisance controls under different profile IDs")
    dimensions = len(bounds)
    initial_count = 2*dimensions+1
    point_cost = 2*len(trials)*len(profiles)
    if max_synthesis_calls < initial_count*point_cost:
        raise ValueError("Budget cannot cover the complete initial anatomy design and baseline")
    initial = [np.full(dimensions, .5), *qmc.LatinHypercube(dimensions, seed=seed).random(2*dimensions)]
    lower = np.array([v[0] for v in bounds.values()]); span = np.array([v[1]-v[0] for v in bounds.values()])
    seen, coordinates, history = set(), {}, []
    retained = {"joint": [], "fixed_anatomy_baseline": []}
    completed_calls = {"joint": 0, "fixed_anatomy_baseline": 0}
    counted = _CountedEngine(engine, max_synthesis_calls)
    operator_signature = None
    native_provenance = deepcopy(engine.provenance)
    canonical = None
    status, failed = "round_limit", False
    saved = engine.anatomy()
    best = None
    try:
        for round_index in range(rounds):
            if round_index == 0:
                proposed = initial
            else:
                if best is None:
                    status = "no_scorable_candidates"
                    break
                center = coordinates[best["anatomy_point_id"]]
                step = .5/(2**round_index)
                proposed = [np.clip(center + direction*step*np.eye(dimensions)[axis], 0., 1.)
                            for axis, direction in itertools.product(range(dimensions), (-1., 1.))]
            new_points = []
            for point in proposed:
                key = tuple(np.round(point, 12))
                if key in seen:
                    continue
                seen.add(key)
                new_points.append(np.array(key))
            capacity = (max_synthesis_calls-counted.calls)//point_cost
            if not capacity:
                status = "budget_exhausted"
                break
            selected, omitted = new_points[:capacity], new_points[capacity:]
            if not selected:
                continue
            proposals = []
            for point in selected:
                point_id = f"anatomy-{len(coordinates):04d}"
                coordinates[point_id] = point
                anatomy = dict(zip(bounds, (lower+point*span).tolist()))
                for profile in profiles:
                    proposals.append({"candidate_id": point_id+"/"+profile["profile_id"],
                        "anatomy": anatomy, "trials": deepcopy(profile["trials"]),
                        "anatomy_point_id": point_id, "nuisance_profile_id": profile["profile_id"]})
            entry = {"round": round_index, "normalized_step": None if round_index == 0 else step,
                     "proposals": proposals, "omitted_for_budget": [p.tolist() for p in omitted], "batches": []}
            history.append(entry)
            # Keep complete nuisance sets for a point together and respect fit_pcm's 32-candidate cap.
            batch_size = (32//len(profiles))*len(profiles)
            for start in range(0, len(proposals), batch_size):
                batch = proposals[start:start+batch_size]
                candidates = [{k: p[k] for k in ("candidate_id", "anatomy", "trials")} for p in batch]
                expected = 2*len(batch)*len(trials)
                before = counted.calls
                try:
                    result = fit_pcm(counted, doc, candidates=candidates, max_synthesis_calls=expected, node_binary=node_binary)
                    if counted.calls-before != expected or result["actual_synthesis_calls"] != expected:
                        raise RuntimeError("Native call accounting mismatch")
                    if result["native_provenance"] != native_provenance:
                        raise RuntimeError("Native provenance changed during search")
                    signature = _hash({"canonical": result["canonical_extractor"], "native": result["native_provenance"]})
                    if operator_signature is not None and signature != operator_signature:
                        raise RuntimeError("Scientific operator changed between search batches")
                    operator_signature, canonical = signature, result["canonical_extractor"]
                except Exception as exc:
                    if before == 0 and counted.calls == 0:
                        raise
                    entry["batches"].append({"status": "execution_failed", "candidate_ids": [p["candidate_id"] for p in batch],
                        "actual_synthesis_calls": counted.calls-before, "comparison_complete": False,
                        "error_type": type(exc).__name__, "error": str(exc)})
                    status, failed = "execution_failed", True
                    break
                entry["batches"].append({"status": "complete", "actual_synthesis_calls": counted.calls-before,
                                          "comparison_complete": True, "result": result})
                metadata = {p["candidate_id"]: p for p in batch}
                for model in retained:
                    completed_calls[model] += result[model]["actual_synthesis_calls"]
                    for row in result[model]["candidates"]:
                        p = metadata[row["candidate_id"]]
                        retained[model].append({**row, "search_round": round_index, "anatomy_point_id": p["anatomy_point_id"],
                            "nuisance_profile_id": p["nuisance_profile_id"], "proposed_anatomy": deepcopy(p["anatomy"])})
            if failed:
                break
            scored = [r for r in retained["joint"] if r["status"] == "scored"]
            best = min(scored, key=lambda r: (r["weighted_mean_square_discrepancy"], r["candidate_id"])) if scored else None
            if best is None:
                status = "no_scorable_candidates"
                break
            if omitted:
                status = "budget_exhausted"
                break
    finally:
        engine.set_anatomy(saved)
    models = {}
    for model, candidates in retained.items():
        scored = [r for r in candidates if r["status"] == "scored"]
        models[model] = {"candidates": candidates,
            "best": min(scored, key=lambda r: (r["weighted_mean_square_discrepancy"], r["candidate_id"])) if scored else None,
            "actual_synthesis_calls": completed_calls[model]}
    unique_evaluated = {r["anatomy_point_id"] for r in retained["joint"]}
    baseline_unique = len({r["nuisance_profile_id"] for r in retained["fixed_anatomy_baseline"]})*len(trials)
    evaluated_ranges = {name: [min(r["proposed_anatomy"][name] for r in retained["joint"]),
                               max(r["proposed_anatomy"][name] for r in retained["joint"])]
                        for name in bounds} if retained["joint"] else {}
    return {"schema_version": "0.1.0", "kind": "bounded_canonical_pcm_search", "status": status, **models,
        "history": history, "anatomy_bounds": bounds, "evaluated_anatomy_ranges": evaluated_ranges,
        "nuisance_profiles": profiles, "unique_evaluated_anatomy_points": len(unique_evaluated),
        "actual_synthesis_calls": counted.calls, "max_synthesis_calls": max_synthesis_calls,
        "remaining_synthesis_budget": max_synthesis_calls-counted.calls,
        "completed_comparison_calls_equal": completed_calls["joint"] == completed_calls["fixed_anatomy_baseline"],
        "unpaired_failure_synthesis_calls": counted.calls-sum(completed_calls.values()),
        "baseline_unique_nuisance_synthesis_calls": baseline_unique,
        "baseline_redundant_synthesis_calls": completed_calls["fixed_anatomy_baseline"]-baseline_unique,
        "requested_rounds": rounds, "seed": seed,
        "search_method": "latin_hypercube_then_coordinate_refinement/1.0.0", "scipy_version": scipy.__version__,
        "parameter_units": {name: "cm" for name in bounds}, "canonical_extractor": canonical,
        "native_provenance": native_provenance, "observation_sha256": _hash(doc),
        "evidence_ids": [trial["measurement"]["id"] for trial in trials],
        "identifiability": "not_established", "evaluated_ranges_are_posterior": False,
        "finite_search_support_only": True,
        "objective_interpretation": "canonical coarse-descriptor discrepancy; not calibrated likelihood",
        "baseline_interpretation": "same finite nuisance support; repeated baseline calls add no unique exploration",
        "unsupported": ["physiology_identification", "calibrated_posterior", "unknown_room_filter", "unknown_microphone_response"],
        "source_artifact_bytes_verified": False}
