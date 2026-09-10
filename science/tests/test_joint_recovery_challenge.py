import importlib.util
from pathlib import Path
import numpy as np
import pytest
from singing_physics.engine import Engine

spec = importlib.util.spec_from_file_location('joint_challenge', Path(__file__).parents[1]/'scripts/joint_recovery_challenge.py')
challenge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(challenge)


def test_observations_hide_generating_values_and_controls_vary():
    truth = challenge.generating_case(17, ['a', 'i', 'u', 'e'])
    assert len(set(truth['JA'].values())) == 4
    with Engine() as engine:
        document, applied = challenge.calibration_document(engine, truth, ['a', 'i', 'u'])
        assert all(set(row) == {'id', 'split', 'pose', 'frequency_hz', 'magnitude_db'} for row in document['observations'])
        assert 'anatomy' not in document and 'JA' not in document
        assert set(applied) == {'a', 'i', 'u'}
        assert all(np.isfinite(row['magnitude_db']).all() for row in document['observations'])


def test_bounded_replay_persists_fit_before_scoring_and_keeps_failures(tmp_path):
    config = {**challenge.PROTOCOL, 'case_seeds': [17], 'budget_per_model': 10,
              'starts': 1, 'hard_spectrum_limit': 66}
    result = challenge.run(tmp_path/'run', config)
    case = result['cases'][0]
    assert case['status'] == 'scored'
    assert case['reported_fit_spectrum_calls'] == 60
    assert result['actual_spectrum_calls'] == 66
    for name in ('joint', 'fixed_anatomy_baseline'):
        assert case['scores'][name]['residual_calls'] == 10
        assert 'budget_exhausted' in case['scores'][name]['all_terminations']
    assert (tmp_path/'run/case-0/frozen-fit.json').exists()
    with pytest.raises(FileExistsError):
        challenge.run(tmp_path/'run', config)
    failed = challenge.run(tmp_path/'failed', {**config, 'hard_spectrum_limit': 4})
    assert failed['cases'][0]['status'] == 'failed'
    assert 'hard spectrum budget' in failed['cases'][0]['error']
    assert failed['actual_spectrum_calls'] == 4
