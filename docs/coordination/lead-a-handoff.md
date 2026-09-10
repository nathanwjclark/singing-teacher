# Lead A coordination

Starting integration commit: 48e39ae (tested backend foundation plus plan revision 5).
Lead A owns scientific physics, inference, geometry likelihood, job service and numerical forecasts. Lead B owns public contracts, capture, canonical audio features, application orchestration, independent evaluation, repository CI and final integration.

## Active ownership

| Ticket | Agent / branch | Exclusive implementation paths | Acceptance | Status |
|---|---|---|---|---|
| PHY-01 | a_forward / codex/a-forward | science/src/singing_physics/engine.py; science/scripts/build_native.py; science/tests/test_engine.py; science/FORWARD.md | Synthesis at current anatomy, reset, export and validation tests | running |
| GEO-01 | a_geometry / codex/a-geometry | observations/geometry/; science/tests/test_geometry.py; science/GEOMETRY.md | Calibrated visible points, uncertainty/masking, projection and missing depth | running; actual phone acceptance needs B |
| INV-01/FUSE-01 | a_inverse / codex/a-inverse | science/src/singing_physics/joint.py; science/tests/test_joint.py; science/JOINT_INFERENCE.md | Shared anatomy + bounded trial articulation, equal-flexibility baseline, explicit evidence profile | running; human acoustic input needs AUD-01 |
| PRED-01 | a_prediction / codex/a-prediction | science/src/singing_physics/prediction.py; science/tests/test_prediction.py; science/PREDICTION.md | Frozen candidate forecasts, supported controls, deterministic identity and disagreement | running |
| SVC-01 | A coordinator | science/src/singing_physics/service.py; science/tests/test_service.py; science/SERVICE.md | Process-isolated real jobs, cancellation/replay/idempotency and immutable artifacts | preparing contracts handoff |

Every lane has a separate worktree and returns a small commit. Agents do not merge their own work. Native build artifacts are shared read-only during development; native simulator instances run in separate processes. A owns science/pyproject.toml and scientific build dependencies. B maintains public contracts and repository integration.

## Requests for Lead B

1. Publish KIT-01 contract branch/commit and validation commands, especially observation, candidate, forecast, job and artifact schemas.
2. Publish AUD-01 feature definitions/extractor and concrete genuine engine/capture examples; transfer functions are not microphone spectra.
3. Capture handoff must identify axial depth versus range/disparity, rectification, intrinsics/extrinsics, units, visibility/confidence masks, source timestamps and synchronization uncertainty.
4. Provide the designated integration branch and request scientific review before merging numerical changes.

A will adapt internal executable profiles to B-owned contracts after receipt; no competing public contract package will be introduced. Human evidence gates remain unfinished until B provides actual phone captures and their validation.

## Scientific acceptance

The current tested baseline is direct same-simulator transfer recovery with known template articulation. Next tests vary articulation and challenge identifiability. Native parameter bounds are engine limits, not population priors. Geometry may constrain only measurements supported by a declared physical observation operator. No face-to-internal-anatomy equation is assumed. Synthetic success does not satisfy G3 or phone acceptance.
