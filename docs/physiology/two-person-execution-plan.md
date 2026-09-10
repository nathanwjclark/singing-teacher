# Parallel-agent execution plan

Companion to revision 7 of the physiological acoustic moonshot specification. Two humans remain accountable, each coordinating as many bounded Astra tasks as the dependency graph supports. This is an implementation plan, not evidence that the application or anatomical recovery works. There are no fixed hackathon time estimates.

Optimize for the earliest integrated, independently evaluated physiological inference experiment. Launch an agent only when its inputs, owned files and acceptance experiment are concrete. Additional capacity should remove a demonstrated bottleneck or challenge a scientific assumption. Unlimited agents do not imply unlimited simultaneous edits or benchmark compute.

## 1. Human accountability and coordination

| Responsibility | Accountable lead | Review |
|---|---|---|
| Forward physics, parameter meanings, inverse inference, visual/depth likelihood and numerical forecasts | A: scientific model lead | B checks evidence and integration |
| Native acquisition, canonical acoustic measurements, application orchestration, visualization and independent evaluation | B: experimental system lead | A checks scientific validity |
| Integration queue, shared contracts, cross-service checks and release readiness | B: integration lead | A signs off on scientific changes |
| Objective, scoring rules, supported anatomy and scope changes | A and B jointly | Record decision before dependent implementation |

Each human keeps one coordinating conversation and delegates bounded work to separate agent conversations. Coordinators manage task dependencies, review evidence and resolve decisions; implementation agents return small tested commits. The Astra runtime selecting vocal experiments inside the product is separate from these development agents.

B owns repository integration; A owns scientific inference integration (FUSE-01). This distinction replaces ambiguous uses of "integration owner". No agent merges its own work solely on its own completion claim. Participant interaction, device access and anatomical interpretation remain human responsibilities.

## 2. First shared deliverable: runnable integration kit (KIT-01)

Agree a narrow first experiment: several comfortable vowel segments constrain one shared anatomical parameter set, followed by a held-out prediction. Nasal occlusion is added only after the engine boundary condition and execution protocol are demonstrated. This preserves the reconstruction moonshot without inventing supported controls.

- [ ] Version observation, candidate-model, forecast, prediction-commit and evaluation schemas.
- [ ] Define units, coordinate frames, time origins, quality flags, artifact hashes, missing-data reasons, job states and model/evidence IDs.
- [ ] Define forward-engine interfaces and an extensible capability manifest; unsupported parameters stay unsupported until verified.
- [ ] Agree canonical acoustic features, calibration/held-out roles, scoring rules and a fixed-anatomy baseline with equal articulation freedom.
- [ ] Publish validation and replay commands with expected outputs.
- [ ] Add one genuine engine-generated audio/geometry pair with provenance as soon as PHY-01 exports it.
- [ ] Add one actual synchronized phone bundle when CAP-01/02 produces it.

KIT-01 has incremental handoffs: the schema skeleton unblocks independent foundations; genuine artifacts unlock the consumers' integration checks. Do not wait for full anatomy discovery to build capture. Development examples must identify their provenance and cannot be reported as live human reconstruction. No production path returns fabricated fitted anatomy.

Start each task from a recorded integration commit. Shared contracts describe file-backed immutable artifacts first; the job API transports the same records. Large media and simulator states stay outside agent prompts.

## 3. Agent lanes and exclusive module ownership

Paths below are proposed application paths, not claims about files already implemented. Adapt them to existing work with an explicit ownership map before launch. One active writer owns each file, including shared configuration.

