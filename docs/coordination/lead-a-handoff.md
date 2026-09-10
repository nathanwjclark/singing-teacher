# Lead A coordination

Starting integration commit: 48e39ae (tested backend foundation plus plan revision 5).
Lead A owns scientific physics, inference, geometry likelihood, job service and numerical forecasts. Lead B owns public contracts, capture, canonical audio features, application orchestration, independent evaluation, repository CI and final integration.

## Lane ownership

| Ticket | Agent / branch | Exclusive implementation paths | Acceptance | Status |
|---|---|---|---|---|
| PHY-01 | a_forward / codex/a-forward | science/src/singing_physics/engine.py; science/scripts/build_native.py; science/tests/test_engine.py; science/FORWARD.md | Synthesis at current anatomy, reset, export and validation tests | A reviewed; queued for B integration |
| GEO-01 | a_geometry / codex/a-geometry | observations/geometry/; science/tests/test_geometry.py; science/GEOMETRY.md | Calibrated visible points, uncertainty/masking, projection and missing depth | A reviewed; actual phone acceptance blocked on B |
| INV-01/FUSE-01 | a_inverse / codex/a-inverse | science/src/singing_physics/joint.py; science/tests/test_joint.py; science/JOINT_INFERENCE.md | Shared anatomy + bounded trial articulation, equal-flexibility baseline, explicit evidence profile | A reviewed; human acoustic input blocked on AUD-01 |
| PRED-01 | a_prediction / codex/a-prediction | science/src/singing_physics/prediction.py; science/tests/test_prediction.py; science/PREDICTION.md | Frozen candidate forecasts, supported controls, deterministic identity and disagreement | A reviewed; queued for B integration |
| SVC-01 | A coordinator | science/src/singing_physics/service.py; science/tests/test_service.py; science/SERVICE.md | Process-isolated real jobs, cancellation/replay/idempotency and immutable artifacts | A reviewed; public contract adapter blocked on KIT-01 |

Every lane used a separate worktree and returned small commits. Agents do not merge their own work. Native build artifacts are shared read-only during development; native simulator instances run in separate processes. A owns science/pyproject.toml and scientific build dependencies. Root owns final integration documentation and the scoped geometry license. B maintains public contracts and repository integration.

## Requests for Lead B

1. Publish KIT-01 contract branch/commit and validation commands, especially observation, candidate, forecast, job and artifact schemas.
2. Publish AUD-01 feature definitions/extractor and concrete genuine engine/capture examples; transfer functions are not microphone spectra.
3. Capture handoff must identify axial depth versus range/disparity, rectification, intrinsics/extrinsics, units, visibility/confidence masks, source timestamps and synchronization uncertainty.
4. Provide the designated integration branch and request scientific review before merging numerical changes.

A will adapt internal executable profiles to B-owned contracts after receipt; no competing public contract package will be introduced. Human evidence gates remain unfinished until B provides actual phone captures and their validation.

## Scientific acceptance

The current tested baseline is direct same-simulator transfer recovery with known template articulation. Next tests vary articulation and challenge identifiability. Native parameter bounds are engine limits, not population priors. Geometry may constrain only measurements supported by a declared physical observation operator. No face-to-internal-anatomy equation is assumed. Synthetic success does not satisfy G3 or phone acceptance.

## Reviewed implementation queue

