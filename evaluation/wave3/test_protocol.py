"""Protocol-integrity checks for revision 2; the native corpus runs once separately, not per test."""
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np
import pytest

from singing_physics.pcm_inverse import extract_pcm, observation_target
from singing_physics.pcm_spectral import COARSE_OBJECTIVE, SPECTRAL_OBJECTIVE, extract_spectral

spec = importlib.util.spec_from_file_location('wave3_run', Path(__file__).with_name('run.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
P = json.loads(m.PROTOCOL_PATH.read_text())


def test_revision_one_protocol_and_results_are_unchanged():
    first = json.loads(Path(__file__).with_name('protocol.json').read_text())
    report = json.loads((Path(__file__).parent/'results/first-report.json').read_text())
    assert m.digest(first) == report['protocol_sha256']
    assert first['version'] == 'wave3-independent-1' and P['version'] == 'wave3-independent-2'


def test_budget_grid_and_targets_are_declared_and_disjoint():
    members = m.candidates(P)
    poses = [*P['calibration_poses'], *P['heldout_poses']]
    assert P['hard_synthesis_limit'] == len(members)*len(poses)+len(m.GROUPS)*len(poses) == 40
    assert not set(P['calibration_poses']) & set(P['heldout_poses']) and len(P['heldout_poses']) == 3
    grid = [c['anatomy'] for c in members]
    assert P['generating_anatomy'] not in grid and P['outside_anatomy'] not in grid
    assert members[-1]['anatomy'] == {'hard_palate_length': 4.22, 'lip_width': .8} and members[-1]['PS'] == members[0]['PS']
    assert m.nearest(P, P['generating_anatomy'], P['generating_source_skew']) == 'anatomy-0-source-0'
    assert m.nearest(P, P['outside_anatomy'], P['generating_source_skew']) == 'anatomy-1-source-0'
    assert set(P['evaluable_cases']) < set(P['cases'])


def test_stress_transform_is_deterministic_retains_missing_and_original():
    original = (np.sin(np.arange(4096)*.1)*.1).astype('<f4')
    saved = original.copy()
    for case in P['cases']:
        a = m.transformed(original, case, 'o', P)
        np.testing.assert_array_equal(a, m.transformed(original, case, 'o', P))
        assert a.dtype == np.dtype('<f4') and a.shape == original.shape and np.isfinite(a).all()
    np.testing.assert_array_equal(original, saved)
    assert not np.any(m.transformed(original, 'all-missing', 'e', P))
    noise = m.transformed(original, 'noise', 'u', P)-original
    snr = 20*np.log10(np.sqrt(np.mean(original**2))/np.sqrt(np.mean(noise**2)))
    assert snr == pytest.approx(P['stress']['noise_snr_db'], abs=.3)
    with pytest.raises(ValueError):
        m.transformed(original, 'unknown', 'a', P)


def test_gains_come_from_bank_peaks_and_level_jumps_are_flagged():
    loud, quiet = np.full(8, .5), np.full(8, .5e-2)
    native = {f'anatomy-{i}-source-{j}': {pose: (loud if i == 0 else quiet)*(j+1) for pose in [*P['calibration_poses'], *P['heldout_poses']]}
              for i in range(2) for j in range(2)}
    gains = m.pose_gains(native, P)
    assert all(g == pytest.approx(10**(-12/20)) for g in gains.values())  # loudest peak 1.0 -> -12 dBFS
    levels = m.level_jumps(native, P)
    assert levels['e']['neighbour_anatomy_difference_db']['source-0'] == pytest.approx(40)
    assert levels['e']['flagged'] is True
    native = {c: {pose: loud for pose in v} for c, v in native.items()}
    assert m.level_jumps(native, P)['e']['flagged'] is False


def test_retained_set_uses_declared_margin_and_never_keeps_failures():
    margin = P['tie_margin_standardized_rms']
    assert m.retained([{'candidate_id': 'missing', 'mean_square': None}], margin) == []
    rows = [{'candidate_id': 'best', 'mean_square': 1.}, {'candidate_id': 'near', 'mean_square': 1.09**2},
            {'candidate_id': 'far', 'mean_square': 1.2**2}, {'candidate_id': 'failed', 'mean_square': None}]
    assert m.retained(rows, margin) == ['best', 'near']
    assert m.retained(rows[:1]+[{'candidate_id': 'alias', 'mean_square': 1.}], margin) == ['alias', 'best']


def test_harness_scores_with_the_production_fit_scorer():
    frame = (.05*np.sin(2*np.pi*180*np.arange(4096)/44100)*(1+.3*np.sin(2*np.pi*900*np.arange(4096)/44100))).astype('<f4')
    canonical = extract_pcm(frame, 44100, measurement_id='o', observation_id='o-observation', artifact_id='o-artifact')
    trial = {'id': 'o', 'sample_rate_hz': 44100, 'frame_start_sample': 0,
             'spectral_observation': extract_spectral(frame, 44100, source_artifact_id='o-artifact', source_artifact_hashes=[canonical['pcmFloat32Sha256']])}
    for objective in (COARSE_OBJECTIVE, SPECTRAL_OBJECTIVE):
        item = m.score_prediction(frame, trial, observation_target(canonical['measurement']), objective=objective, measurement_id='p')
        assert m.candidate_discrepancy([item], objective) == (0., [])


def test_future_runs_record_commit_dirty_state_and_scorer_pin():
    state = m.worktree()
    assert len(state['commit']) == 40 and isinstance(state['dirty'], bool)
    assert state['dirty'] == bool(state['changed_paths'])
    assert 'science/src/singing_physics/pcm_inverse.py' in m.SCORER_PIN['implementation_sha256']


def test_worktree_records_renames_and_paths_with_spaces(tmp_path):
    git = lambda *args: subprocess.run(['git', '-C', str(tmp_path), *args], check=True, capture_output=True)
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test User')
    (tmp_path/'old name.txt').write_text('x'); (tmp_path/'kept.txt').write_text('y')
    git('add', '.'); git('commit', '-qm', 'fixture')
    assert m.worktree(tmp_path)['dirty'] is False
    git('mv', 'old name.txt', 'new name.txt'); (tmp_path/'kept.txt').write_text('changed'); (tmp_path/'fresh "q".txt').write_text('z')
    state = m.worktree(tmp_path)
    assert state['dirty'] is True
    assert {'status': 'R ', 'path': 'new name.txt', 'original_path': 'old name.txt'} in state['changed_paths']
    assert {'status': ' M', 'path': 'kept.txt'} in state['changed_paths']
    assert {'status': '??', 'path': 'fresh "q".txt'} in state['changed_paths']
