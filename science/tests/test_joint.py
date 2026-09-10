from copy import deepcopy

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.joint import KIND, fit_joint


def observations(engine):
    saved = engine.anatomy()
    try:
        engine.set_anatomy({"hard_palate_length": 4.50, "pharynx_length": 6.60})
        rows = []
        for i, pose in enumerate(("a", "i")):
            hz, db, _ = engine.spectrum(pose, overrides={"JA": -2.9}, bins=512)
            mask = (hz >= 100) & (hz <= 6000)
            rows.append({"id": pose, "split": "calibration", "pose": pose,
                         "frequency_hz": hz[mask].tolist(), "magnitude_db": db[mask].tolist()})
        return {"kind": KIND, "schema_version": "0.1.0", "sample_rate_hz": engine.sample_rate,
                "spectrum_bins": 512, "provenance": deepcopy(engine.provenance), "observations": rows,
                "geometry_observations": [{"kind": "synthetic_direct_anatomy", "split": "calibration",
                    "parameter": "hard_palate_length", "unit": "cm", "value": 4.50, "sigma": .02}]}
    finally:
        engine.set_anatomy(saved)


def test_native_joint_budget_baseline_reset_and_no_leakage():
    with Engine() as engine:
        doc = observations(engine)
        doc["observations"].append({"id": "hidden", "split": "held_out", "magnitude_db": "unread"})
        engine.set_anatomy({"hard_palate_length": 4.8})
        saved = engine.anatomy()
        original = deepcopy(doc)
        result = fit_joint(engine, doc, budget_per_model=120, starts=1)
        assert doc == original
        assert engine.anatomy() == saved
        assert result["residual_calls"] <= 240
        assert result["spectrum_calls"] == 2*result["residual_calls"]
        for model in (result["joint"], result["fixed_anatomy_baseline"]):
            assert set(model["best"]["trial_articulation"]) == {"a", "i"}
            assert set(model["best"]["trial_controls"]) == {"a", "i"}
            for trial_id in ("a", "i"):
                controls = model["best"]["trial_controls"][trial_id]
                assert len(controls) == engine.tract_count
                assert controls["JA"]["requested"] == model["best"]["trial_articulation"][trial_id]["JA"]
                assert np.isfinite(controls["JA"]["applied"])
            assert model["identifiability"] == "not_established"
            assert model["residual_calls"] <= 120
            assert 0 < model["global_residual_calls"] <= 60
            assert any(c["phase"] == "global" for c in model["candidates"])
            assert model["spectrum_calls"] == 2*model["residual_calls"]
        assert result["joint"]["best"]["objective"] < result["joint"]["best"]["initial_objective"]
        for model in (result["joint"], result["fixed_anatomy_baseline"]):
            best = model["best"]
            engine.set_anatomy(best["anatomy"])
            errors = []
            for row in doc["observations"][:2]:
                hz, db, _ = engine.spectrum(row["pose"], overrides=best["trial_articulation"][row["id"]], bins=512)
                errors.extend(db[(hz >= 100) & (hz <= 6000)] - row["magnitude_db"])
            assert best["rmse_db"] == pytest.approx(np.sqrt(np.mean(np.square(errors))))
        engine.set_anatomy(saved)
        doc["observations"][-1]["magnitude_db"] = [999999.]
        doc["geometry_observations"].append({"split": "held_out", "value": "never read"})
        repeat = fit_joint(engine, doc, budget_per_model=120, starts=1)
        assert repeat["joint"] == result["joint"]
        assert repeat["calibration_sha256"] == result["calibration_sha256"]


