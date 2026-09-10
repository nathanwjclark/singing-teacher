import hashlib
import json
import numpy as np
import pytest
from observations.geometry.native_capture import read_native_capture


def fixture(tmp_path):
    def artifact(name, raw):
        (tmp_path / name).write_bytes(raw)
        return {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    t = lambda n: {"value": n, "timescale": 1000, "epoch": 0, "flags": 1, "seconds": n/1000}
    row = {"id": "frame-0", "sequence": 0, "capture_clock_timestamp": t(1000), "depth_timestamp": t(1000),
        "depth": artifact("depth.f32", np.array([.35, np.nan, 0, .4], dtype="<f4").tobytes()),
        "depth_dropped": False, "depth_dimensions": [2, 2], "depth_unit": "m",
        "depth_storage": "row-major-little-endian-float32-packed", "depth_filtered": False,
        "depth_accuracy_label": "absolute", "calibration": {
            "intrinsics_row_major": [[100, 0, 1], [0, 100, 1], [0, 0, 1]],
            "intrinsic_reference_dimensions": [4, 4],
            "extrinsics_3x4_row_major": [[1, 0, 0, 50], [0, 1, 0, 0], [0, 0, 1, 0]],
            "pixel_size_mm": .01, "lens_distortion_center": [2, 2],
            "lens_distortion_table_base64": None, "inverse_lens_distortion_table_base64": None}}
    manifest = {"schema_version": "singing-native-rgbd-1.0.0", "capture_mode": "one-held-pose",
        "capture_id": "software-fixture", "device": {"device_type": "AVCaptureDeviceTypeBuiltInTrueDepthCamera",
        "position": "front", "output_mirrored": False}, "frames": [row],
        "audio": {"samples": [{"artifact": artifact("audio.pcm", b"\0\0\0\0")}]}}
    def save():
        (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    save()
    return manifest, save


def test_original_native_arrays_calibration_and_kit_lineage_are_preserved(tmp_path):
    manifest, _ = fixture(tmp_path)
    result = read_native_capture(tmp_path)
    frame = result.frames[0]
    np.testing.assert_allclose(frame.depth_m, [[.35, np.nan], [0, .4]], equal_nan=True)
    assert not frame.depth_m.flags.writeable
    assert frame.timestamp_seconds == 1.
    assert frame.timebase_id == "software-fixture/depth/synchronizer/epoch-0"
    assert frame.evidence_id == "software-fixture/artifact/depth.f32"
    assert len(result.artifacts) == 3
    assert frame.calibration == manifest["frames"][0]["calibration"]
    assert frame.readiness["positive_finite_pixels"] == 2
    assert frame.readiness["metric_points_ready"] is False
    assert frame.readiness["joint_fusion_ready"] is False
    assert frame.readiness["calibration_extrinsics_are_world_pose"] is False
    assert "native_distortion_not_rectified" in frame.readiness["blocking_reasons"]
    assert "absolute_sync_uncertainty_unknown" in frame.readiness["blocking_reasons"]


def test_missing_depth_calibration_and_relative_accuracy_are_explicit(tmp_path):
    manifest, save = fixture(tmp_path)
    row = manifest["frames"][0]
    row.update(calibration=None, depth_accuracy_label="relative", depth_filtered=True)
    save()
    reasons = read_native_capture(tmp_path).frames[0].readiness["blocking_reasons"]
    assert {"camera_calibration_missing", "absolute_depth_accuracy_not_declared", "filtered_depth_requires_measured_sample_mask"} <= set(reasons)
    row.pop("depth"); row["depth_dropped"] = True; save()
    frame = read_native_capture(tmp_path).frames[0]
    assert frame.depth_m is None and "depth_missing" in frame.readiness["blocking_reasons"]


@pytest.mark.parametrize("change", [
    lambda m: m["frames"][0].update(depth_unit="mm"),
    lambda m: m["frames"][0].update(depth_dimensions=[3, 3]),
    lambda m: m["frames"][0].update(depth_dropped=True),
    lambda m: m["frames"][0]["depth_timestamp"].update(flags=5),
    lambda m: m["frames"][0]["depth_timestamp"].update(seconds=2),
    lambda m: m["frames"][0]["depth_timestamp"].update(epoch=1),
    lambda m: m["frames"][0]["calibration"].update(intrinsics_row_major=[[1, 0], [0, 1]]),
    lambda m: m["frames"][0]["calibration"].update(lens_distortion_table_base64="not base64"),
    lambda m: m["device"].update(output_mirrored=True),
])
def test_invalid_depth_metadata_fails_closed(tmp_path, change):
    manifest, save = fixture(tmp_path)
    change(manifest); save()
    with pytest.raises(ValueError):
        read_native_capture(tmp_path)


def test_all_original_artifacts_are_hash_verified_not_only_depth(tmp_path):
    fixture(tmp_path)
    (tmp_path / "audio.pcm").write_bytes(b"xxxx")
    with pytest.raises(ValueError, match="hash"):
        read_native_capture(tmp_path)


def test_path_escape_symlink_duplicate_json_and_size_limits(tmp_path):
    manifest, save = fixture(tmp_path)
    manifest["frames"][0]["depth"]["path"] = "../depth.f32"; save()
    with pytest.raises(ValueError, match="safe local"):
        read_native_capture(tmp_path)
    manifest["frames"][0]["depth"]["path"] = "depth.f32"; save()
    (tmp_path / "depth.f32").unlink()
    (tmp_path / "depth.f32").symlink_to(tmp_path / "audio.pcm")
    with pytest.raises(OSError):
        read_native_capture(tmp_path)
    with pytest.raises(ValueError, match="limit"):
        read_native_capture(tmp_path, max_bytes=1)
    (tmp_path / "manifest.json").write_text('{"schema_version":1,"schema_version":2}')
    with pytest.raises(ValueError, match="duplicate"):
        read_native_capture(tmp_path)


def test_depth_clock_cannot_reverse_behind_increasing_capture_callbacks(tmp_path):
    from copy import deepcopy
    manifest, save = fixture(tmp_path)
    second = deepcopy(manifest["frames"][0])
    second.update(sequence=1, id="frame-1")
    second["capture_clock_timestamp"].update(value=1100, seconds=1.1)
    second["depth_timestamp"].update(value=900, seconds=.9)
    manifest["frames"].append(second); save()
    with pytest.raises(ValueError, match="depth clock reversed"):
        read_native_capture(tmp_path)
