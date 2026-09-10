"""Analytic checks of B's rigid estimate and explicit dynamic rejection paths."""
import ast
from pathlib import Path
import numpy as np
import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "review-dynamic-tongue.py"


def functions():
    tree = ast.parse(SCRIPT.read_text())
    names = {"rigid", "robust_rigid", "validate_annotations", "reject_tracking_frame", "sampled_points"}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert len(nodes) == len(names)
    namespace = {"np": np}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), "exec"), namespace)
    return namespace


def annotations():
    return {"seed_frame": 3, "face_regions_depth_xyxy": [[20, 20, 280, 150]],
        "mouth_exclusion_depth_xyxy": [100, 60, 200, 140],
        "tongue_seed_polygon_depth_xy": [[120, 80], [160, 80], [150, 120]], "visibility_review": {"3": True, "4": False}}


def test_rigid_motion_is_recovered_from_train_anchors_and_checked_on_unused_anchors():
    fn = functions()
    rng = np.random.default_rng(982)
    current = rng.uniform([-60, -50, 150], [60, 50, 250], (60, 3))
    angle = .18
    expected_rotation = np.array([[np.cos(angle), -np.sin(angle), 0], [np.sin(angle), np.cos(angle), 0], [0, 0, 1]])
    translation_mm = np.array([12., -7., 4.])
    reference = current @ expected_rotation.T + translation_mm
    ids = np.arange(60); train = ids[ids % 5 != 0]; held = ids[ids % 5 == 0]
    corrupted = reference[train].copy(); corrupted[::9] += [50, -80, 70]
    rotation, offset, inliers = fn["robust_rigid"](current[train], corrupted)
    assert inliers.sum() >= 40
    np.testing.assert_allclose(rotation, expected_rotation, atol=1e-12)
    np.testing.assert_allclose(offset, translation_mm, atol=1e-11)
    error = np.linalg.norm(current[held] @ rotation.T+offset-reference[held], axis=1)
    assert np.max(error) < 1e-10
    assert len(set(train) & set(held)) == 0
    assert fn["robust_rigid"](current[:11], reference[:11]) is None
    collinear = np.column_stack((np.arange(20)*5., np.zeros(20), np.zeros(20)))
    assert fn["robust_rigid"](collinear, collinear) is None


def test_rejected_tracking_frame_retains_identity_but_no_interpolated_surface():
    row = {"frame": 7, "seconds": .28, "head": {}, "tongue": {}}
    sample = functions()["reject_tracking_frame"](row, "forward flow unavailable")
    assert sample["frame"] == 7 and sample["seconds"] == .28
    assert sample["observed"] == sample["fitted"] == sample["faces"] == []
    assert row["head"]["valid"] is False and row["tongue"]["candidate_visible"] is False
    assert row["tongue"]["reason"] == "forward flow unavailable"


@pytest.mark.parametrize("change", [
    lambda a: a.update(mouth_exclusion_depth_xyxy=[20, 20, 40, 40]),
    lambda a: a.update(face_regions_depth_xyxy=[[-1, 10, 40, 40]]),
    lambda a: a.update(face_regions_depth_xyxy=[[1.5, 10, 40, 40]]),
    lambda a: a.update(tongue_seed_polygon_depth_xy=[[120, 80], [130, 80], [140, 80]]),
    lambda a: a.update(visibility_review={"3": "false"}),
    lambda a: a.update(visibility_review={"999": True}),
    lambda a: a.update(seed_frame=999),
])
def test_annotation_mask_and_review_integrity(change):
    annotation = annotations(); change(annotation)
    with pytest.raises(ValueError):
        functions()["validate_annotations"](annotation, [{"sequence": 3}, {"sequence": 4}])


def test_validation_precedes_anchor_mask_and_review_labels_are_only_read_after_tracking():
    tree = ast.parse(SCRIPT.read_text())
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    validator = next(n.lineno for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "validate_annotations")
    anchor = next(n.lineno for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "goodFeaturesToTrack")
    frame_loop = next(n for n in main.body if isinstance(n, ast.For) and isinstance(n.iter, ast.Call) and isinstance(n.iter.func, ast.Name) and n.iter.func.id == "enumerate")
    review_reads = [n.lineno for n in ast.walk(main) if isinstance(n, ast.Subscript)
                    and isinstance(n.slice, ast.Constant) and n.slice.value == "visibility_review"]
    assert validator < anchor < frame_loop.lineno
    assert review_reads and min(review_reads) > frame_loop.end_lineno
    functions()["validate_annotations"](annotations(), [{"sequence": 3}, {"sequence": 4}])


def test_sampled_point_units_are_millimeters_and_invalid_native_samples_stay_invalid():
    import base64
    from types import SimpleNamespace
    preview_path = SCRIPT.with_name("preview-native-depth.py")
    radial = next(n for n in ast.parse(preview_path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "radial")
    namespace = {"np": np, "base64": base64}
    exec(compile(ast.Module(body=[radial], type_ignores=[]), str(preview_path), "exec"), namespace)
    table = base64.b64encode(np.zeros(2, dtype="<f4").tobytes()).decode()
    calibration = {"intrinsic_reference_dimensions": [320, 180], "lens_distortion_center": [160, 90],
        "intrinsics_row_major": [[100, 0, 0], [0, 100, 0], [0, 0, 1]],
        "inverse_lens_distortion_table_base64": table}
    depth = np.full((180, 320), .2); depth[1, 1] = np.nan
    points, valid = functions()["sampled_points"](depth, np.array([[1, 1], [3, 3], [-1, 1]]),
        calibration, SimpleNamespace(radial=namespace["radial"]))
    np.testing.assert_allclose(points[0], [1, 1, 200])
    assert valid.tolist() == [True, False, False]
