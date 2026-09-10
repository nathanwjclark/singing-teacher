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
