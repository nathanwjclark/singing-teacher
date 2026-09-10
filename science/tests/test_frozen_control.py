from copy import deepcopy
import json

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.frozen_control import KIND, fit_frozen_control
from singing_physics.prediction import Artifact, freeze_candidates


def frozen_fixture(engine, *, occluded=False):
    """Reusable real-native single-vowel fixture; returns snapshot, document, truth."""
    from observations.geometry import DepthFrame, reconstruct, joint_lip_measurement
    anatomy = engine.set_anatomy(engine.anatomy())
    snapshot = freeze_candidates(model_id="frozen-model-1", evidence_ids=["anatomy-training-1"],
        provenance=engine.provenance, candidates=[{"candidate_id": "candidate-1", "anatomy": anatomy}],
        frozen_at="2026-01-01T00:00:00Z")
    truth = [-2.37, -3.24, -4.08]
    frames = []
    for i, ja in enumerate(truth):
        timestamp = 1.+i*.05
        frame_id = f"new-frame-{i}"
        hz, spectrum, _ = engine.spectrum("a", overrides={"JA": ja}, bins=512)
        valid = (hz >= 100) & (hz <= 6000)
        distance = engine.lip_markers("a", articulation={"JA": ja})["distance_m"]
        depth = DepthFrame(evidence_id="new-depth-recording", timebase_id="session-clock",
            timestamp_seconds=timestamp, depth=np.full((1, 2), .5),
            intrinsics=np.diag([.5/distance, .5/distance, 1.]), world_from_camera=np.eye(4),
            units="m", rectified=True, depth_sigma_m=.0001, pixel_sigma=.01,
            sync_uncertainty_seconds=.001)
        measurement = joint_lip_measurement(reconstruct(depth), [0, 0], [1, 0], trial_id=frame_id,
            split="calibration", correspondence_id="native-lip-correspondence-v1", model_sigma_m=.0005)
        frames.append({"id": frame_id, "audio_evidence_id": "new-audio-recording",
            "evidence_id": "new-depth-recording", "timestamp_seconds": timestamp,
            "timebase_id": "session-clock", "sync_uncertainty_seconds": .001,
            "pose": "a", "frequency_hz": hz[valid].tolist(), "magnitude_db": spectrum[valid].tolist(),
            "visibility": "visible", "geometry_status": "visible", "geometry_observation": measurement})
    if occluded:
        frames[1].update(visibility="occluded", geometry_status="occluded", geometry_reason="lip_endpoints_occluded",
                         geometry_observation={"evidence_id": "new-depth-recording", "value_m": "unread"})
    document = {"schema_version": "0.1.0", "kind": KIND, "sample_rate_hz": engine.sample_rate,
        "spectrum_bins": 512, "provenance": deepcopy(engine.provenance),
        "attempts": [{"attempt_id": "new-attempt-1", "cue_id": "cue-1", "cue_version": "1",
            "context_id": "context-1", "context": {"pitch_hz": 160., "vowel": "a", "level": "easy", "posture": "seated"},
            "split": "calibration", "observed_at": "2026-01-02T00:00:00Z", "cue_delivered_seconds": .9,
            "actual_onset_seconds": 1.05, "execution_status": "unsuccessful", "mode": "elicited", "frames": frames}]}
    return snapshot, document, truth


def run_fit(engine, snapshot, document, **kwargs):
    return fit_frozen_control(engine, snapshot, document, expected_digest=snapshot.sha256,
                              candidate_id="candidate-1", **kwargs)