| Lane / tickets | Lead | Owned paths | Deliverable and acceptance experiment | Prerequisites |
|---|---|---|---|---|
| Contracts and integration / KIT-01, INT-01 | B | contracts/, tests/integration/, repository CI | Validate genuine producer artifacts; replay one cross-service flow; reject incompatible versions and stale results. | Joint minimum interface decisions |
| Forward physics / PHY-01 | A | science/forward/, tests/science/forward/ | Pinned build; parameter units/bounds; repeatable synthesis and matching geometry; reset and unsupported-control tests. | Engine selected |
| Native acquisition / CAP-01, CAP-02 | B | apps/ios/, capture/ | Deploy on available iPhone; export/replay audio, RGB and supported depth; measure timing/depth quality and missing samples. | Observation schema; human device access |
| Acoustic measurements / AUD-01 | B, A reviews | observations/audio/ | One versioned extractor for observed and synthesized signals; controlled pitch/spectral cases, noise and failure behavior. | Feature definitions; real or synthesized test signals |
| Visual/depth measurements / GEO-01 | A | observations/geometry/, tests/science/geometry/ | Calibrated visible-surface measurements and uncertainty; known-target projection, masking and missing-depth tests. | Bundle coordinates; actual depth data for device acceptance |
| Inverse inference and fusion / INV-01, FUSE-01 | A | science/inverse/, tests/science/inverse/ | Shared anatomy across tasks; dynamic states; diverse candidates; held-out synthetic recovery; real multimodal fit and missing-modality behavior. | PHY-01, AUD-01; GEO-01 for visual/depth fusion |
| Scientific job service / SVC-01 | A | science/service/, tests/service/ | Submit, cancel and replay real jobs; immutable artifacts; idempotent retries; stale-model rejection. | Job/artifact contracts; engine for executable integration |
| Independent evaluation / EVAL-01, DEPTH-02, REP-01 | B | evaluation/, tests/evaluation/ | Scoring-only truth; equal-budget baselines; frozen forecasts; modality comparisons; reproducible report including failed attempts. | Contract/scoring agreement; executable inputs as producers land |
| Numerical experiment forecasts / PRED-01 | A | science/prediction/, tests/science/prediction/ | Forecast supported interventions from frozen candidates; quantify disagreement and compare with repeat variability. | PHY-01 capability manifest; candidate models from INV-01 |
| Experiment orchestration / ACT-01, DEPTH-01 | B | experiment/, tests/experiment/ | Validate proposals; commit prediction before capture; score before update; stop/failure/retry behavior. | Forecast contracts; PRED-01, capture and evaluator for full loop |
| Actual model visualization / VIS-01 | B | apps/web/ | Render engine geometry and alternatives; distinguish fitted/fixed/unsupported structure; align predicted and observed results. | Genuine geometry export and model contract |

A owns scientific dependency files and native-engine build configuration. B owns repository CI and frontend/iOS dependency files. If Python dependencies are shared, A is the sole lock-file writer; B requests additions. Reviewers propose changes without concurrently editing an implementer's files. Task transfers are recorded before the new writer starts.

### Preserve synchronized evidence while splitting processing

B's acquisition agent owns microphone, RGB and depth together, preserving a shared observation manifest, source timestamps, calibration and synchronization uncertainty. Audio and geometry agents may process independently, but every output references the same evidence IDs/timebase. A's inverse agent combines their constraints in one physiological fit. Never treat independent network arrival times as synchronization or derived face geometry as measured hidden anatomy.

The available iPhone 13 Pro Max and iPhone 15 Pro remain the hardware targets. Start with one-phone synchronized capture; retain CAP-01/02, FUSE-01 and DEPTH-01/02 from the capture addendum. Sensor limitations remain measured outcomes, not reasons to silently remove depth from the work queue.

### Embodied learning extensions (revision 7)

The [embodied learning and motion plan](embodied-learning-and-motion-plan.md) is part of this execution plan. Add two independent agent lanes: B owns CUE-01 in experiment/cues/, apps/web/coach/ and tests/cues/; A owns MOT-01 in science/control/ and tests/science/control/. Narrow the existing experiment orchestration owner to workflow/tool execution outside experiment/cues/, and the visualization owner to web files outside apps/web/coach/. The existing capture, geometry and inverse owners implement MOT-02 within their modules; the evaluator owns LEARN-01 in evaluation/learning/. No shared file has two writers.

CUE-01 library/contract design and MOT-01 synthetic control-model design can run with wave 1. Dynamic capture/fusion requires CAP-02, GEO-01 and INV-01; integrated teaching requires PRED-01 and ACT-01. KIT-01 includes CueDefinition, CueAttempt, SensationReport, MotionObservation, ControlProfile and TransferEvaluation. G6 verifies dynamic mapping; G7 verifies a measured cue-to-recall/phrase-transfer loop. See the addendum for exact acceptance evidence and review status of example cues.

A reviews the separation of anatomy, articulation and learned control; B secures teacher review of cues and evaluates recall/transfer independently. Both keep observed movement, hidden-motion hypotheses and self-reported sensations distinct. These are initial implementation responsibilities, not an unowned production-roadmap extension.

## 4. Dependency-driven activation

These waves describe prerequisites, not dates or mandatory group-wide barriers. A lane starts its next task as soon as its own inputs pass, without waiting for unrelated lanes.

### Wave 1: foundations and uncertainty removal

Start roughly six concrete tasks: KIT-01 contracts; PHY-01 engine; CAP-01 native capture; AUD-01 measurement definition/controlled tests; EVAL-01 scoring and leakage harness design; GEO-01 coordinate/measurement feasibility. Capture starts after the minimal bundle agreement; evaluation can specify scores before the engine is available, but cannot claim executable recovery results yet.

