# Two-person execution plan

Companion to the revision 4 physiological acoustic moonshot specification. Assumes two builders, each using their own Astra conversation. This is a work allocation and integration plan, not an implemented application.

The [capture and depth addendum](capture-and-depth-plan.md) incorporates the existing remote repository and available iPhone 13 Pro Max / iPhone 15 Pro. Person B owns synchronized audio, RGB and depth as one acquisition system; Person A consumes them jointly. The main specification section 8 now assigns CAP-01/02 to B, FUSE-01 to A and DEPTH-01/02 jointly. Its acceptance criteria are shared integration gates. Existing repository architecture does not constrain this design; prioritize native capture over UI polish.

## 1. Split by responsibility

**Person A: physical model and inverse inference.** Own the executable scientific hypothesis: generate sound from anatomy, fit anatomy across observations, represent competing solutions, and predict responses to candidate experiments.

**Person B: experimental system and independent evaluation.** Own how evidence is collected, how Astra chooses and runs an experiment, how predictions are scored, and how the actual model is displayed.

This divides two substantial engineering workstreams. Person B builds instrumentation and scientific evaluation, not just a frontend. Person A does not build the entire backend. Both contribute to the central physiological reconstruction experiment.

| Responsibility | Accountable owner | Reviewer |
|---|---|---|
| Simulator build, license/assets and parameter capabilities | A | B |
| Physical parameters, forward model, geometry export | A | B |
| Shared-anatomy fitting, candidate diversity, diagnostics | A | B |
| Numerical forecasts for candidate interventions | A | B |
| Capture, synchronization, quality and feature extraction | B | A |
| Astra tool adapter and experiment state machine | B | A |
| Immutable predictions, scoring and leakage checks | B | A |
| Candidate anatomy and spectrum visualization | B | A |
| Benchmark runner and results presentation | B | A |
| Scientific objectives, contract and scope changes | Together | Together |

Person A's work is likely to be the bottleneck. Person B owns the independent evaluator and feature extraction to keep that workload balanced. After the first integration, B can take bounded simulator debugging or benchmark tasks by explicitly transferring file ownership; neither person silently edits the other's module.

## 2. Agree these before independent implementation

1. Read revision 4 and agree on the first end-to-end experiment: several comfortable vowel segments informing one shared anatomical parameter set, followed by a held-out prediction. Nasal occlusion is included only if the simulator and protocol support it.
2. Pick one supported capture device/browser and one reference forward-engine configuration. Agree that uncertain controls remain unsupported until verified.
3. Create the repository layout and assign ownership. Choose Python for the scientific service and TypeScript for capture/display, as in the main specification.
4. Agree on contract version 0.1: parameter units, audio/camera timebases, artifact references, missing-data representation, job states and evidence IDs. The exact physical parameter list follows A's capability audit.
5. Choose a score before fitting. Define calibration versus held-out records, the fixed-anatomy baseline, and the difference between prospective prediction and post-hoc reconstruction.
6. Commit this shared starting point. Each person starts their own branch and Astra conversation from that commit.

Do not spend this session designing every future API. Agree on the narrow path needed to send observations to A and return candidates, geometry and predictions to B.

## 3. Proposed module ownership

These are planned application paths, not files that already exist.

```text
contracts/                 B maintains; A reviews breaking changes
science/forward/           A: native simulator wrapper and capabilities
science/inverse/           A: joint fitting and candidate diagnostics
science/prediction/        A: intervention simulations and disagreement
science/service/           A: scientific job API and artifact export
observations/              B: canonical audio/video feature extraction
apps/web/                  B: capture, experiment flow and visualization
experiment/                B: Astra tools, state machine, immutable ledger
evaluation/                B: independent scoring and benchmark runner
tests/science/             A: physics, inference and numerical tests
tests/integration/         B: real cross-service flow and leakage tests
docs/decisions/            B maintains; decisions agreed together
```

B owns repository-level integration configuration; A owns native build configuration and scientific dependencies. Declare a single owner for each dependency/lock file at kickoff. If using one Python environment, nominate A as its dependency-file owner and have B request additions. Do not maintain incompatible duplicate feature implementations.

Both observed and synthesized signals use B's versioned feature extractor. A defines the required scientific features and reviews their units/validity. If extraction is not yet ready, A can progress on direct numerical synthetic tests, while B works on real capture and extraction independently.

## 4. The shared interface

