# TractStar engineering and scientific handoff

**Repository:** `nathanwjclark/singing-teacher`  
**Code baseline:** `main` at `0e94328` (PR #25)  
**Handoff date:** 2026-09-10, refreshed 2026-09-11 with the review findings and the Wave 3 PR queue  
**Purpose:** give the next agent enough context to continue the prototype, finish the remaining first- and second-wave connections, and begin the third wave of scientific model improvement without confusing software execution with anatomical validation.

Shareable rendering: [PDF handoff](../../output/pdf/TractStar-Wave3-Handoff.pdf), which reflects the 2026-09-10 revision. The Markdown file is the editable source of truth.

## The product objective

TractStar is an open-source singing research prototype. Its distinctive goal is to let a singer provide voice recordings, images/video and optional depth or acoustic-probe evidence; maintain competing hypotheses about that singer's vocal acoustics and visible anatomy; ask Astra to choose a safe, supported experiment; record the attempt and subjective sensation; compare the result with a prediction frozen before the attempt; and update or retain hypotheses with an explicit reason.

The product is a research harness for a moonshot. It may produce an inaccurate or non-identifiable model. A faithful discrepancy, a retained ambiguity and a useful next experiment are valid outcomes. The system must never turn a native template surface, a camera landmark, a microphone feature, a simulator control or an educational illustration into a claim that hidden anatomy, vocal-fold contact, muscle activation or clinical function was measured.

The three-wave framing is:

1. **Prototype foundation:** capture and provenance, native vocal-tract forward modeling, finite PCM fitting, session ledger, browser app and graceful degradation.
2. **Connected research loop:** Astra decisions, frozen prospective experiments, outcomes and model lineage, optional source/phonation analysis, motion/audio comparisons, rear LiDAR conditional fusion, visual likelihood, illustrated teaching, probe import/fit, replay/export and visible tongue tooling.
3. **Scientific improvement:** richer spectral objectives, cue-to-execution learning, time-resolved articulation, self-oscillating source mechanics, coupled oral/nasal probe physics, reproducible scoring, phrase-level transfer and controlled modality/accuracy evaluations.

## What is actually merged on `main`

PR #19 merged the rear-LiDAR conditional likelihood and competing source bank. Original depth is projected through calibrated rays to explicitly annotated outer-lip pixels; retained hypotheses are ranked and the authoritative session can adopt a new model. The UI previews only hash-verified adopted native geometry. Rejected, stale, failed and duplicate attempts remain visible. Source alternatives are frozen before later recordings, scored against one canonical original frame and retained in a separate conditional ranking. Recovery includes concurrent-request exclusion, terminal geometry-export retry identities and stale unsubmitted-intent release.

PR #20 merged conditional visual likelihood and illustrated physiology teaching. Original video frames can be annotated in pixels with a fixed declared camera candidate; later frames are scored as visible, occluded or missing. Results reach bounded Astra context and session export without anatomical adoption. Teaching has separate general-explanation, model-prediction and recorded-result modes, reviewed mechanisms, static/reduced-motion fallbacks, native geometry/audio comparisons and explicit recorded-outcome handling. The supported personalized comparison is the committed tongue/jaw vowel operator. Cricothyroid, soft-palate and other unsupported mechanisms remain educational-only.

PR #21 added final native teaching/browser acceptance and a guard for incomplete historical scientific receipts. The real acceptance fixture exercised native geometry, explicit A/B synthesis playback, a recorded numerical outcome, historical and educational views, reduced motion, mobile layout and complete app mounting in 18.9 seconds. The fixture used generated evidence and a seeded software Astra decision; it made no paid provider call.

The merged prototype also contains:

- canonical microphone measurements and an optional live phonation panel;
- an isolated source/tract research fitter and bounded competing source bank;
- native iPhone capture/import contracts and a native iOS acquisition app that is unsigned here;
- motion recording, audio-only conditional analysis and bounded temporal comparisons;
- acoustic-probe import and oral external-drive fitting with graceful missing-calibration behavior;
- personal sensation memory, cue/recall/transfer records and session export;
- a local server with server-side Astra credentials, finite call budgets and localhost-only experimental routes;
- original-byte/hash verification, immutable job/session lineage and restart/retry handling.

## What the merged prototype does not establish

No merged code proves complete internal anatomy reconstruction, calibrated posterior probabilities, vocal-fold closure/contact, tissue mechanics, nasal-cavity geometry, cricothyroid motion, hidden tongue shape or coaching efficacy. The optional phonation path measures source-plus-filter acoustics and can rank prescribed source alternatives; it does not diagnose closure. The LiDAR path constrains an outer-lip distance likelihood; it does not see the palate, larynx, vocal folds or internal muscles. The visual path is a conditional pixel comparison with declared correspondences and camera assumptions. All generated/native fixtures are software evidence, not human evidence.

## Engineering baseline (September 11 review)

An independent review on September 11 found that none of `main`'s tests gated a merge: CI ran lint and build only, `npm test` ran 1 of 47 Node test files, and on `0e94328` the science suite had 3 failures and the default browser suite 4. Demo mode had also stopped showing coaching cues. The first PR in the queue below fixes all of it and makes CI run every existing suite on macOS 15. Getting CI green on a fresh runner also exposed intermittent failures, each root-caused and fixed rather than retried, among them the capture-processing browser race, a parallel-test port collision, a probe status route that reported a finishing job as idle, and an offline phonation extractor that inherited the 200 ms live deadline. Linux builds the native library and passes the Node tests, but 15 science tests that pass on macOS fail there, so Linux remains unsupported until that is investigated.

The ten Wave 3 lane worktrees were preserved, not edited. Their uncommitted work was snapshotted and carried into new branches by cherry-pick, then finished, adversarially reviewed and fixed. Every branch in the queue and the archive refs for the original lane commits are on `origin`.

## Wave 3 PR queue

The branches form one linear stack, in merge order, so each PR applies cleanly after the one before it. Evidence source for every lane is `synthetic`.

| # | Branch | Delivers | Scientific outcome | Open decision |
|---|---|---|---|---|
| 1 | `claude/verification-gate` | CI runs Node, science and browser suites; demo cue fix; stale science tests fixed; test servers isolated from real workers and keys | untested (plumbing) | Default protocol cannot commit an acoustic design (below) |
| 2 | `claude/wave3-tongue` | Public TongueSAM visible-region detector as a separate baseline; region boxes can never become tip, depth or landmarks | untested | 36 MB ONNX in git or a pinned release asset; training-data licence |
| 3 | `claude/wave3-phrase` | Frozen 2–8 note melodies scored on pitch, rhythm and voicing with mir_eval frame metrics; single-note flows unchanged | untested | none |
| 4 | `claude/wave3-probe` | App-managed probe setup frozen and consumed by the existing import/fit; human recordings stay ineligible until calibration is derived from measurements | untested | Physical-reference captures with declared calibration; device-attested provenance |
| 5 | `claude/wave3-source` | Native two-mass source family behind a guarded switch, requested and simulated F0 recorded, equal-budget held-out comparison | inconclusive | Geometric stays the default |
| 6 | `claude/wave3-spectral` | Versioned multi-resolution spectral objective selectable in the app; gain-only synthesis shared (app run 77 → 37 native calls, identical scores); evaluation revision 2 | inconclusive | none |
| 7 | `claude/wave3-replay` | Read-only recompute route and panel; matched, failed, unavailable, unsupported and skipped reported separately | untested | Legacy unpinned designs count as matched but unverified |
| 8 | `claude/wave3-motion` | Time-resolved audio trajectory bank with gaps, ambiguity sets and a constant-path comparison in the UI and Astra context | inconclusive | none |
| 9 | `claude/wave3-control` | Cue-to-execution learning: frozen cue bindings, finite PCM control bank, per-anatomy history, separate residual calibration; three matched attempts moved the fourth forecast from uniform weights (0.33 each) to 0.25/0.45/0.30 | untested | none |
| 10 | `claude/nasal-operator-design` | Design for the coupled oral/nasal operator, with native facts verified by probes (docs only) | untested | Native patch for arbitrary-frequency branch matrices |
| 11 | `claude/wave3-handoff-refresh` | This handoff refresh | n/a | none |
| 12 | `claude/ci-fixture-specs` | The five fixture-gated browser checks seed their own data and run in CI | untested (plumbing) | none |
| 13 | `claude/ledger-v2` | Session ledger stores a content-addressed state tree instead of the full state per event (app loop 23.95 → 0.92 MB stored) | untested (software) | One-way upgrade: rollback needs a pre-upgrade backup |
| 14 | `claude/bundle-split` | Route and feature code splitting: `/phone` initial JS 443 → 91 kB gzip, studio first paint 443 → 319 kB | untested (software) | none |
| 15 | `claude/pull-provenance` | USB pull receipt records device and archive hash; importers classify with it, so a pulled recording cannot pass as a fixture or physical reference | untested | Command-line physical-reference imports; devicectl field names need one check on an Xcode Mac |

Worker-backed browser checks (spectral objective, session recompute, motion timeline, motion audio, visual likelihood, LiDAR, source bank) run in CI through their own configs after the default suite; each seeds its own generated native data, so none is skipped.

## Wave 3 scientific work already learned

**Default protocol identifiability.** Since the default search covers palate length × lip width, the default run retains five hypotheses and no acoustic experiment separates all of them. A probe with the production `design_pcm` found that one pair (palate 3.92 cm with lip width 0.78, and palate 4.35 cm with lip width 0.53) stays below the 0.05 separation threshold under every vowel, gain and jaw setting tried (best 0.044 with *i* at gain 16). Every other pair is separable by some experiment. This is palate-versus-lip acoustic compensation. Outer-lip distance from rear LiDAR or the visual likelihood constrains lip width directly and is the evidence that can break the tie. Until the owner chooses a protocol, the app freezes the design as unsupported and says why, and a learner needs Astra (or a LiDAR/visual step) before recording an outcome.

**Spectral objective.** Revision 2 of the frozen evaluation fixed revision 1's clipping and tie-margin problems and scored through the production scorer. Both objectives hit 13 of 18 held-out comparisons at the same 40-call budget. All misses are vowel-*e* pairs whose kept forecast is below the analysis floor, so the comparison has little power. The spectral objective is invariant to level differences up to ±24 dB, which the UI states. Revision 1 remains as recorded.

**Source family.** On an equal budget the geometric family won 4 of 8 cases and two-mass 1 of 8 (6 and 0 with the pitch term excluded), with 2 failures each, but most scorable cases came from geometric generators and calibration always chose the same skew. The two-mass family missed its requested F0 by 11 Hz on average (up to 60 Hz); geometric by 0.04 Hz. The result does not support changing the default.

**Motion.** A trajectory that beats a constant control path is not evidence of articulation change: noise and pitch-bank switches can produce the improvement, and a source mismatch is not detected. The comparison is reported with that caveat in the UI and in Astra's context.

The native library exposes full tract sections and transmission-line matrices covering pharynx, mouth, nose, fossa and sinuses. The five-equation oral/nasal external-drive solve described on September 10 is not present on any branch; the nasal operator starts from design.

## Roadmap after the queue

1. **Owner decisions** listed in the table and in the default-protocol note.
2. **Nasal operator** ([design](../physiology/nasal-operator-design.md)): the native library already exposes all 93 tube sections and per-branch ABCD matrices, and a network solve from them reproduces the native full-tract transfer to within 2e-9. Implementation needs owner approval for a small native patch, because the matrices exist only on the library's 44100/N frequency grid. Then bind the native branch matrices and solve the coupled oral/nasal network with explicit CGS→SI conversion, frequency-grid bounds and declared coupling; compare network limits and held-out cases. Do not substitute a guessed nasal tube or equate velum opening with nostril occlusion.
3. **Measured probe calibration:** derive calibration arrays from a reference-microphone sweep, and have the USB pull record device and archive hash (or the iPhone sign the manifest) so provenance stops being self-declared.
4. **Evaluation revisions:** spectral revision 3 (count unscorable kept candidates as unscorable, per-objective margins) and source revision 2 (a calibration condition both tracts can score, more two-mass generators), each frozen before its run.
5. **Session ledger size (resolved on `claude/ledger-v2`):** full-state events made the replay grow quadratically (the four-forecast app loop reached 23.9 MB of the 25.2 MB export bound). New events carry only the digest of a content-addressed state tree whose nodes are stored once per session ([ledger format](../../science/SESSION.md)); v1 events stay untouched. The app loop now stores 0.92 MB and replays 1.98 MB, adding about 0.29 MB per Astra round. Returning to older code after the first new write needs a pre-upgrade database backup. Still open: the read-only `GET /sessions/:id/ledger` route does not run the control-digest check (`session_control.verify_ledger`) that `state` and `replay` run.
6. **Test infrastructure:** investigate the Linux numerical divergence.
7. **Physical and human acceptance (blocked on people and devices):** signed iOS build on the iPhone 13 Pro Max and iPhone 15 Pro, rear-LiDAR and probe calibration, two real Astra-guided loops, and the held-out human evaluation matrix. This host has no full Xcode, and live Astra calls cost money.

## Shared integration contract

Every handoff must include: commit, branch, exact command, contract/version, expected artifacts, actual checks, evidence source (`synthetic`, `reference object` or `human`), scientific outcome (`untested`, `positive`, `negative` or `inconclusive`) and known limitations. New forecasts are frozen before target recordings. Model updates and no-change decisions retain parent IDs and artifact hashes. Legacy receipts must remain explicitly unverified when their scorer policy was not pinned.

The next agent should start from a clean `main`, create a new worktree per feature, integrate one lane at a time, and keep every suite CI runs green (lint, build, Node, science, browser and the worker-backed browser checks) before merging. Keep API keys in the private `.env`; no handoff document should contain them. Never treat a generated fixture or a successful plumbing test as human anatomical validation.

## Useful commands

```sh
cd "/Users/nicolelu/Documents/ChatGPT/New project/singing-teacher-repo"
git fetch origin
git switch main
git pull --ff-only origin main
npm ci
npm run build
npm run lint
npm test                        # every Node test; needs the science setup below
npm run test:science -- -n auto # the science suite on all cores
npm run test:e2e                # browser checks against the real app server
OPENAI_ENV_FILE="/path/to/private/.env" \
LOCAL_DATA_DIR="/path/to/private/.local-data" \
SCIENCE_DATA_DIR="/path/to/private/.local-data/science-jobs" \
PHONATION_SOURCE_ENABLED=1 PHONATION_MEASUREMENT_ENABLED=1 \
LIDAR_PREVIEW_ENABLED=1 LIDAR_FUSION_ENABLED=1 \
VISUAL_LIKELIHOOD_ENABLED=1 VISUAL_TEACHING_ENABLED=1 \
VISUAL_TEACHING_MODEL_ENABLED=1 VISUAL_TEACHING_AUDIO_ENABLED=1 \
npm run science:local
```

One-time science setup (native build and virtualenv) is in [science/README.md](../../science/README.md#setup). For a targeted Python check:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest <targeted-tests> -q
```

The `OPENAI_ENV_FILE` value above is a path placeholder. Never commit the actual key, copy it into a report, or run broad live-provider loops while developing numerical code.

## Documentation map

- [Current merged implementation status](../implementation/current-status.md)
- [Delivery and recovery audit](2026-09-10-delivery-audit.md)
- [Wave 3 scientific plan](../physiology/wave3-scientific-plan.md)
- [Research-harness completion definition](../physiology/research-harness-finish-plan.md)
- [Astra execution](../implementation/ASTRA-INTEGRATION.md)
- [LiDAR status](../implementation/LIDAR-STATUS.md)
- [Phonation/source status](../implementation/PHONATION-STATUS.md)
- [Visual/teaching status](../implementation/VISUAL-EXPERIMENTS.md)
- [Probe app contract](../implementation/PROBE-APP.md)
- [Replay limitations](../../science/SESSION_SCORE_RECOMPUTATION.md)
- [Visible tongue region baseline](../implementation/TONGUESAM-BASELINE.md) and [its benchmark](../implementation/TONGUE-DETECTION-BENCHMARK.md)
- [Melodic transfer](../evaluation/MELODIC_TRANSFER.md)
- [Two-mass source family](../../science/MECHANICAL_SOURCE.md) and [its comparison](../../evaluation/wave3/source/README.md)
- [Spectral objective](../physiology/WAVE3_SPECTRAL_OBJECTIVE.md), [its evaluation](../../evaluation/wave3/README.md) and [review](../physiology/wave3-review.md)
- [Cue-to-execution learning](../../science/CONTROL_PCM.md)
- [Coupled oral/nasal operator design](../physiology/nasal-operator-design.md)

Historical plans and reviews remain useful for rationale, but this handoff and the current-status document are authoritative for what is merged today.
