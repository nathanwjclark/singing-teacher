import json
import subprocess
import sys

import numpy as np
import pytest
from scipy.io import wavfile

from singing_physics.engine import Engine, digest


def test_anatomy_lifecycle_and_nonaccumulating_updates():
    # A subprocess turns the upstream heap-corruption regression into a test failure.
    result = subprocess.run([sys.executable, "-c", """
from singing_physics.engine import Engine
for _ in range(4):
    with Engine() as e:
        e.set_anatomy({'hard_palate_length': 4.4, 'pharynx_length': 6.7})
        e.spectrum('a')
        e.set_anatomy({})
        assert abs(e.anatomy()['hard_palate_length'] - 4.7) < 1e-8
"""], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr


def test_state_ownership_and_closed_engine():
    with Engine() as engine:
        with pytest.raises(RuntimeError, match="process-global"):
            Engine()
    with pytest.raises(RuntimeError, match="closed"):
        engine.spectrum("a")
    with Engine():
        pass


def test_reject_invalid_controls_without_changing_anatomy():
    with Engine() as e:
        baseline = e.anatomy()
        for bad in [{"missing": 1}, {"palate_depth": float("nan")}, {"pharynx_length": 3.5}, {"lip_width": 20}, {"lip_width": True}]:
            with pytest.raises(ValueError):
                e.set_anatomy(bad)
            assert e.anatomy() == baseline
        with pytest.raises(ValueError, match="Unknown pose"):
            e.spectrum("not-a-vowel")
        with pytest.raises(ValueError, match="power of two"):
            e.spectrum("a", bins=1000)


def test_forward_exports_share_parameters_and_provenance(tmp_path):
    destination = tmp_path / "forward"
    with Engine() as e:
        record = e.export(destination, anatomy={"hard_palate_length": 4.4}, duration_s=.15)
        assert record["anatomy"]["hard_palate_length"] == pytest.approx(4.4)
        for name, expected in record["files"].items():
            assert digest(destination/name) == expected
        rate, audio = wavfile.read(destination/"audio.wav")
        assert rate == e.sample_rate and audio.shape == (round(.15*rate),)
        assert np.isfinite(audio).all() and np.std(audio) > 1e-5
        assert "<svg" in (destination/"tract.svg").read_text()
        geometry = json.loads((destination/"geometry.json").read_text())
        assert len(geometry["area_cm2"]) == e.tube_count
        assert min(geometry["area_cm2"]) >= 0
        with pytest.raises(ValueError, match="already exists"):
            e.export(destination)


def test_anatomical_perturbation_changes_spectrum_and_returns_to_baseline():
    with Engine() as e:
        e.set_anatomy({})
        _, original, _ = e.spectrum("a")
        e.set_anatomy({"hard_palate_length": 4.2})
        _, changed, _ = e.spectrum("a")
        assert np.linalg.norm(original-changed) > 1
        e.set_anatomy({})
        np.testing.assert_allclose(e.spectrum("a")[1], original, atol=1e-9)


def test_synthesis_preserves_anatomy_and_responds_to_controls():
    with Engine() as e:
        e.set_anatomy({'hard_palate_length': 4.3})
        anatomy = e.anatomy()
        first = e.synthesize('a', duration_s=.1)
        repeat = e.synthesize('a', duration_s=.1)
        assert first.dtype == np.float64
        assert first.shape == (round(.1 * e.sample_rate),)
        np.testing.assert_allclose(repeat, first, atol=1e-12, rtol=0)
        changed_pitch = e.synthesize('a', f0_hz=220, duration_s=.1)
        changed_lips = e.synthesize('a', {'LD': 1.}, duration_s=.1)
        assert np.linalg.norm(changed_pitch-first) > 1e-3
        assert np.linalg.norm(changed_lips-first) > 1e-3
        assert e.anatomy() == anatomy
        e.set_anatomy({})
        changed_anatomy = e.synthesize('a', duration_s=.1)
        assert np.linalg.norm(changed_anatomy-first) > 1e-3


def test_synthesis_validation_and_failed_export_restore_state(tmp_path):
    with Engine() as e:
        e.set_anatomy({'hard_palate_length': 4.3})
        before = e.anatomy()
        for kwargs in [{'f0_hz': True}, {'duration_s': float('nan')}, {'duration_s': .01},
                       {'articulation': []}, {'articulation': {'LD': float('inf')}},
                       {'pose': []}, {'f0_hz': 10000}]:
            with pytest.raises(ValueError):
                e.synthesize(**{'pose': 'a', **kwargs})
            assert e.anatomy() == before
        with pytest.raises(ValueError):
            e.export(tmp_path/'invalid', anatomy={'hard_palate_length': 4.6}, pose='invalid')
        assert e.anatomy() == before
        assert not (tmp_path/'invalid').exists()
        record = e.export(tmp_path/'current', duration_s=.1)
        assert record['anatomy'] == before
        assert e.anatomy() == before
    with pytest.raises(RuntimeError, match='closed'):
        e.synthesize('a')


def test_geometry_matches_current_anatomy_and_is_independent_of_call_order():
    with Engine() as e:
        e.set_anatomy({'hard_palate_length': 4.3})
        before = e.geometry('a', {'LD': 1.})
        assert before['anatomy'] == e.anatomy()
        assert len(before['length_cm']) == e.tube_count
        assert all(x > 0 for x in before['length_cm'])
        assert before['incisor_position_cm'] > 0
        e.spectrum('i')
        assert e.geometry('a', {'LD': 1.}) == before
        assert e.geometry('i')['area_cm2'] != before['area_cm2']


def test_manifest_mismatch_rejected_before_native_initialization(tmp_path, monkeypatch):
    import singing_physics.engine as module
    original = module.BUILD
    manifest = json.loads((original/'manifest.json').read_text())
    (tmp_path/'source').symlink_to(original/'source', target_is_directory=True)
    monkeypatch.setattr(module, 'BUILD', tmp_path)
    for key in ('patch_sha256', 'library_sha256'):
        changed = {**manifest, key: '0'*64}
        (tmp_path/'manifest.json').write_text(json.dumps(changed))
        with pytest.raises(RuntimeError, match='differs from the build manifest'):
            Engine()
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    with Engine() as e:
        assert e.sample_rate > 0