Use file-backed, immutable artifacts initially; do not pass large media or simulator state through an Astra prompt. Support asynchronous scientific jobs. An HTTP adapter can transport the same records when both pieces run together.

| Operation / artifact | Producer | Consumer | Required content |
|---|---|---|---|
| Capabilities | A | B | Engine version; supported global/dynamic parameters; units/bounds; valid interventions; geometry formats. |
| Observation bundle | B | A | Media references/hashes; task; timestamps; capture metadata; canonical feature version; quality flags; calibration/held-out role. |
| Fit request | B | A | Explicit calibration evidence IDs; prior/configuration; compute budget; seed; contract version. |
| Fit result | A | B | Immutable model ID; candidate global anatomy and dynamic states; residuals; uncertainty method; mismatch status; geometry/audio artifacts. |
| Experiment forecast | A | B | Frozen model ID; action; predicted observables; uncertainty and assumptions; execution mode; numerical selection score. |
| Prediction commit | B | Evaluator | Forecast hash; action; model/evidence IDs; scoring rule; commit time before capture. |
| Evaluation result | B | Both | Prediction error; execution deviations; exclusions; baseline comparison; update eligibility. |

Every request has a unique ID. Jobs report queued, running, succeeded, failed or cancelled; progress is optional. Errors carry a reason, not a successful empty result. Results from superseded models cannot enter the current session. Artifacts carry coordinate conventions, units, sample rates and time origins. Unsupported values are null with a reason, never fabricated zeroes.

Use a consistent geometry export that A can actually generate. SVG contours can establish the first integration; richer 3D export follows. B must display A's fitted geometry, not invent an unrelated mesh from acoustic features. A must document any template or cross-section assumptions.

Do not make B wait for the complete inverse solver. A's first handoff is an actual forward-generated observation/geometry pair with a provenance manifest. B can test ingest, rendering and extraction with that data. Development fixtures are clearly identified and excluded from live success claims; no fake fitted result enters the production path.

## 5. Ordered checklists and integration gates

### Person A: backend and model

- [ ] Agree the shared observation and forecast contracts with B.
- [ ] Build and test the pinned physical simulator; record licenses/assets.
- [ ] Export real synthesized audio and matching geometry for B.
- [ ] Publish parameter names, units, bounds and unsupported controls.
- [ ] Build known-parameter synthetic recovery tests with hidden scoring truth.
- [ ] Implement shared-anatomy inverse fitting across tasks, with multiple candidates and diagnostics.
- [ ] Run the fixed-anatomy baseline with equal dynamic flexibility.
- [ ] Implement FUSE-01: consume B's synchronized RGB/audio/depth bundle and handle missing observations explicitly.
- [ ] Implement intervention simulation and numerical disagreement scoring.
- [ ] Integrate DEPTH-01 with B's prospective experiment flow.
- [ ] Review DEPTH-02 modality comparisons and investigate model mismatch.
- [ ] Publish reproducible model commands, parameter recovery and known limitations.

### Person B: capture, orchestration and evaluation

- [ ] Agree the shared observation and forecast contracts with A.
- [ ] Implement CAP-01: native iPhone microphone, RGB and supported depth capture.
- [ ] Implement CAP-02: timestamp/calibration preservation, quality checks, replay and depth/timing bench tests.
- [ ] Build the canonical feature extractor used for observed and simulated audio.
- [ ] Ingest A's genuine forward-model outputs and display the matching geometry.
- [ ] Send a real synchronized bundle through A's FUSE-01 pipeline.
- [ ] Implement Astra tool orchestration and deterministic proposal validation.
- [ ] Implement DEPTH-01: immutable prediction, capture, score, then model update.
- [ ] Implement independent evaluation and hidden synthetic-truth handling.
- [ ] Run DEPTH-02: audio-only versus RGB versus RGB+depth comparisons under equal budgets.
- [ ] Test stop, missing sensors, stale jobs, failure reporting and replay.
- [ ] Prepare the end-to-end demonstration with clear evidence levels.

### Shared gates

1. **Contract agreed:** both can validate the same bundle and parameter manifest.
2. **Artifacts exchanged:** A's genuine simulation and B's real capture load successfully.
3. **Inference integrated:** synchronized observations enter fitting and returned geometry renders.
4. **Prospective loop:** prediction is frozen before recording and scored before update.
5. **Evidence reproduced:** both can replay the run and explain what succeeded, failed or remains untested.

