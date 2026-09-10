import copy

import pytest

from singing_physics.engine import Engine
from singing_physics.inverse import fit, make_observations


def test_recovery_uses_observations_not_ground_truth():
    with Engine() as e:
        truth = {"hard_palate_length": 4.42, "pharynx_length": 6.83}
        observations = make_observations(e, truth)
        assert "anatomy" not in observations and "truth" not in observations
        result = fit(e, observations, starts=4, seed=21)
        assert result["best"]["rmse_db"] < .05
        assert result["best"]["rmse_db"] < result["fixed_anatomy_rmse_db"] * .1
        for name, value in truth.items():
            assert result["best"]["anatomy"][name] == pytest.approx(value, abs=.015)
        assert len(result["candidates"]) == 4
        assert result["candidate_spread_is_calibrated_posterior"] is False


def test_reject_audio_and_corrupt_observations():
    with Engine() as e:
        with pytest.raises(ValueError, match="human audio"):
            fit(e, {"kind": "microphone_audio"})
        data = make_observations(e, {})
        bad = copy.deepcopy(data)
        bad["observations"][0]["magnitude_db"][0] = float("nan")
        with pytest.raises(ValueError, match="nonfinite"):
            fit(e, bad)
        bad = copy.deepcopy(data)
        bad["observations"][0]["frequency_hz"][0] += 1
        with pytest.raises(ValueError, match="Frequencies"):
            fit(e, bad)
        with pytest.raises(ValueError, match="starts"):
            fit(e, data, starts=0)
