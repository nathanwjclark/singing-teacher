"""Native-backed small budgets: never substitute a fake forward engine."""
import math

import pytest

from singing_physics.engine import Engine
from singing_physics.inverse import fit, make_observations


@pytest.mark.parametrize("budget", [3, 4, 6, 10, 51])
def test_hard_spectrum_budget_includes_baseline_and_returns_candidate(budget):
    with Engine() as engine:
        observations = make_observations(engine, {"hard_palate_length": 4.42, "pharynx_length": 6.83})
        result = fit(engine, observations, max_spectrum_evaluations=budget, seed=31)
        assert result["termination"] == "spectrum_budget_exhausted"
        assert result["spectrum_evaluations"] == budget // 3 * 3
        assert result["actual_forward_evaluations"] == result["spectrum_evaluations"]
        assert result["objective_evaluations"] * 3 == result["spectrum_evaluations"]
        assert result["baseline_spectrum_evaluations"] == 3
        assert result["optimization_spectrum_evaluations"] == result["spectrum_evaluations"] - 3
        assert result["candidates"]
        assert math.isfinite(result["best"]["rmse_db"])
        assert result["best"]["rmse_db"] <= result["fixed_anatomy_rmse_db"]
        assert result["candidate_spread_is_calibrated_posterior"] is False


def test_budget_rejection_and_reproducibility():
    with Engine() as engine:
        observations = make_observations(engine, {})
        for budget in [True, 2, 3.0, float("inf")]:
            with pytest.raises(ValueError, match="max_spectrum_evaluations"):
                fit(engine, observations, max_spectrum_evaluations=budget)
        first = fit(engine, observations, max_spectrum_evaluations=12, seed=9)
        second = fit(engine, observations, max_spectrum_evaluations=12, seed=9)
        assert first["best"] == second["best"]
        assert first["spectrum_evaluations"] == second["spectrum_evaluations"]


def test_budget_exhaustion_during_local_finite_differences(monkeypatch):
    import numpy as np
    from scipy.optimize import OptimizeResult
    import singing_physics.inverse as inverse

    # Control the optimizer handoff, while every scored spectrum remains native.
    def single_global_proposal(objective, bounds, **kwargs):
        point = np.array([.5, .5])
        objective(point)
        return OptimizeResult(x=point, nit=0, nfev=1, success=False)

    monkeypatch.setattr(inverse, "differential_evolution", single_global_proposal)
    with Engine() as engine:
        observations = make_observations(engine, {"hard_palate_length": 4.42})
        result = fit(engine, observations, max_spectrum_evaluations=9)
        assert result["termination"] == "spectrum_budget_exhausted"
        assert result["spectrum_evaluations"] == 9
        assert result["global_search"]["evaluations"] == 1
        assert result["best"]["optimizer_success"] is False
        assert math.isfinite(result["best"]["rmse_db"])