def test_validation_and_failure_restore(monkeypatch):
    with Engine() as engine:
        doc = observations(engine)
        for kwargs in ({"budget_per_model": True}, {"starts": 0}, {"seed": -1},
                       {"anatomy_bounds": {"lip_width": [1., 1.2]}},
                       {"articulation_bounds": {"JA": [-10., 0.]}}):
            with pytest.raises(ValueError):
                fit_joint(engine, doc, **kwargs)
        for field, value in (("kind", "human_audio"), ("provenance", {})):
            bad = deepcopy(doc); bad[field] = value
            with pytest.raises(ValueError):
                fit_joint(engine, bad)
        for mutate in (
            lambda d: d["observations"][0].update(magnitude_db=[float("nan")]),
            lambda d: d["observations"][0].update(split="held_out"),
            lambda d: d["geometry_observations"][0].update(kind="external_depth"),
            lambda d: d["geometry_observations"][0].update(sigma=0),
            lambda d: d["observations"][1].update(id="a"),
        ):
            bad = deepcopy(doc); mutate(bad)
            with pytest.raises(ValueError):
                fit_joint(engine, bad)
        saved = engine.anatomy()
        def fail(*args, **kwargs):
            raise RuntimeError("native failure")
        monkeypatch.setattr(engine, "spectrum", fail)
        with pytest.raises(RuntimeError, match="native failure"):
            fit_joint(engine, doc, budget_per_model=10, starts=1)
        assert engine.anatomy() == saved


def test_multistart_exhaustion_is_not_convergence():
    with Engine() as engine:
        result = fit_joint(engine, observations(engine), budget_per_model=10, starts=2)
        assert result["joint"]["residual_calls"] == 10
        assert len(result["joint"]["candidates"]) == 2
        assert all(c["termination"] == "budget_exhausted" for c in result["joint"]["candidates"])
        assert result["joint"]["diversity_assessment"] == "bounded_multistart_only"
        assert result["joint"]["spread_is_calibrated_posterior"] is False
        assert result["residual_calls"] <= 20


def test_noisy_geometry_value_outside_latent_bounds_is_a_residual():
    with Engine() as engine:
        doc = observations(engine)
        doc["geometry_observations"][0].update(value=5.3, sigma=.3)
        result = fit_joint(engine, doc, budget_per_model=10, starts=1)
        assert result["geometry_measurement_count"] == 1
        assert result["joint"]["best"]["objective"] > 0
        assert 3.8 <= result["joint"]["best"]["anatomy"]["hard_palate_length"] <= 5.1
        assert result["explicit_pose_calls"] == result["spectrum_calls"]


def visible_document(engine):
    from observations.geometry import DepthFrame, reconstruct, joint_lip_measurement
    doc = observations(engine)
    saved = engine.anatomy()
    try:
        engine.set_anatomy({"hard_palate_length": 4.50, "pharynx_length": 6.60})
        distance = engine.lip_markers("a", articulation={"JA": -2.9})["distance_m"]
    finally:
        engine.set_anatomy(saved)
    focal = .5/distance
    frame = DepthFrame(evidence_id="synthetic-visible-lips", timebase_id="session-clock",
        timestamp_seconds=2., depth=np.full((1, 2), .5),
        intrinsics=np.diag([focal, focal, 1.]), world_from_camera=np.eye(4), units="m",
        rectified=True, depth_sigma_m=.0001, pixel_sigma=.01, sync_uncertainty_seconds=.001)
    measurement = joint_lip_measurement(reconstruct(frame), [0, 0], [1, 0],
        trial_id="a", split="calibration", correspondence_id="synthetic-visible-lip-protocol-v1",
        model_sigma_m=.002)
    doc["geometry_observations"].append(measurement)
    doc["observations"][0].update(timebase_id="session-clock", timestamp_seconds=2.010, sync_uncertainty_seconds=.001)
    return doc


