"""Native scoring isolation and artifact retention checks for the investigation."""
import hashlib
import importlib.util
from pathlib import Path

import pytest

from singing_physics.engine import Engine, write_json
from singing_physics.joint import fit_joint

SPEC = importlib.util.spec_from_file_location('uncertainty_challenge',
    Path(__file__).resolve().parents[1] / 'scripts/uncertainty_challenge.py')
challenge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(challenge)


def test_real_fit_must_be_saved_before_scoring_and_stays_unchanged(tmp_path):
    destination = tmp_path / 'fit.json'
    truth = {'hard_palate_length': 4.50, 'pharynx_length': 6.60}
    with pytest.raises(FileNotFoundError):
        challenge.score_saved_fit(destination, truth)
    with Engine() as engine:
        observations = challenge.observation_document(engine, truth)
        assert 'truth' not in observations and 'anatomy' not in observations
        fitted = fit_joint(engine, observations, budget_per_model=10, starts=1, seed=53)
    write_json(destination, fitted)
    raw = destination.read_bytes()
    scored = challenge.score_saved_fit(destination, truth)
    altered_truth_score = challenge.score_saved_fit(destination, {**truth, 'hard_palate_length': 4.0})
    assert scored['fit_sha256'] == altered_truth_score['fit_sha256'] == hashlib.sha256(raw).hexdigest()
    assert destination.read_bytes() == raw
    assert scored['absolute_error_cm'] != altered_truth_score['absolute_error_cm']
    assert scored['singleton_near_range_noninformative'] is True
    assert scored['multiple_near_small_range_large_error'] is False
    assert scored['spread_is_calibrated_posterior'] is False
    assert scored['spectrum_calls'] <= 60


def test_existing_investigation_output_is_never_overwritten(tmp_path):
    marker = tmp_path / 'preserved.json'
    marker.write_text('existing evidence')
    with pytest.raises(FileExistsError):
        challenge.run(tmp_path)
    assert marker.read_text() == 'existing evidence'
