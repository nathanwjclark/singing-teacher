"""Analytic audit of B's actual visible-patch fit and handoff boundaries."""
import ast
import hashlib
from pathlib import Path
import numpy as np
import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "fit-native-tongue.py"


def functions():
    tree = ast.parse(SCRIPT.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name in {"basis", "robust_fit", "select", "validate_regions"}]
    assert len(selected) == 4
    namespace = {"np": np}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SCRIPT), "exec"), namespace)
    return namespace


def regions():
    return {"reference_frame": 3, "tracking_template_xyxy": [40, 40, 70, 70],
            "regions_xyxy": {"mouth": [100, 70, 180, 140], "tongue": [120, 90, 150, 120], "cheek": [200, 80, 230, 110]}}


def test_curved_visible_patch_recovers_on_heldout_xy_and_coefficients_stay_frozen():
    fn = functions()
    x, y = np.meshgrid(np.linspace(-2, 2, 25), np.linspace(-2, 2, 25))
    xy = np.column_stack((x.ravel(), y.ravel()))
    design = fn["basis"](xy, np.zeros(2), np.ones(2))
    truth = np.array([150., .2, -.1, 1.5, .4, .8])
    measured = design @ truth
    measured[::25] += 20.
    coefficient = fn["robust_fit"](design, measured)
    plane = fn["robust_fit"](design[:, :3], measured)
    frozen = hashlib.sha256(coefficient.tobytes()).hexdigest()
    held_xy = np.random.default_rng(81).uniform(-1.8, 1.8, (300, 2))
    held_design = fn["basis"](held_xy, np.zeros(2), np.ones(2))
    target = held_design @ truth
    error = np.mean(np.abs(held_design @ coefficient-target))
    baseline = np.mean(np.abs(held_design[:, :3] @ plane-target))
    assert error < .15 and error < .1*baseline
    changed_target = target+10.
    assert np.mean(np.abs(held_design @ coefficient-changed_target)) > 9.
    assert hashlib.sha256(coefficient.tobytes()).hexdigest() == frozen


def test_conservative_mask_retains_holes_rejects_spikes_and_highlights():
    fn = functions()
    rgb = np.full((12, 12, 3), [120, 60, 60], dtype=np.uint8)
    depth = np.full((12, 12), .2)
    depth[4, 4] = np.nan
    depth[7, 7] = .25
    rgb[8, 4] = [250, 250, 250]
    before = depth.copy()
    mask, counts = fn["select"](rgb, depth, [1, 1, 11, 11], (0, 0))
    assert not mask[4, 4] and not mask[7, 7] and not mask[8, 4]
    assert counts["interior_pixels"] == 64
    np.testing.assert_array_equal(depth, before)
    assert not mask[1].any() and not mask[:, 1].any()


@pytest.mark.parametrize("field", ["tracking_template_xyxy", "cheek"])
def test_tongue_cannot_be_its_own_nuisance_registration_anchor(field):
    annotation = regions()
    if field == "tracking_template_xyxy":
        annotation[field] = [125, 95, 145, 115]
    else:
        annotation["regions_xyxy"][field] = [125, 95, 145, 115]
    with pytest.raises(ValueError, match="overlaps evaluated tongue"):
        functions()["validate_regions"](annotation, [{"sequence": 3}])


@pytest.mark.parametrize("bad", [[0, 0, 10, 10], [30, 30, 400, 50], [40., 40, 70, 70], [True, 40, 70, 70]])
def test_registration_bounds_and_coordinate_types_fail_before_fit(bad):
    annotation = regions(); annotation["tracking_template_xyxy"] = bad
    with pytest.raises(ValueError):
        functions()["validate_regions"](annotation, [{"sequence": 3}])


def test_region_validator_is_called_before_reference_fit_and_freeze_precedes_holdout():
    tree = ast.parse(SCRIPT.read_text())
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
    calls = [node for node in ast.walk(main) if isinstance(node, ast.Call)]
    validation = next(node.lineno for node in calls if isinstance(node.func, ast.Name) and node.func.id == "validate_regions")
    fits = [node.lineno for node in calls if isinstance(node.func, ast.Name) and node.func.id == "robust_fit"]
    freeze = next(node.lineno for node in calls if isinstance(node.func, ast.Attribute) and node.func.attr == "write_text")
    evaluation = next(node.lineno for node in ast.walk(main) if isinstance(node, ast.For)
                      and isinstance(node.iter, ast.Name) and node.iter.id == "frames")
    assert len(fits) == 2 and validation < min(fits) <= max(fits) < freeze < evaluation
    functions()["validate_regions"](regions(), [{"sequence": 3}])
    with pytest.raises(ValueError, match="Reference frame"):
        functions()["validate_regions"](regions(), [{"sequence": 4}])
