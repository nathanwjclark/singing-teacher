"""Small protocol-integrity checks; native corpus is run once separately, not per test."""
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

spec = importlib.util.spec_from_file_location('wave3_run', Path(__file__).with_name('run.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def test_protocol_has_equal_compute_and_excludes_generating_anatomy():
    p = json.loads(m.PROTOCOL_PATH.read_text())
    count = len(p['candidate_anatomies'])*len(p['candidate_source_skews'])*3 + 3*3
    assert p['hard_synthesis_limit'] == count == 21
    assert p['generating_anatomy'] not in p['candidate_anatomies']
    assert p['outside_anatomy'] not in p['candidate_anatomies']
    assert p['heldout_pose'] not in p['calibration_poses']


def test_stress_transform_is_deterministic_retains_missing_and_original():
    p = json.loads(m.PROTOCOL_PATH.read_text())
    original = np.sin(np.arange(4096)*.1).astype('<f4')*.1
    saved = original.copy()
    for case in p['cases']:
        a = m.transformed(original, case, 'e', p)
        np.testing.assert_array_equal(a, m.transformed(original, case, 'e', p))
        assert a.dtype == np.dtype('<f4') and a.shape == original.shape
        assert np.isfinite(a).all()
    np.testing.assert_array_equal(original, saved)
    assert not np.any(m.transformed(original, 'all-missing', 'e', p))
    noise = m.transformed(original, 'noise', 'e', p)-original
    snr = 20*np.log10(np.sqrt(np.mean(original**2))/np.sqrt(np.mean(noise**2)))
    assert snr == pytest.approx(p['stress']['noise_snr_db'], abs=.3)


def test_indistinguishable_and_failed_candidates_do_not_create_unique_evidence():
    assert m.retained_minima([{'candidate_id': 'missing', 'mean_square': None}]) == []
    rows = [{'candidate_id': 'left', 'mean_square': 1.}, {'candidate_id': 'right', 'mean_square': 1.}]
    assert m.retained_minima(rows) == ['left', 'right']
    rows.append({'candidate_id': 'failed', 'mean_square': None})
    assert m.retained_minima(rows) == ['left', 'right']
