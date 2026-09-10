from dataclasses import replace
import numpy as np
import pytest
from observations.geometry.depth import DepthFrame
from observations.geometry.motion import MotionFrame, analyze_motion, repeat_variability


def make_frame(index, pixel=1, *, transform=None, depth_missing=False, landmarks=True):
    transform = np.eye(4) if transform is None else transform
    depth = DepthFrame(evidence_id=f"depth-{index}", timebase_id="session", timestamp_seconds=index*.04,
        depth=None if depth_missing else np.full((1, 5), .5), intrinsics=np.diag([100., 100., 1.]),
        world_from_camera=transform, units="m", rectified=True, depth_sigma_m=.001,
        pixel_sigma=.1, sync_uncertainty_seconds=.001, missing_reason="sensor_dropout" if depth_missing else None)
    return MotionFrame(f"frame-{index}", depth, transform, f"pose-{index}",
        {"lip": {"pixel_uv": [pixel, 0], "correspondence_id": "lip-region-v1"}} if landmarks else {},
        head_pose_rigid_reference_ids=("rigid-calibration-target",))


def analyze(frames, **changes):
    kwargs = dict(attempt_id="attempt-1", cue_id="comfortable-vowel", cue_version="1", context_id="context-1",
                  context={"vowel": "a"}, split="calibration", expected_correspondence={"lip": "lip-region-v1"})
    return analyze_motion(frames, **{**kwargs, **changes})


def test_measured_head_translation_rotation_removed_and_articulation_retained():
    transform = np.array([[0., -1, 0, .2], [1, 0, 0, -.1], [0, 0, 1, .3], [0, 0, 0, 1]])
    fixed = analyze([make_frame(0), make_frame(1, transform=transform)])
    assert fixed["landmark_summaries"]["lip"]["observed_excursion_m"] == pytest.approx(0, abs=1e-12)
    articulated = analyze([make_frame(0), make_frame(1, pixel=3, transform=transform), make_frame(2)])
    assert articulated["landmark_summaries"]["lip"]["observed_excursion_m"] == pytest.approx(.01)
    assert articulated["landmark_summaries"]["lip"]["anatomical_maximum_estimated"] is False
    np.testing.assert_allclose(articulated["frames"][0]["landmarks"]["lip"]["covariance_head_m2"],
                               fixed["frames"][1]["landmarks"]["lip"]["covariance_head_m2"], atol=1e-15)


@pytest.mark.parametrize("middle", [make_frame(1, depth_missing=True), make_frame(1, landmarks=False),
    replace(make_frame(1), landmarks={"lip": {"pixel_uv": [2, 0], "correspondence_id": "different"}}),
    replace(make_frame(1), world_from_head=None, head_pose_evidence_id=None)])
def test_missing_occluded_or_inconsistent_region_never_fills_excursion(middle):
    result = analyze([make_frame(0), middle, make_frame(2, pixel=4)])
    summary = result["landmark_summaries"]["lip"]
    assert summary["observed_excursion_m"] is None
    assert len(summary["segments"]) == 2
    assert result["frames"][1]["landmarks"]["lip"]["reason"]


def test_gap_splits_segments_and_repeat_variability_keeps_failed_attempts():
    gap = analyze([make_frame(0), make_frame(1, pixel=2), make_frame(9, pixel=4)])
    assert gap["landmark_summaries"]["lip"]["observed_excursion_m"] is None
    assert gap["landmark_summaries"]["lip"]["segments"][0]["observed_excursion_m"] == pytest.approx(.005)
    first = analyze([make_frame(0), make_frame(1, pixel=3)], outcome="completed")
    second = analyze([make_frame(0), make_frame(1, pixel=2)], attempt_id="attempt-2", outcome="unsuccessful")
    gap["attempt_id"] = "attempt-3"
    stats = repeat_variability([first, second, gap], "lip")
    assert stats["sample_sd_m"] == pytest.approx(np.std([.01, .005], ddof=1))
    assert stats["unsuccessful_attempt_ids"] == ["attempt-2"]
    assert stats["excluded_incomplete_attempt_ids"] == ["attempt-3"]
    with pytest.raises(ValueError, match="duplicate"):
        repeat_variability([first, first], "lip")
    with pytest.raises(ValueError, match="context"):
        repeat_variability([first, {**second, "context_id": "other"}], "lip")


@pytest.mark.parametrize("frames", [
    [make_frame(0), make_frame(0)], [make_frame(1), make_frame(0)],
    [make_frame(0), replace(make_frame(1), depth_frame=replace(make_frame(1).depth_frame, timebase_id="other"))],
    [replace(make_frame(0), world_from_head=np.diag([2, 1, 1, 1]))],
    [replace(make_frame(0), head_pose_rigid_reference_ids=())],
    [replace(make_frame(0), head_pose_rigid_reference_ids=("lip",))],
])
def test_invalid_timing_and_head_registration_fail_closed(frames):
    with pytest.raises(ValueError):
        analyze(frames)


def test_dynamic_joint_bridge_uses_real_measured_endpoints_and_frame_identity():
    frame = make_frame(0)
    frame = replace(frame, landmarks={"upper_lip": {"pixel_uv": [0, 0], "correspondence_id": "upper-v1"},
                                    "lower_lip": {"pixel_uv": [2, 0], "correspondence_id": "lower-v1"}})
    missing = replace(make_frame(1, depth_missing=True), landmarks=frame.landmarks)
    result = analyze([frame, missing], expected_correspondence={"upper_lip": "upper-v1", "lower_lip": "lower-v1"},
                     lip_correspondence_id="outer-lip-pair-v1", lip_model_sigma_m=.002)
    measured = result["frames"][0]["geometry_observation"]
    assert measured["value_m"] == pytest.approx(.01)
    assert measured["trial_id"] == "frame-0"
    assert measured["evidence_id"] == "depth-0"
    assert measured["timebase_id"] == "session"
    assert result["frames"][0]["geometry_status"] == "visible"
    assert result["frames"][1]["geometry_status"] == "missing"
    assert result["frames"][1]["geometry_reason"]
    assert "geometry_observation" not in result["frames"][1]


def test_repeated_depth_is_not_relabelled_as_fresh_motion_evidence():
    second = replace(make_frame(1), depth_frame=replace(make_frame(1).depth_frame, evidence_id="depth-0"))
    with pytest.raises(ValueError, match="repeated depth"):
        analyze([make_frame(0), second])
