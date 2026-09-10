from copy import deepcopy
import hashlib
import ast
import base64
from pathlib import Path
import numpy as np
import pytest
from observations.geometry.acceptance import assess_capture_targets
from observations.geometry.native_capture import read_native_capture
from observations.geometry.rectification import rectify_depth_points
from test_native_capture_geometry import fixture as native_fixture
from test_depth_rectification import encode


def setup(tmp_path, depths=(.5, .5, .5, .5)):
    manifest, save = native_fixture(tmp_path)
    raw = np.array(depths, dtype="<f4").tobytes()
    (tmp_path / "depth.f32").write_bytes(raw)
    manifest["frames"][0]["depth"].update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
    manifest["frames"][0]["calibration"].update(lens_distortion_table_base64=encode([0, 0]), inverse_lens_distortion_table_base64=encode([0, 0]))
    save()
    capture = read_native_capture(tmp_path)
    target = {"sequence": 0, "target_id": "analytic-plane", "reference_kind": "analytic_fixture",
        "reference_evidence_id": "independent-fixture-equation", "reference_protocol_id": "analytic-plane-v1",
        "reference_error_bound_m": 0., "pixels_depth_uv": [[0, 0], [1, 0], [0, 1], [1, 1]],
        "depth_to_reference": [[2, 0, 1], [0, 2, 1], [0, 0, 1]], "reference_mapping_id": "preview-half-pixel-v1",
        "target": {"kind": "camera_plane", "unit": "m", "unit_normal_camera": [0, 0, 1], "offset_m": .5}}
    annotation = {"schema_version": "native-target-diagnostic-0.1.0", "capture_id": capture.capture_id,
        "manifest_sha256": capture.manifest_sha256, "observations": [target],
        "tolerances": {"minimum_valid_fraction": .75, "maximum_absolute_median_m": .001, "maximum_p95_absolute_m": .002}}
    return manifest, save, annotation


def test_known_camera_plane_scores_without_fitting_or_claiming_sensor_noise(tmp_path):
    _, _, annotation = setup(tmp_path)
    before = deepcopy(annotation)
    result = assess_capture_targets(tmp_path, annotation)
    assert annotation == before
    assert result["all_within_declared_tolerances"] is True
    assert result["observations"][0]["statistics"]["rms_residual_m"] == 0
    assert result["sensor_noise_calibrated"] is False
    assert result["physical_target_observation_count"] == 0
    assert result["physiological_fusion_accepted"] is False


def test_bias_outlier_and_holes_remain_visible_in_robust_statistics(tmp_path):
    _, _, annotation = setup(tmp_path, (.51, .51, .7, np.nan))
    result = assess_capture_targets(tmp_path, annotation)
    row = result["observations"][0]
    assert row["valid_fraction"] == .75
    assert row["statistics"]["median_signed_residual_m"] == pytest.approx(.01, abs=1e-7)
    assert row["statistics"]["p95_absolute_residual_m"] > .15
    assert row["within_declared_tolerances"] is False
    assert row["statistics"]["median_absolute_deviation_m"] == 0


def test_known_endpoint_distance_has_separate_measurement_and_no_filled_endpoint(tmp_path):
    _, _, annotation = setup(tmp_path)
    row = annotation["observations"][0]
    row["pixels_depth_uv"] = [[0, 0], [1, 0]]
    row["target"] = {"kind": "endpoint_distance", "unit": "m", "distance_m": .01}
    result = assess_capture_targets(tmp_path, annotation)
    assert result["observations"][0]["statistics"]["median_signed_residual_m"] == pytest.approx(0)
    _, _, annotation = setup(tmp_path, (.5, np.nan, .5, .5))
    annotation["observations"][0].update(pixels_depth_uv=[[0, 0], [1, 0]], target=row["target"])
    result = assess_capture_targets(tmp_path, annotation)
    assert result["observations"][0]["statistics"] is None
    assert result["observations"][0]["within_declared_tolerances"] is False


def test_missing_depth_stays_unavailable(tmp_path):
    manifest, save, annotation = setup(tmp_path)
    manifest["frames"][0].pop("depth"); manifest["frames"][0]["depth_dropped"] = True; save()
    annotation["manifest_sha256"] = read_native_capture(tmp_path).manifest_sha256
    result = assess_capture_targets(tmp_path, annotation)
    assert result["observations"][0]["reason"] == "depth_or_calibration_missing"


@pytest.mark.parametrize("change", [
    lambda a: a.update(capture_id="wrong"), lambda a: a.update(manifest_sha256="wrong"),
    lambda a: a["observations"][0].update(pixels_depth_uv=[[0, 0], [0, 0]]),
    lambda a: a["observations"][0].update(pixels_depth_uv=[[20, 0]]),
    lambda a: a["observations"][0]["target"].update(unit_normal_camera=[0, 0, 2]),
    lambda a: a["observations"][0].update(reference_kind="fitted_from_this_depth"),
    lambda a: a["tolerances"].update(minimum_valid_fraction=1.1),
])
def test_invalid_or_unbound_annotations_rejected(tmp_path, change):
    _, _, annotation = setup(tmp_path); change(annotation)
    with pytest.raises(ValueError):
        assess_capture_targets(tmp_path, annotation)


def test_b_preview_projection_agrees_with_explicit_a_half_pixel_mapping(tmp_path):
    manifest, save, _ = setup(tmp_path)
    c = manifest["frames"][0]["calibration"]
    c.update(inverse_lens_distortion_table_base64=encode([.05, .08, .1]))
    save()
    frame = read_native_capture(tmp_path).frames[0]
    script = Path(__file__).resolve().parents[2] / "scripts" / "preview-native-depth.py"
    # Execute B's exact numerical functions without importing its optional Pillow UI dependency.
    functions = [node for node in ast.parse(script.read_text()).body
                 if isinstance(node, ast.FunctionDef) and node.name in {"radial", "project"}]
    assert len(functions) == 2
    namespace = {"np": np, "base64": base64}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(script), "exec"), namespace)
    b_points, _, _ = namespace["project"](frame.depth_m, frame.calibration)
    a = rectify_depth_points(frame, depth_to_reference=[[2, 0, 1], [0, 2, 1], [0, 0, 1]], reference_mapping_id="b-preview-half-pixel-policy")
    np.testing.assert_allclose(a["points_camera_m"], b_points.reshape(-1, 3), atol=1e-12)
    integer = rectify_depth_points(frame, depth_to_reference=np.diag([2, 2, 1]), reference_mapping_id="different-integer-center-policy")
    assert np.max(np.abs(integer["points_camera_m"]-a["points_camera_m"])) > .004


def test_private_cli_writes_actual_diagnostics_and_refuses_overwrite(tmp_path):
    import json
    import subprocess
    import sys
    _, _, annotation = setup(tmp_path)
    source = tmp_path / "annotations.json"; source.write_text(json.dumps(annotation))
    destination = tmp_path / "diagnostic.json"
    command = [sys.executable, "-m", "observations.geometry.acceptance", str(tmp_path), str(source), "--output", str(destination)]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(destination.read_text())["all_within_declared_tolerances"] is True
    assert destination.stat().st_mode & 0o777 == 0o600
    first = destination.read_bytes()
    retry = subprocess.run(command, capture_output=True, text=True)
    assert retry.returncode != 0 and destination.read_bytes() == first