def test_single_vowel_native_recovery_frozen_anatomy_and_hard_budget():
    with Engine() as engine:
        snapshot, document, truth = frozen_fixture(engine)
        before = deepcopy(document)
        frozen_bytes = snapshot.content
        engine.set_anatomy({"hard_palate_length": 4.6})
        saved = engine.anatomy()
        result = run_fit(engine, snapshot, document, budget=480)
        assert document == before and snapshot.content == frozen_bytes
        assert engine.anatomy() == saved
        assert result["frozen_anatomy"] == snapshot.data["candidates"][0]["anatomy"]
        assert result["native_forward_calls"] <= 480
        assert result["native_forward_calls"] == result["forward_evaluations"]+result["geometry_calls"]
        assert result["anatomy_optimized"] is False
        frames = result["attempts"][0]["frames"]
        errors = [abs(frame["state"]["JA"]-ja) for frame, ja in zip(frames, truth)]
        assert max(errors) < .02
        for frame in frames:
            state = frame["state"]
            assert state["spectral_rmse_db"] < .15
            assert len(state["native_controls"]) == engine.tract_count
            assert state["source_kind"] == "inferred_articulation"
            assert state["derived_model_id"] == snapshot.data["model_id"]
            assert state["snapshot_sha256"] == snapshot.sha256
            assert state["measurement_sigma_deg"] is None
        assert result["attempts"][0]["execution_status"] == "unsuccessful"


def test_budget_exhaustion_occlusion_and_failure_restore(monkeypatch):
    with Engine() as engine:
        snapshot, doc, _ = frozen_fixture(engine, occluded=True)
        doc["attempts"][0].pop("execution_status")
        doc["attempts"][0]["outcome"] = "unsuccessful"
        result = run_fit(engine, snapshot, doc, budget=25)
        assert result["native_forward_calls"] <= 25
        assert result["attempts"][0]["execution_status"] == "unsuccessful"
        assert result["attempts"][0]["frames"][1]["state"] is not None
        assert result["attempts"][0]["frames"][1]["measured_visible_geometry"] is None
        assert all(frame["state"]["termination"] == "budget_exhausted" for frame in result["attempts"][0]["frames"])
        with pytest.raises(ValueError, match="budget"):
            run_fit(engine, snapshot, doc, budget=24)
        saved = engine.anatomy()
        def failure(*args, **kwargs):
            raise RuntimeError("native spectrum failure")
        monkeypatch.setattr(engine, "spectrum", failure)
        with pytest.raises(RuntimeError, match="native spectrum failure"):
            run_fit(engine, snapshot, doc, budget=25)
        assert engine.anatomy() == saved


def test_snapshot_canonical_digest_full_anatomy_and_bounds():
    with Engine() as engine:
        snapshot, doc, _ = frozen_fixture(engine)
        with pytest.raises(ValueError, match="digest"):
            fit_frozen_control(engine, snapshot, doc, expected_digest="wrong", candidate_id="candidate-1")
        noncanonical = Artifact(json.dumps(snapshot.data, indent=2).encode())
        with pytest.raises(ValueError, match="canonical"):
            run_fit(engine, noncanonical, doc)
        changed = snapshot.data
        changed["candidates"][0]["anatomy"].pop("lip_width")
        partial = freeze_candidates(**{k: changed[k] for k in ("model_id", "evidence_ids", "provenance", "candidates", "frozen_at")})
        with pytest.raises(ValueError, match="all native anatomy"):
            run_fit(engine, partial, doc)
        for updates in ({"hard_palate_length": 9.}, {"pharynx_length": 3.5}):
            changed = snapshot.data; changed["candidates"][0]["anatomy"].update(updates)
            invalid = freeze_candidates(**{k: changed[k] for k in ("model_id", "evidence_ids", "provenance", "candidates", "frozen_at")})
            with pytest.raises(ValueError):
                run_fit(engine, invalid, doc)
        changed = snapshot.data; changed["provenance"] = {"unknown": True}
        invalid = freeze_candidates(**{k: changed[k] for k in ("model_id", "evidence_ids", "provenance", "candidates", "frozen_at")})
        with pytest.raises(ValueError, match="provenance"):
            run_fit(engine, invalid, doc)


