from copy import deepcopy

import pytest

from singing_physics.engine import Engine
from singing_physics.joint import fit_joint
from test_joint import observations


def test_calibration_cannot_reuse_held_out_geometry_evidence():
    with Engine() as engine:
        document = observations(engine)
        calibration = {"kind": "visible_lip_distance", "split": "calibration",
            "operator_id": "vtl-upper4-lower5-vertex89-distance-v1", "trial_id": "a",
            "evidence_id": "depth-a", "timebase_id": "clock", "correspondence_id": "lip-v1",
            "uncertainty_scope": "synthetic", "timestamp_seconds": 1.,
            "sync_uncertainty_seconds": .001, "value_m": .01, "sigma_m": .001,
            "model_sigma_m": .001, "pixels_uv": [[0., 0.], [1., 0.]]}
        document["observations"][0].update(timestamp_seconds=1., timebase_id="clock", sync_uncertainty_seconds=.001)
        document["geometry_observations"] = [calibration]
        held = deepcopy(calibration)
        held["split"] = "held_out"
        document["geometry_observations"].append(held)
        with pytest.raises(ValueError, match="held-out geometry evidence"):
            fit_joint(engine, document, budget_per_model=10, starts=1)