[PR #3](https://github.com/nathanwjclark/singing-teacher/pull/3) contains the Lead A
queue, including PR #2's foundation and revision 5. It is a draft because the
cross-lead acceptance gates are unfinished. No A agent merged repository main.

- PHY-01: certified native binary, strict controls, repeatable synthesis, tube/SVG/OBJ
  geometry and source-defined outer-lip coordinates. Native OBJ is an actual model
  surface, not a person scan.
- GEO-01/FUSE-01: metric visible points and uncertainty, synchronized trial attachment,
  declared lip correspondence, real native lip-distance likelihood inside joint fitting.
- INV-01: bounded global/local shared anatomy and per-trial jaw control, full requested/
  applied controls, equal-flexibility fixed anatomy baseline, actual compute counts.
  Recovery failures and remaining ambiguity are retained in JOINT_INFERENCE.md.
- PRED-01: frozen candidate digest, numerical intervention forecasts and disagreement;
  no calibrated posterior or microphone-spectrum claim.
- SVC-01: native subprocess isolation, durable job state, idempotent retries, cancellation,
  stale-model rejection, artifact integrity and parent-death watchdog.
- Replay: genuine native observations -> service fit -> frozen candidates -> service
  forecast -> byte-identical replay. This is retrospective synthetic integration.
- Independent challenges: reviewed source/math/evidence paths, actual scheduler-kill
  tests, fixed-budget model-mismatch/transfer-tilt experiment and duplicate-evidence audit.

## Remaining acceptance gates and concrete owners

| Input / gate | Responsible owner | A action after receipt | Current status |
|---|---|---|---|
| KIT-01 public schemas and designated integration commit | B | Adapt executable local jobs/observations; run B validators | Awaiting branch/commit |
| AUD-01 canonical extractor and defined source/capture likelihood inputs | B, A scientific review | Implement measured-audio source/articulation/capture fitting | Awaiting runnable handoff |
| CAP-01/02 actual rectified depth, calibration, clock and quality evidence | B + person with phones | Replay real geometry and verify FUSE timing/operator correspondence | No actual device bundle supplied |
| G2 independent hidden scoring and equal-budget protocol | B, A numerical signoff | Reproduce independent results and report ambiguity | Internal controlled tests exist; B gate unfinished |
| G3 human multimodal anatomy fit | A + B | Fit calibrated audio/geometry and validate claims | Blocked on the inputs above; not proven |
| G4 prospective commit-before-capture loop | B, A forecast review | Supply supported frozen forecasts and reject stale results | Numerical replay passes; prospective ledger/capture pending |
| G5 independent reproduction and modality comparison | A + B | Reproduce both humans' runs and publish all failures | Not established by A's synthetic run |

Coordination requests are posted on PR #1 and point to PR #3. A will not silently
replace B's contract/extractor or fabricate device evidence to close these gates.

## Reproduction handoff

From a fresh clone of the Lead A branch:

```sh
git submodule update --init --recursive
python3 -m venv science/.venv
science/.venv/bin/python -m pip install -e './science[test]'
science/.venv/bin/python science/scripts/build_native.py
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests -q -W error
PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/replay_science.py science/artifacts/replay --budget 20
PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/mismatch_challenge.py --output science/artifacts/mismatch
```

Use Python 3.12 or 3.13, CMake and a C++17 compiler. The native build fetches pinned
upstream source/test dependencies and publishes a manifest only after its tests
pass. Existing output directories are refused. The mismatch run is a diagnostic
experiment with reported failures, not a passing human validation test.

`replay/summary.json`, `replay/replay-manifest.json`, `replay/synthetic-forward/`
and `replay/jobs/artifacts/` form the genuine producer handoff for B. The OBJ/MTL,
EMA and SVG share the anatomical/articulatory state recorded in the manifest.
Generation truth and held-out observations remain separate from fitting input.

## Revision 6 activation

Revision 6 (`f33641c`) arrived while Lead A was executing revision 5 and is now
merged into the scientific queue. Ownership adapts proposed science/control/ to
the installed package science/src/singing_physics/control/:

| Ticket | Agent / branch | Exclusive new files | Status |
|---|---|---|---|
| MOT-01 control | a_forward / codex/a-control | science/src/singing_physics/control/; science/tests/test_control.py; science/CONTROL.md | running |
| MOT-02 visible motion | a_geometry / codex/a-motion | observations/geometry/motion.py; science/tests/test_motion.py; science/MOTION.md | running |
| MOT-02 dynamic inverse | a_inverse / codex/a-dynamic | science/src/singing_physics/dynamic.py; science/tests/test_dynamic.py; science/DYNAMIC.md | running |
| Control-aware PRED-01 | a_prediction / codex/a-control-forecast | science/src/singing_physics/control_forecast.py; science/tests/test_control_forecast.py; science/CONTROL_FORECAST.md | running |

A's independent reviewer challenges head-motion confounds, failed-execution
selection bias, inferred versus observed controls and post-outcome leakage.
B retains CUE-01, LEARN-01 and the public CueAttempt/MotionObservation/ControlProfile
contracts. G6 requires actual repeated motion evidence; G7 requires reviewed cues,
learner attempts and independent recall/transfer scoring. Synthetic motion/control
tests cannot substitute for these participant gates.
