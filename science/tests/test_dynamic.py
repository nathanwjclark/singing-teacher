from copy import deepcopy

import numpy as np
import pytest

from singing_physics.dynamic import KIND, fit_dynamic
from singing_physics.joint import observed_landmarks
from singing_physics.engine import Engine


def dynamic_document(engine, *, occluded=False, neutral=False):
    from observations.geometry.depth import DepthFrame
    from observations.geometry.motion import MotionFrame, analyze_motion
    saved = engine.anatomy()
    captured, audio = [], {}
    try:
        engine.set_anatomy({"hard_palate_length": 4.50, "pharynx_length": 6.60})
        for i, (pose, ja, timestamp) in enumerate(zip(("a", "i", "a"),
                (-2.9, -2.9 if neutral else -3.5, -2.9), (1., 1.05, 1.3))):
            identity = f"frame-{i}"
            hz, spectrum, _ = engine.spectrum(pose, overrides={"JA": ja}, bins=512)
            mask = (hz >= 100) & (hz <= 6000)
            audio[identity] = {"audio_evidence_id": f"audio-{i}", "pose": pose,
                "frequency_hz": hz[mask].tolist(), "magnitude_db": spectrum[mask].tolist()}
            distance = engine.lip_markers(pose, articulation={"JA": ja})["distance_m"]
            depth = DepthFrame(evidence_id=f"depth-{i}", timebase_id="session-clock",
                timestamp_seconds=timestamp, depth=np.full((1, 2), .5),
                intrinsics=np.diag([.5/distance, .5/distance, 1.]), world_from_camera=np.eye(4),
                units="m", rectified=True, depth_sigma_m=.0001, pixel_sigma=.01,
                visible_mask=np.full((1, 2), not (occluded and i == 1), dtype=bool),
                sync_uncertainty_seconds=.001)
            captured.append(MotionFrame(identity, depth, np.eye(4), f"head-{i}",
                {"upper_lip": {"pixel_uv": [0, 0], "correspondence_id": "upper-v1"},
                 "lower_lip": {"pixel_uv": [1, 0], "correspondence_id": "lower-v1"}},
                head_pose_rigid_reference_ids=("rigid-reference-1",)))
    finally:
        engine.set_anatomy(saved)
    attempt = analyze_motion(captured, attempt_id="attempt-1", cue_id="cue-1", cue_version="1",
        context_id="context-1", context={"pitch_hz": 160., "vowel": "a-i-a", "level": "easy", "posture": "seated"},
        split="calibration", expected_correspondence={"upper_lip": "upper-v1", "lower_lip": "lower-v1"},
        outcome="unsuccessful" if neutral else "completed", lip_correspondence_id="native-lip-protocol-v1",
        lip_model_sigma_m=.002)
    attempt.update(cue_delivered_seconds=.9, actual_onset_seconds=1.05 if not neutral else None)
    for row in attempt["frames"]:
        row.update(audio[row["id"]])
    return {"schema_version": "0.1.0", "kind": KIND, "sample_rate_hz": engine.sample_rate,
        "spectrum_bins": 512, "provenance": deepcopy(engine.provenance), "max_gap_seconds": .1,
        "attempts": [attempt]}


def test_motion_depth_and_native_spectra_enter_dynamic_likelihood():
    with Engine() as engine:
        doc = dynamic_document(engine)
        before = deepcopy(doc); anatomy = engine.anatomy()
        result = fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        assert doc == before and engine.anatomy() == anatomy
        frames = result["attempts"][0]["frames"]
        assert len(frames) == 3
        assert [f["gap_before"] for f in frames] == [False, False, True]
        assert [f["segment"] for f in frames] == [0, 0, 1]
        assert result["joint_fit"]["visible_geometry_measurement_count"] == 3
        assert result["joint_fit"]["geometry_calls"] == 3*result["joint_fit"]["residual_calls"]
        for frame in frames:
            assert frame["state"]["source_kind"] == "inferred_articulation"
            assert len(frame["state"]["native_controls"]) == engine.tract_count
            assert frame["state"]["measurement_sigma_deg"] is None
            assert frame["measurement_label"] == "observed_visible_distance"
            assert frame["observed_landmarks"]["upper_lip"]["visibility"] == "visible"
        assert result["attempts"][0]["cue_delivered_seconds"] != result["attempts"][0]["actual_onset_seconds"]
        assert result["physiological_limits_established"] is False
        assert result["prospective_prediction"] is False
        altered = deepcopy(doc)
        altered["attempts"][0]["frames"][1]["geometry_observation"]["value_m"] *= .5
        changed = fit_dynamic(engine, altered, budget_per_model=10, starts=1)
        assert changed["joint_fit"]["joint"]["best"]["objective"] != result["joint_fit"]["joint"]["best"]["objective"]


def test_occlusion_retains_audio_and_unsuccessful_attempt_does_not_command_state():
    with Engine() as engine:
        doc = dynamic_document(engine, occluded=True, neutral=True)
        doc["attempts"][0]["frames"][1]["geometry_observation"] = {"unread": float("nan")}
        result = fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        assert result["joint_fit"]["calibration_ids"] == ["frame-0", "frame-1", "frame-2"]
        assert result["joint_fit"]["visible_geometry_measurement_count"] == 2
        assert result["excluded_geometry"][0]["audio_retained"] is True
        assert result["attempts"][0]["frames"][1]["measurement"] is None
        assert result["attempts"][0]["execution_status"] == "unsuccessful"
        assert result["attempts"][0]["actual_onset_seconds"] is None
        changed_cue = deepcopy(doc); changed_cue["attempts"][0]["cue_id"] = "another-cue"
        repeat = fit_dynamic(engine, changed_cue, budget_per_model=10, starts=1)
        assert result["joint_fit"] == repeat["joint_fit"]


