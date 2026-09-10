import pytest

from singing_physics.identifiability import rank_interventions
from singing_physics.prediction import Artifact


def test_identifiability_rejects_tampered_or_leaking_snapshot():
    snapshot = Artifact(b'{"kind":"frozen_anatomy_articulation_hypotheses"}')
    with pytest.raises(ValueError, match="digest"):
        rank_interventions(snapshot, expected_digest="stale", ranking_id="r",
            target_evidence_id="heldout", generated_at="2026-01-02T00:00:00Z",
            interventions=[], noise_sigma_db=1., noise_assumption="synthetic")


def test_service_accepts_research_operation_shape_without_running_native_job(tmp_path):
    from singing_physics.service import JobService
    with JobService(tmp_path) as service:
        with pytest.raises(ValueError, match="Missing operation parameters"):
            service.submit({'operation': 'rank_interventions', 'parameters': {}},
                           idempotency_key='missing')
