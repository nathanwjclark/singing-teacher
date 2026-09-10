import dataclasses
import json

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.prediction import Artifact, freeze_candidates, predict


@pytest.fixture
def frozen():
    with Engine() as engine:
        provenance = engine.provenance
    return freeze_candidates(model_id="model-test", evidence_ids=["fit-test"],
        provenance=provenance, frozen_at="2026-01-01T00:00:00Z", candidates=[
            {"candidate_id": "a", "anatomy": {"hard_palate_length": 4.3}},
            {"candidate_id": "b", "anatomy": {"hard_palate_length": 4.8}}])


def forecast(frozen, **overrides):
    args = dict(expected_digest=frozen.sha256, prediction_id="prediction-test",
        target_evidence_id="future-test", generated_at="2026-01-01T00:01:00Z",
        intervention={"kind": "named_pose", "pose": "a"}, bins=128)
    args.update(overrides)
    return predict(frozen, **args)


def test_native_forecast_is_deterministic_and_immutable(frozen, tmp_path):
    first = forecast(frozen)
    assert first == forecast(frozen)
    result = first.data
    assert len(result["frequency_hz"]) == 65
    assert result["disagreement"]["rms_population_sd_db"] > 0
    stack = np.array([c["magnitude_db"] for c in result["candidates"]])
    np.testing.assert_allclose(result["disagreement"]["population_sd_db"], stack.std(axis=0))
    result["model_id"] = "changed"
    assert first.data["model_id"] == "model-test"
    with pytest.raises(dataclasses.FrozenInstanceError):
        first.content = b"changed"
    destination = tmp_path / "prediction.json"
    first.write(destination)
    assert json.loads(destination.read_bytes())["target_evidence_id"] == "future-test"
    with pytest.raises(FileExistsError):
        first.write(destination)
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


@pytest.mark.parametrize("overrides", [
    {"expected_digest": "stale"}, {"target_evidence_id": "fit-test"},
    {"generated_at": "2025-01-01T00:00:00Z"},
    {"generated_at": "2026-01-01T00:00:00"},
    {"intervention": {"kind": "nasal_plugging", "pose": "a"}},
    {"intervention": {"kind": "named_pose", "pose": "nonexistent"}},
    {"intervention": {"kind": "named_pose", "pose": "a", "articulation": {"unknown": 1}}},
    {"intervention": {"kind": "named_pose", "pose": "a", "articulation": {"JA": float("nan")}}},
    {"intervention": {"kind": "named_pose", "pose": "a", "articulation": {"JA": 999}}},
])
def test_invalid_forecast_fails_cleanly(frozen, overrides):
    with pytest.raises(ValueError):
        forecast(frozen, **overrides)
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


def test_measured_repeat_variability_is_explicit(frozen):
    initial = forecast(frozen).data
    repeat = {"frequency_hz": initial["frequency_hz"], "sd_db": [1.] * 65,
              "evidence_ids": ["repeat-test"], "quantity": "tract_transfer_magnitude_db"}
    result = forecast(frozen, repeat_variability=repeat).data
    assert result["measured_repeat_variability"] == repeat
    assert len(result["disagreement"]["exceeds_measured_repeat_sd"]) == 65
    for bad in ({**repeat, "sd_db": [-1.] * 65}, {**repeat, "sd_db": [float("nan")] * 65},
                {**repeat, "frequency_hz": [0.]}, {**repeat, "evidence_ids": []},
                {**repeat, "evidence_ids": ["future-test"]}, {**repeat, "quantity": "microphone_db"}):
        with pytest.raises(ValueError):
            forecast(frozen, repeat_variability=bad)


def test_stale_provenance_and_unknown_anatomy(frozen):
    for mutation in ("provenance", "anatomy"):
        data = frozen.data
        if mutation == "provenance":
            data["provenance"]["library_sha256"] = "old"
        else:
            data["candidates"][0]["anatomy"] = {"unknown": 1.}
        snapshot = freeze_candidates(**{k: data[k] for k in (
            "model_id", "evidence_ids", "provenance", "candidates", "frozen_at")})
        with pytest.raises(ValueError):
            forecast(snapshot)


def test_empty_or_nonfinite_candidate_rejected(frozen):
    data = frozen.data
    base = {k: data[k] for k in ("model_id", "evidence_ids", "provenance", "candidates", "frozen_at")}
    for candidates in ([], [{"candidate_id": "a", "anatomy": {}}],
                       [{"candidate_id": "a", "anatomy": {"lip_width": float("nan")}}]):
        with pytest.raises(ValueError):
            freeze_candidates(**{**base, "candidates": candidates})


def test_bounded_intervention_and_malformed_artifacts(frozen):
    result = forecast(frozen, intervention={"kind": "named_pose", "pose": "a",
                                           "articulation": {"JA": -2.0}}).data
    assert all(c["articulation"]["JA"]["requested"] == -2.0 for c in result["candidates"])
    assert result["units"]["anatomy"]["hard_palate_length"] == "cm"
    for content in (b"[]", b"{}", b"not json"):
        invalid = Artifact(content)
        with pytest.raises(ValueError):
            forecast(invalid)
    with pytest.raises(ValueError):
        Artifact(bytearray(b"{}"))
