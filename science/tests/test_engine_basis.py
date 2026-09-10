import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.prediction import freeze_candidates, predict


def test_fresh_engine_matches_reapplied_frozen_anatomy():
    with Engine() as engine:
        anatomy = engine.anatomy()
        original = engine.spectrum('a', {'JA': -3.5}, bins=512)[1]
        waveform = engine.synthesize('a', {'JA': -3.5}, duration_s=.1)
        lip = engine.lip_markers('a', {'JA': -3.5})
        for values in ({'hard_palate_length': 4.3}, anatomy, {}, anatomy):
            engine.set_anatomy(values)
        np.testing.assert_allclose(engine.spectrum('a', {'JA': -3.5}, bins=512)[1], original, atol=1e-10, rtol=0)
        np.testing.assert_allclose(engine.synthesize('a', {'JA': -3.5}, duration_s=.1), waveform, atol=1e-12, rtol=0)
        assert engine.lip_markers('a', {'JA': -3.5}) == lip
        assert engine.provenance['geometry_basis'] == 'vtl-anatomy-params-reconstructed-v1'


def test_old_geometry_basis_cannot_silently_replay_as_new_basis():
    with Engine() as engine:
        old_provenance = dict(engine.provenance)
        old_provenance.pop('geometry_basis')
        snapshot = freeze_candidates(model_id='old-model', evidence_ids=['old-fit'],
            provenance=old_provenance, candidates=[{'candidate_id': 'old', 'anatomy': engine.anatomy()}],
            frozen_at='2026-01-01T00:00:00Z')
    with pytest.raises(ValueError, match='provenance'):
        predict(snapshot, expected_digest=snapshot.sha256, prediction_id='new-prediction',
                target_evidence_id='new-target', generated_at='2026-01-01T00:01:00Z',
                intervention={'kind': 'named_pose', 'pose': 'a'})
