from dataclasses import replace
import numpy as np
import pytest
from observations.geometry import DepthFrame, reconstruct, surface_distance, surface_residuals


def frame(**changes):
    values = dict(evidence_id="synthetic-depth-1", timebase_id="session-clock",
                  timestamp_seconds=2., depth=np.full((3, 3), 500.),
                  intrinsics=np.array([[100., 0, 1], [0, 100., 1], [0, 0, 1]]),
                  world_from_camera=np.eye(4), units="mm", rectified=True,
                  depth_sigma_m=.001, pixel_sigma=.1, sync_uncertainty_seconds=.002)
    values.update(changes)
    return DepthFrame(**values)


def test_known_target_scale_projection_covariance_and_rigid_transform():
    observation = reconstruct(frame())
    np.testing.assert_allclose(observation.points_m[4], [0, 0, .5])
    measurement = surface_distance(observation, [0, 1], [2, 1])
    assert measurement["value_m"] == pytest.approx(.01)
    assert measurement["sigma_m"] == pytest.approx(np.sqrt(2*(.0005**2 + .00001**2)))
    transform = np.array([[0., -1, 0, .2], [1, 0, 0, .3], [0, 0, 1, .4], [0, 0, 0, 1]])
    moved = reconstruct(frame(world_from_camera=transform))
    np.testing.assert_allclose(moved.points_m, observation.points_m @ transform[:3, :3].T + transform[:3, 3])
    assert surface_distance(moved, [0, 1], [2, 1])["value_m"] == pytest.approx(.01)
    np.testing.assert_allclose(moved.covariance_m2, transform[:3, :3] @ observation.covariance_m2 @ transform[:3, :3].T)
    metric = reconstruct(frame(depth=np.full((3, 3), .5), units="m"))
    np.testing.assert_array_equal(metric.points_m, observation.points_m)


def test_masks_leave_holes_and_preserve_evidence():
    depth = np.array([[np.nan, 0, 6000], [500, 500, 500], [500, 500, 500]])
    confidence = np.ones((3, 3)); confidence[1, 0] = .1
    visible = np.ones((3, 3), bool); visible[1, 1] = False
    measured = np.ones((3, 3), bool); measured[1, 2] = False
    observation = reconstruct(frame(depth=depth, confidence=confidence, visible_mask=visible, measured_mask=measured))
    assert observation.pixels_uv.tolist() == [[0, 2], [1, 2], [2, 2]]
    assert observation.rejection_reasons == dict(invalid_depth=2, outside_depth_range=1, low_confidence=1,
                                               outside_visible_region=1, unmeasured_or_filled=1)
    assert observation.evidence_id == "synthetic-depth-1"
    with pytest.raises(ValueError, match="no valid"):
        surface_distance(observation, [0, 0], [0, 2])


def test_clock_mapping_and_stale_depth_are_not_silently_fused():
    observation = reconstruct(frame(clock_scale=1.001, clock_offset_seconds=.1), reference_seconds=2.102)
    assert observation.timestamp_seconds == pytest.approx(2.102)
    assert len(observation.points_m) == 9
    stale = reconstruct(frame(), reference_seconds=2.019)
    assert len(stale.points_m) == 0
    assert stale.rejection_reasons == {"unsynchronized_frame": 9}
    uncertain = reconstruct(frame(sync_uncertainty_seconds=.1))
    assert uncertain.rejection_reasons == {"excessive_sync_uncertainty": 9}


def test_missing_and_all_invalid_depth_are_explicit_empty_observations():
    missing = reconstruct(frame(depth=None, missing_reason="sensor_unavailable"))
    assert missing.rejection_reasons == {"missing_depth": "sensor_unavailable"}
    empty = reconstruct(frame(depth=np.zeros((3, 3))))
    assert empty.points_m.shape == (0, 3)
    residual = surface_residuals(empty, np.empty((0, 3)), operator_id="visible-target-v1", model_sigma_m=.001)
    assert residual["residuals"].size == 0


@pytest.mark.parametrize("changes", [
    {"rectified": False}, {"representation": "disparity"}, {"units": "feet"},
    {"intrinsics": np.eye(2)}, {"world_from_camera": np.diag([2, 1, 1, 1])},
    {"confidence": np.full((3, 3), 2)}, {"visible_mask": np.ones((3, 3))},
    {"measured_mask": np.ones((2, 3), bool)}, {"depth_sigma_m": 0},
    {"pixel_sigma": -1}, {"sync_uncertainty_seconds": -1}, {"clock_scale": 0},
    {"timestamp_seconds": np.nan}, {"depth": None}, {"evidence_id": ""},
    {"depth": np.ones(3)}, {"missing_reason": "contradiction"},
])
def test_invalid_frames_fail_closed(changes):
    with pytest.raises(ValueError):
        reconstruct(frame(**changes))


def test_declared_surface_operator_whitens_in_physical_coordinates():
    observation = reconstruct(frame())
    exact = surface_residuals(observation, observation.points_m, operator_id="bench-plane-v1", model_sigma_m=.001)
    assert np.all(exact["residuals"] == 0)
    shifted = surface_residuals(observation, observation.points_m + [.001, 0, 0], operator_id="bench-plane-v1", model_sigma_m=.001)
    assert np.isfinite(shifted["residuals"]).all()
    assert shifted["residuals"].reshape(-1, 3)[4, 0] == pytest.approx(.001/np.sqrt(.001**2 + .0005**2))
    assert shifted["evidence_id"] == observation.evidence_id
    for predictions, identifier in ((np.ones((1, 3)), "operator"), (observation.points_m, "")):
        with pytest.raises(ValueError):
            surface_residuals(observation, predictions, operator_id=identifier, model_sigma_m=.001)
    with pytest.raises(ValueError):
        surface_distance(observation, [0, 0], [0, 0])