A checks what anatomy and interventions the engine actually exposes. B obtains actual device-format logs and recordings. Both freeze the first calibration/held-out protocol. Return runnable evidence for capability claims instead of broad research summaries.

### Wave 2: inference and application integration

Once genuine artifacts exist, activate INV-01, SVC-01 and VIS-01. AUD-01 validates engine outputs and live recordings; GEO-01 validates actual depth and produces constraints for FUSE-01. The evaluator generates fresh hidden scoring cases and runs executable baselines. Native capture proceeds independently of synthetic inverse recovery.

### Wave 3: prospective experiments and comparisons

PRED-01 consumes real candidate models. ACT-01 connects forecasts to the learner and immutable ledger. EVAL-01 scores outcomes before updates. Run DEPTH-01 followed by DEPTH-02 modality comparisons with equal budgets. Investigate failures with bounded research tasks rather than broad unplanned rewrites.

### Critical dependency chains

- Scientific: PHY-01 + AUD-01 -> INV-01 -> PRED-01 -> prospective loop.
- Measured multimodal: CAP-01 -> CAP-02 + GEO-01 -> FUSE-01 -> DEPTH-02.
- Integration: KIT-01 -> genuine artifact exchange -> SVC-01 + VIS-01 -> prospective replay -> reproducible report.
- Evaluation: frozen scoring protocol -> hidden cases/baselines -> frozen fit/forecast -> score -> model update eligibility.

These chains intersect but should not unnecessarily serialize one another. In particular, missing phone depth does not block synthetic recovery; incomplete inverse fitting does not block capture or actual forward-geometry rendering. A blocked ticket remains explicitly unfinished.

## 5. Working integration gates

B integrates small reviewed commits into one designated integration branch. Follow repository deployment procedures when a runnable application change is in scope; a planning update alone does not merge or deploy the app. Keep feature worktrees separate and preserve the last passing integration state.

| Gate | Required runnable evidence | Acceptance owner |
|---|---|---|
| G0: contract skeleton | Shared schemas and validation commands agree; owners and scoring protocol recorded. | B, with A scientific signoff |
| G1: real artifact exchange | Engine audio/geometry pair and actual synchronized capture validate and replay; provenance distinguished. | A engine acceptance; B capture acceptance |
| G2: synthetic inference | Hidden-anatomy fit, fixed-anatomy baseline, candidate geometry display and independent score reproduce. | A numerical review; B independent evaluation |
| G3: human multimodal fit | Actual bundle enters FUSE-01; supported observations affect likelihood; missing depth and model mismatch reported. | A and B |
| G4: prospective loop | Supported prediction frozen before capture; outcome scored before update; stale/cancelled work excluded. | B; A forecast review |
| G5: evidence reproduced | Both humans replay benchmark and recorded run; equal-budget modality results, failures and limitations documented. | A and B |

G2 may pass before the capture part of G1. The synthetic G4 path may be exercised before G3, clearly labeled synthetic. No synthetic result satisfies a human-data gate. Gates are evidence labels, not permission to misrepresent a partially integrated system.

Each handoff includes a commit, exact command, contract version, expected artifacts, actual checks and known failures. Integration checks should exercise real module boundaries, including error paths. B merges in dependency order; A reviews physical meanings and numerical claims before scientific changes enter the passing integration state.

## 6. Use extra agents for independent scientific challenges

Review and investigation agents do not share ownership of production files. Assign a specific hypothesis and artifact. Their independence helps expose errors; agreement between agents is not empirical validation.

| Investigation | Required result | Lead |
|---|---|---|
| Identifiability | Distinct plausible anatomies with similar fit; candidate intervention predicted to distinguish them. | A |
| Anatomy/articulation separation | Stability across vowels with articulation varying; identify compensating parameters. | A |
| Capture compensation | Controlled microphone/room perturbations; determine whether inferred anatomy changes spuriously. | B, A reviews |
| Incremental depth value | Audio, audio+RGB, audio+RGB+depth comparison at equal evidence/compute budgets; report null results. | B |
| Model mismatch | Generate cases with altered physics/capture assumptions; test recovery and uncertainty failure. | A |
| Evidence integrity | Attempt target leakage, stale-model updates, post-outcome forecasts and failed-trial exclusion. | B |
| Device reliability | Repeat capture/stop/permission-loss/replay on both available phones; preserve metadata. | B |

For unresolved algorithms, permit bounded competing implementations behind the same interface in isolated branches. Predeclare a compute budget, development cases and selection metric. Tune only on development data; after selecting, evaluate once on fresh held-out cases to avoid selecting on the final test set. Promote one supported implementation and record why. Keep other branches as research evidence rather than merging all alternatives.