def test_metadata_validation_and_held_out_target_exclusion():
    with Engine() as engine:
        doc = dynamic_document(engine)
        for mutate in (
            lambda d: d["attempts"][0]["frames"][1].update(timestamp_seconds=.5),
            lambda d: d["attempts"][0]["frames"][1].update(cue_id="wrong"),
            lambda d: d["attempts"][0]["frames"][1].update(timebase_id="wrong"),
            lambda d: d["attempts"][0]["frames"][1].update(geometry_status="unknown"),
            lambda d: d["attempts"][0].update(cue_delivered_seconds=2.),
            lambda d: d["attempts"][0].update(actual_onset_seconds=3.),
            lambda d: d.update(max_gap_seconds=0),
        ):
            bad = deepcopy(doc); mutate(bad)
            with pytest.raises(ValueError):
                fit_dynamic(engine, bad, budget_per_model=10, starts=1)
        held = deepcopy(doc["attempts"][0]); held.update(attempt_id="held-attempt", split="held_out")
        for frame in held["frames"]:
            frame["id"] += "-held"
            frame["audio_evidence_id"] += "-held"
            frame["evidence_id"] += "-held"
            frame["magnitude_db"] = "never read"
            frame["geometry_observation"] = "never read"
        doc["attempts"].append(held)
        first = fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        held["frames"][0]["magnitude_db"] = [float("nan")]
        repeat = fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        assert first["joint_fit"] == repeat["joint_fit"]
        assert all(f["state"] is None for f in repeat["attempts"][1]["frames"])
        duplicate = deepcopy(doc)
        duplicate["attempts"][1]["frames"][0]["audio_evidence_id"] = "audio-0"
        with pytest.raises(ValueError, match="Duplicate physical audio"):
            fit_dynamic(engine, duplicate, budget_per_model=10, starts=1)
        reused_depth = deepcopy(doc)
        reused_depth["attempts"][1]["frames"][0]["evidence_id"] = "depth-0"
        with pytest.raises(ValueError, match="reuses held-out depth"):
            fit_dynamic(engine, reused_depth, budget_per_model=10, starts=1)
        inconsistent = deepcopy(doc)
        inconsistent["attempts"][1]["context"]["pitch_hz"] = 200.
        with pytest.raises(ValueError, match="inconsistent context"):
            fit_dynamic(engine, inconsistent, budget_per_model=10, starts=1)


def test_held_out_nested_depth_alias_and_conflicting_identity_are_rejected():
    with Engine() as engine:
        doc = dynamic_document(engine)
        held = deepcopy(doc["attempts"][0])
        held.update(attempt_id="held-alias", split="held_out")
        held["frames"] = [held["frames"][0]]
        held["actual_onset_seconds"] = None
        frame = held["frames"][0]
        frame.update(id="held-frame", audio_evidence_id="held-audio")
        frame.pop("evidence_id")
        frame["geometry_observation"].update(split="held_out", value_m="unread", sigma_m="unread")
        doc["attempts"].append(held)
        with pytest.raises(ValueError, match="reuses held-out depth"):
            fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        frame["evidence_id"] = "different-depth"
        with pytest.raises(ValueError, match="Conflicting top-level and nested"):
            fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        frame["geometry_observation"]["evidence_id"] = "different-depth"
        first = fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        frame["geometry_observation"].update(value_m=float("nan"), sigma_m=-1)
        repeat = fit_dynamic(engine, doc, budget_per_model=10, starts=1)
        assert first["joint_fit"] == repeat["joint_fit"]


def test_tongue_region_box_is_rejected_as_a_landmark_and_tip_landmarks_are_copied():
    tip = {"trackingMode": "tip", "x": .5, "y": .6, "lateral": .1, "lift": 0, "visibleFraction": 0}
    frame = {"landmarks": {"tongue": tip}}
    copied = observed_landmarks(frame)
    assert copied == {"tongue": tip} and copied["tongue"] is not tip
    assert observed_landmarks({}) == {}
    assert observed_landmarks({"landmarks": {"tongue": None}}) == {"tongue": None}
    for region in ({"trackingMode": "region", "box": [.3, .4, .7, .8], "confidence": .9, "observedAt": 1.},
                   {"tracking_mode": "region", "box": [.3, .4, .7, .8]}, {"box": [.3, .4, .7, .8]},
                   {**tip, "box": [.3, .4, .7, .8]}, {"trackingMode": "mask"}):
        with pytest.raises(ValueError, match="region box is not a landmark"):
            observed_landmarks({"landmarks": {"tongue": region}})
    for malformed in ({key: value for key, value in tip.items() if key != "trackingMode"}, {**tip, "x": 1.5},
                      {**tip, "lateral": None}, {**tip, "lift": True}, {**tip, "extension": float("nan")},
                      {**tip, "surface": []}, [tip], "tip"):
        with pytest.raises(ValueError, match="tongue landmark must be a tip observation"):
            observed_landmarks({"landmarks": {"tongue": malformed}})
    with pytest.raises(ValueError, match="must be a dictionary"):
        observed_landmarks({"landmarks": [tip]})
    with Engine() as engine:
        doc = dynamic_document(engine)
        doc["attempts"][0]["frames"][0]["landmarks"]["tongue"] = {"trackingMode": "region", "box": [.3, .4, .7, .8]}
        with pytest.raises(ValueError, match="region box is not a landmark"):
            fit_dynamic(engine, doc, budget_per_model=10, starts=1)