def test_freeze_cutoff_evidence_lineage_and_held_out_values():
    with Engine() as engine:
        snapshot, doc, _ = frozen_fixture(engine)
        for mutate in (
            lambda d: d["attempts"][0].update(observed_at="2026-01-01T00:00:00Z"),
            lambda d: d["attempts"][0].update(observed_at="2026-01-02T00:00:00"),
            lambda d: d["attempts"][0]["frames"][0].update(audio_evidence_id="anatomy-training-1"),
            lambda d: d["attempts"][0]["frames"][1].update(timestamp_seconds=1.),
            lambda d: d["attempts"][0]["frames"][0].update(cue_id="wrong"),
            lambda d: d["attempts"][0]["frames"][0].update(evidence_id="contradictory-depth"),
        ):
            invalid = deepcopy(doc); mutate(invalid)
            with pytest.raises(ValueError):
                run_fit(engine, snapshot, invalid, budget=30)
        held = deepcopy(doc["attempts"][0]); held.update(attempt_id="held-attempt", split="held_out")
        for frame in held["frames"]:
            frame["id"] += "-held"
            frame["audio_evidence_id"] = "held-audio"
            frame["evidence_id"] = "held-depth"
            frame["geometry_observation"] = {"evidence_id": "held-depth", "value_m": "unread"}
            frame["magnitude_db"] = "unread"
        doc["attempts"].append(held)
        first = run_fit(engine, snapshot, doc, budget=30)
        held["frames"][0]["magnitude_db"] = [float("nan")]
        held["frames"][0]["geometry_observation"]["value_m"] = float("nan")
        repeat = run_fit(engine, snapshot, doc, budget=30)
        assert first == repeat
        assert all(f["state"] is None for f in repeat["attempts"][1]["frames"])
        held["frames"][0].pop("evidence_id")
        held["frames"][0]["geometry_observation"]["evidence_id"] = "new-depth-recording"
        with pytest.raises(ValueError, match="held-out capture evidence overlap"):
            run_fit(engine, snapshot, doc, budget=30)


def test_duplicate_depth_timing_and_control_model_binding():
    from singing_physics.control import fit_control_profile
    with Engine() as engine:
        snapshot, doc, _ = frozen_fixture(engine)
        duplicate = deepcopy(doc["attempts"][0]); duplicate["attempt_id"] = "duplicate-attempt"
        for frame in duplicate["frames"]:
            frame["id"] += "-duplicate"
            frame["audio_evidence_id"] = "different-audio"
            frame["geometry_observation"]["trial_id"] = frame["id"]
        repeated = deepcopy(doc); repeated["attempts"].append(duplicate)
        with pytest.raises(ValueError, match="Duplicate physical depth"):
            run_fit(engine, snapshot, repeated, budget=60)
        misaligned = deepcopy(doc)
        misaligned["attempts"][0]["frames"][0]["geometry_observation"]["timestamp_seconds"] += .1
        with pytest.raises(ValueError, match="alignment"):
            run_fit(engine, snapshot, misaligned, budget=30)
        result = run_fit(engine, snapshot, doc, budget=30)
        attempt = result["attempts"][0]
        state = attempt["frames"][-1]["state"]
        control = {"attempt_id": attempt["attempt_id"], "evidence_id": "selected-attempt-evidence",
            "cue_id": attempt["cue_id"], "cue_version": attempt["cue_version"], "context": attempt["context"],
            "mode": attempt["mode"], "observed_at": attempt["observed_at"], "comfortable": True,
            "sensor_status": "valid", "sensor_reason": None, "execution_status": attempt["execution_status"],
            **{key: state[key] for key in ("JA", "measurement_sigma_deg", "source_kind", "uncertainty_scope", "derived_model_id", "operator_id")}}
        profile = fit_control_profile([control], anatomy_model_id=result["model_id"], fitted_at="2026-01-03T00:00:00Z")
        assert profile["anatomy_model_id"] == snapshot.data["model_id"]
        with pytest.raises(ValueError):
            fit_control_profile([control], anatomy_model_id="different-model", fitted_at="2026-01-03T00:00:00Z")