def test_measured_visible_lip_geometry_enters_native_joint_objective():
    with Engine() as engine:
        doc = visible_document(engine)
        original = deepcopy(doc)
        result = fit_joint(engine, doc, budget_per_model=20, starts=1)
        assert doc == original
        assert result["visible_geometry_measurement_count"] == 1
        assert result["geometry_calls"] == result["residual_calls"]
        measurement = doc["geometry_observations"][-1]
        for name in ("joint", "fixed_anatomy_baseline"):
            model = result[name]
            assert model["geometry_calls"] == model["residual_calls"]
            best = model["best"]
            engine.set_anatomy(best["anatomy"])
            prediction = engine.lip_markers("a", articulation=best["trial_articulation"]["a"])
            reported = best["geometry_predictions"][0]
            assert prediction["distance_m"] == reported["predicted_distance_m"]
            assert reported["evidence_id"] == measurement["evidence_id"]
            errors = []
            for row in doc["observations"]:
                hz, db, _ = engine.spectrum(row["pose"], overrides=best["trial_articulation"][row["id"]], bins=512)
                errors.extend(db[(hz >= 100) & (hz <= 6000)] - row["magnitude_db"])
            direct = doc["geometry_observations"][0]
            penalty = ((best["anatomy"][direct["parameter"]]-direct["value"])/direct["sigma"])**2
            penalty += ((prediction["distance_m"]-measurement["value_m"])/np.hypot(measurement["sigma_m"], measurement["model_sigma_m"]))**2
            assert best["objective"] == pytest.approx(np.dot(errors, errors)+penalty)


def test_visible_geometry_requires_trial_correspondence_and_bounded_alignment(monkeypatch):
    with Engine() as engine:
        doc = visible_document(engine)
        for mutate in (
            lambda d: d["geometry_observations"][-1].update(trial_id="missing"),
            lambda d: d["geometry_observations"][-1].update(timebase_id="different-clock"),
            lambda d: d["geometry_observations"][-1].update(timestamp_seconds=2.031),
            lambda d: d["geometry_observations"][-1].update(operator_id="guessed-internal-anatomy"),
            lambda d: d["geometry_observations"][-1].update(correspondence_id=""),
            lambda d: d["geometry_observations"][-1].update(pixels_uv=[[0, 0], [0, 0]]),
            lambda d: d["geometry_observations"][-1].update(sigma_m=1.7e308, model_sigma_m=1.7e308),
            lambda d: d["observations"][0].update(sync_uncertainty_seconds=-.001),
            lambda d: d["observations"][0].pop("timestamp_seconds"),
        ):
            bad = deepcopy(doc); mutate(bad)
            with pytest.raises(ValueError):
                fit_joint(engine, bad, budget_per_model=10, starts=1)
        saved = engine.anatomy()
        def fail(*args, **kwargs):
            raise RuntimeError("native geometry failure")
        monkeypatch.setattr(engine, "lip_markers", fail)
        with pytest.raises(RuntimeError, match="native geometry failure"):
            fit_joint(engine, doc, budget_per_model=10, starts=1)
        assert engine.anatomy() == saved


def test_visible_geometry_rejects_repeated_physical_frame_across_trials():
    with Engine() as engine:
        doc = visible_document(engine)
        duplicate = deepcopy(doc["geometry_observations"][-1])
        doc["geometry_observations"].append(duplicate)
        with pytest.raises(ValueError, match="Duplicate visible geometry physical frame"):
            fit_joint(engine, doc, budget_per_model=10, starts=1)
        duplicate["trial_id"] = "i"
        doc["observations"][1].update(timebase_id="session-clock", timestamp_seconds=2.010,
                                       sync_uncertainty_seconds=.001)
        with pytest.raises(ValueError, match="Duplicate visible geometry physical frame"):
            fit_joint(engine, doc, budget_per_model=10, starts=1)
        duplicate["timestamp_seconds"] = 2.005
        result = fit_joint(engine, doc, budget_per_model=10, starts=1)
        assert result["visible_geometry_measurement_count"] == 2
        assert result["geometry_calls"] == 2*result["residual_calls"]


def test_held_out_evidence_cannot_be_relabelled_as_calibration_geometry():
    with Engine() as engine:
        doc = visible_document(engine)
        doc["observations"].append({"id": doc["geometry_observations"][-1]["evidence_id"],
                                    "split": "held_out", "magnitude_db": "unread"})
        with pytest.raises(ValueError, match="excluded held-out evidence"):
            fit_joint(engine, doc, budget_per_model=10, starts=1)
