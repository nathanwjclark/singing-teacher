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
