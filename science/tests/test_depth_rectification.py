import base64
from dataclasses import replace
import numpy as np
import pytest
from observations.geometry.rectification import map_radial_points, rectify_depth_points
from observations.geometry.native_capture import read_native_capture
from test_native_capture_geometry import fixture as native_fixture


def encode(values):
    return base64.b64encode(np.asarray(values, dtype="<f4").tobytes()).decode()


def calibration(rectifying=(.25, .25), distorting=(-.2, -.2)):
    return {"intrinsic_reference_dimensions": [100, 80], "lens_distortion_center": [45, 35],
            "lens_distortion_table_base64": encode(distorting),
            "inverse_lens_distortion_table_base64": encode(rectifying)}


def test_relative_magnification_apple_formula_and_inverse_roundtrip():
    source = np.array([[45., 35.], [55., 40.], [20., 25.]])
    corrected = map_radial_points(source, calibration())
    np.testing.assert_allclose(corrected["points_reference_uv"], [45, 35]+(source-[45, 35])*1.25)
    reversed = map_radial_points(corrected["points_reference_uv"], calibration(), direction="distort")
    assert reversed["valid_mask"].all()
    np.testing.assert_allclose(reversed["points_reference_uv"], source, atol=2e-7)
    assert corrected["lut_field"] == "inverse_lens_distortion_table_base64"
    assert reversed["lut_field"] == "lens_distortion_table_base64"
    assert not corrected["points_reference_uv"].flags.writeable


def test_nonconstant_lut_interpolation_uses_farthest_corner_and_no_extrapolation():
    c = calibration(rectifying=(0., .1, .2))
    radius = np.linalg.norm([55, 45])
    points = [[45+radius/4, 35], [45+radius, 35], [45+radius+1, 35], [np.nan, 0]]
    result = map_radial_points(points, c)
    assert result["points_reference_uv"][0, 0] == pytest.approx(45+radius/4*1.05)
    assert result["points_reference_uv"][1, 0] == pytest.approx(45+radius*1.2)
    assert result["valid_mask"].tolist() == [True, True, False, False]
    assert np.isnan(result["points_reference_uv"][2:]).all()
    assert result["invalid_reasons"] == {"nonfinite_input": 1, "outside_calibrated_radius": 1}


def test_original_depth_rays_use_explicit_reference_scale_and_keep_holes(tmp_path):
    manifest, save = native_fixture(tmp_path)
    c = manifest["frames"][0]["calibration"]
    c.update(lens_distortion_table_base64=encode([0, 0]), inverse_lens_distortion_table_base64=encode([0, 0]))
    save()
    frame = read_native_capture(tmp_path).frames[0]
    source_bytes = (tmp_path / "depth.f32").read_bytes()
    result = rectify_depth_points(frame, depth_to_reference=np.diag([2, 2, 1]), reference_mapping_id="analytic-no-crop-scale2")
    assert result["pixels_depth_uv"].tolist() == [[0, 0], [1, 1]]
    np.testing.assert_allclose(result["points_camera_m"], [[-.0035, -.0035, .35], [.004, .004, .4]], atol=1e-8)
    assert result["valid_mask"].tolist() == [[True, False], [False, True]]
    assert result["joint_fusion_ready"] is False
    assert result["lineage"]["source_manifest_sha256"] == frame.readiness["manifest_sha256"]
    assert (tmp_path / "depth.f32").read_bytes() == source_bytes
    assert not result["points_camera_m"].flags.writeable
    shifted = rectify_depth_points(frame, depth_to_reference=np.array([[2, 0, .5], [0, 2, .5], [0, 0, 1]]), reference_mapping_id="analytic-half-pixel-offset")
    assert shifted["lineage"]["derivation_sha256"] != result["lineage"]["derivation_sha256"]
    assert shifted["points_camera_m"][0, 0] == pytest.approx(-.00175)


@pytest.mark.parametrize("table", [None, "", encode([0]), encode([np.nan, 0]), encode([-1, -1]), encode([0, -0.75])])
def test_missing_nonfinite_or_folding_lut_rejected(table):
    c = calibration(); c["inverse_lens_distortion_table_base64"] = table
    with pytest.raises(ValueError):
        map_radial_points([[45, 35]], c)


def test_filtered_relative_tampered_depth_and_outside_reference_handled(tmp_path):
    manifest, save = native_fixture(tmp_path)
    manifest["frames"][0]["calibration"]["inverse_lens_distortion_table_base64"] = encode([0, 0]); save()
    frame = read_native_capture(tmp_path).frames[0]
    with pytest.raises(ValueError, match="original artifact"):
        rectify_depth_points(replace(frame, depth_m=np.ones((2, 2), dtype="<f4")), depth_to_reference=np.eye(3), reference_mapping_id="test")
    for key, value in (("depth_filtered", True), ("depth_accuracy_label", "relative")):
        with pytest.raises(ValueError):
            rectify_depth_points(replace(frame, source_metadata={**frame.source_metadata, key:value}), depth_to_reference=np.eye(3), reference_mapping_id="test")
    result = rectify_depth_points(frame, depth_to_reference=np.array([[1, 0, 10], [0, 1, 10], [0, 0, 1]]), reference_mapping_id="outside")
    assert result["points_camera_m"].shape == (0, 3)
    assert result["rejected"]["outside_reference_image"] == 4
    with pytest.raises(ValueError, match="affine"):
        rectify_depth_points(frame, depth_to_reference=np.zeros((3, 3)), reference_mapping_id="test")