Exchange a working commit, exact command, expected output and known failures at every gate. Work proceeds by satisfied dependencies, not elapsed time. A polished interface alone does not satisfy the physiological inference gate.

## 6. Using two Astra conversations effectively

Each person keeps a separate working conversation for their owned modules. Both conversations receive the main specification, this plan, shared contracts and current milestone. Share decisions through the repository; do not assume one conversation knows what the other decided.

Each iteration follows: inspect current code and interfaces -> choose a bounded task -> implement -> run the relevant checks -> provide a concise handoff. Ask Astra to identify assumptions and test numerical or data-flow claims rather than accepting plausible explanations as verification.

Use short-lived branches such as `codex/physics-forward` and `codex/experiment-capture`, each from the agreed integration branch. On different computers, each person has their own checkout; on one computer, use separate worktrees. Keep shared interfaces small, commit integrated slices frequently, and have the integrator combine reviewed changes. Do not edit one working directory concurrently.

The humans own scientific decisions and participant interaction. The two development conversations are distinct from the Astra instance inside the application that selects experiments. API responses or developer explanations are not numerical test results.

### Starter prompt for Person A

> We are building an open-source moonshot that attempts to recover a person's physiological acoustic model from audiovisual evidence and active vocal experiments. Read the current main specification and two-person execution plan. You own science/forward, science/inverse, science/prediction, science/service and tests/science. Another builder owns capture, canonical feature extraction, orchestration and evaluation; do not overwrite their work. Use the shared contracts, and propose coordinated changes when necessary. First build and test the forward simulator, inspect actual parameter capabilities, and export one genuine synthesized recording plus corresponding geometry and provenance. Then implement shared-anatomy inverse fitting and a synthetic recovery test. Keep known test anatomy outside the inverse solver. Do not replace physical inference with cue recommendations, fake fitted outputs or unsupported anatomical labels. Work in small verified commits and hand off exact commands, artifact formats, test results and blockers.

### Starter prompt for Person B

> We are building an open-source moonshot that attempts to recover a person's physiological acoustic model from audiovisual evidence and active vocal experiments. Read the current main specification and two-person execution plan. You own observations, apps/web, experiment, evaluation, tests/integration and shared-contract maintenance. Another builder owns physical simulation and inverse fitting; do not overwrite their work. First implement actual capture, quality metadata and a versioned observation bundle, then canonical feature extraction and ingestion/display of the other builder's real simulator outputs. Build the immutable prediction -> recording -> scoring -> update state machine and Astra tool adapter. Keep held-out anatomy and evaluated audio out of fitting and prospective planning. Display the geometry supplied by the scientific engine, not an invented personalized scan. Do not report simulated or replayed data as a live human reconstruction. Work in small verified commits and hand off exact commands, contracts, test results and blockers.

### Handoff format

```text
Milestone / commit:
What works and exact command:
Input/output contract version:
Tests run and results:
Scientific assumptions and unsupported controls:
Known failures:
Next dependency needed from the other builder:
```

## 7. Independent checks and task transfers

B's evaluator should load hidden synthetic truth only after inference outputs are frozen. Generate private scoring records in a separate artifact location from the fitting/planning inputs. A can know training examples; scored cases need fresh seeds and held-out anatomy, with no truth metadata in prompts or filenames available to the solver. This separation checks leakage, not adversarial secrecy between teammates.

A reviews feature extraction and whether proposed experiments are represented physically. B reviews whether the fit reuses one anatomy across tasks, whether post-outcome information leaked into forecasts, and whether visualizations overstate recovery. Both review independent physiology claims.

If A is blocked, B can take a discrete task such as testing native build portability, producing feature benchmarks, or checking a geometry exporter. Record the ownership transfer before editing. If B is blocked, A can help with a specific contract adapter or integration test after freezing a working solver build. Neither person starts a second competing implementation of the other's core module.

Preserve scientific progress when reducing scope: remove conversation polish, account systems, large-scale video scraping and elaborate 3D interaction first. Keep a working forward model, actual inverse fitting, prospective record and honest results. If only synthetic recovery works, present that result accurately.

## Integrated depth ownership

Main specification section 8 is authoritative: B owns CAP-01 and CAP-02; A owns FUSE-01; both own DEPTH-01 and DEPTH-02 with B responsible for execution/scoring and A for numerical forecasts/fit review. These are dependency gates without time estimates. Existing repository code is optional reusable material, not an architectural constraint.