Schedule simulator workers, phones and benchmark compute explicitly. Pin versions, seeds, parallelism and budgets. If the native engine is stateful or not demonstrated thread-safe, isolate workers in processes and test deterministic reset behavior. More agents must not create uncontrolled compute contention or irreproducible comparisons.

## 7. Task board, dispatch and handoff contract

Use one shared repository-visible task board with IDs, owner, prerequisites, starting commit, contract version, acceptance experiment, branch/PR and status. Statuses: proposed -> ready -> running -> review -> integrated; blocked records the missing input and responsible owner. Only B marks repository integration complete after checks; scientific acceptance also requires A's signoff.

A task is ready when its input exists or its independent portion is explicitly bounded, one writer owns its files, and success can be checked. Split research/design and executable acceptance when only the former is unblocked. Coordinators revisit blocked dependencies at each handoff and dispatch the next ready task. Finishing agents take ready review or investigation tasks; they do not invent new architecture.

```text
Task ID / objective:
Human lead / independent reviewer:
Owned files and explicit non-goals:
Starting commit / branch / worktree:
Input artifacts and contract version:
Prerequisites / what can proceed independently:
Acceptance experiment and required checks:
Compute or device budget:
Handoff commit / exact command / expected output:
Actual results / limitations / blockers:
Next consumer and dependency unblocked:
```

Agent starter instruction:

> Read revision 7, the lane assignment and shared contracts. You are not alone in this repository. Modify only your assigned files in your own worktree; do not revert others' changes or edit shared interfaces without their owner. Implement the bounded deliverable with real producers and explicit failure behavior. Separate research hypotheses, synthetic evidence and human observations. Run the acceptance experiment and report its actual result, including failure. Return a small commit, runnable commands, artifact provenance, contract version and remaining blockers. Do not expand scope, fabricate fitted anatomy or merge your own work.

## 8. Human checklists

### Person A: scientific model lead

- [ ] Agree the first physiological hypothesis, supported parameter subset and scoring protocol.
- [ ] Dispatch PHY-01 and scientific feasibility tasks; obtain genuine forward artifacts.
- [ ] Review AUD-01 features and GEO-01 physical constraints with their owners.
- [ ] Dispatch INV-01, FUSE-01 and SVC-01 as prerequisites pass.
- [ ] Review anatomy/articulation separation, parameter recovery, candidate diversity and baselines.
- [ ] Dispatch PRED-01 and identifiability/model-mismatch investigations.
- [ ] Sign off numerical changes entering the integration queue.
- [ ] Review DEPTH-01/02 and publish supported conclusions and unresolved failures.
- [ ] Dispatch MOT-01 and integrate MOT-02; test control limits separately from anatomical limits.

### Person B: experimental system and integration lead

- [ ] Establish KIT-01, file ownership, task board and integration queue.
- [ ] Dispatch native capture, acoustic measurement and independent evaluation tasks.
- [ ] Arrange device access and obtain CAP-01/02 timing/depth evidence.
- [ ] Dispatch service integration, actual geometry visualization and orchestration when ready.
- [ ] Keep hidden scoring truth separate from fitting/planning inputs; review leakage controls.
- [ ] Integrate reviewed commits and maintain the runnable cross-service path.
- [ ] Execute prospective and modality-comparison experiments with all attempts retained.
- [ ] Verify both humans can reproduce results and explain the evidence levels.
- [ ] Dispatch CUE-01 and LEARN-01; obtain cue review and demonstrate G6/G7 with actual evidence.

Both humans resolve cross-lane decisions in a short repository decision record, with affected contracts/tasks and migration owner. Preserve physiological inference, real evidence and independent scoring when reducing scope; reduce conversation polish, accounts, large-scale scraping and elaborate visual effects first. Anatomical recovery remains a hypothesis to test, not a completion claim inferred from agent output.

## Active acoustic probing integration (revision 7)

The [active probing addendum](active-acoustic-probing-plan.md) adds PROBE-01/02/05/06 to B and PROBE-03/04 to A. B coordinates native playback/capture, dedicated response DSP, schema changes and runtime Astra orchestration; A builds the external-drive operator and joint fit/service adapter. Existing owners retain shared files. Capture, response contracts/DSP and physics can progress in parallel; inverse/UI integration consumes their real artifacts. One-phone G8/G9 is the first complete path, independent of optional second-phone nasal support.

These tasks are initial app implementation, not a standalone research spike. Add the exact-drive/received-media and calibration contracts to KIT's controlled extension process. Allocate available visual-polish capacity to this capture/DSP integration, preserving the existing A/B publication and verified-recording handoff. See the addendum for each ticket's acceptance; no agent is dispatched by this plan.
