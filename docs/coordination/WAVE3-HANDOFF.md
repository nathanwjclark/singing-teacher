# TractStar engineering and scientific handoff

**Repository:** `nathanwjclark/singing-teacher`  
**Merged baseline:** `main` at `304ee87` (PR #21)  
**Handoff date:** 2026-09-10  
**Purpose:** give the next agent enough context to continue the prototype, finish the remaining first- and second-wave connections, and begin the third wave of scientific model improvement without confusing software execution with anatomical validation.

Shareable rendering: [PDF handoff](../../output/pdf/TractStar-Wave3-Handoff.pdf). The Markdown file remains the editable source of truth.

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

## Remaining prototype and first/second-wave closure

The core prototype foundation is runnable on `main`, but the connected research loop
still has a few integration and acceptance items before it should be called complete:

- **App-managed probe setup:** finish the in-app calibration-package flow and its
  browser/native checks. A metadata package must never stand in for a calibrated
  loudspeaker, microphone, placement or timing measurement.
- **Replay/recompute:** register the read-only recompute route and export checks,
  then verify that a retained recording can be recomputed without changing the
  historical forecast or inventing absent media.
- **Melodic transfer:** finish the bounded 2–8-note phrase target and verify
  missing-voicing, timing and unsupported-phrase behavior. Single-note scoring
  must remain backwards compatible.
- **Visible tongue baseline:** review and merge the public region detector only as
  visible-region evidence. Keep the private dynamic diagnostic and any hidden-
  tongue interpretation out of the physiological model.
- **Physical/device acceptance:** run signed iPhone 13 Pro Max and iPhone 15 Pro
  capture, rear-LiDAR calibration, real probe playback and at least two real
  Astra-guided loops. The current host lacks the full Xcode/iOS SDK, so this is a
  separate device lane rather than a local build assumption.

These are software, device and evidence gates owned by the next integration agent;
they do not require claiming that the scientific inverse problem is solved. A lane
is complete only when its contract, exact command, artifacts, test result, evidence
source and limitations are recorded in the handoff and current-status document.

## Current unmerged Wave 3 worktrees

These are research branches, not part of `main`. Preserve their commits and dirty edits; do not cherry-pick blindly across shared files.

| Worktree / branch | Known checkpoint | State and next action |
|---|---|---|
| `singing-teacher-wave3-integration` / `codex/wave3-integration` | `f0868ba` | Root integration scratch branch. Includes merged tongue work and bounded motion-context summarization plus explicit objective/session hooks. Review, then use as the integration base for selected Wave 3 PRs. |
| `singing-teacher-wave3-spectral` / `codex/wave3-spectral` | `8c68f60`, `5813a67` plus dirty edits | Multi-resolution log-spectrum objective, prospective policy pinning and native/app integration are partly implemented. Finish dirty `live_capture_jobs.py`/`pcm_design.py`, verify exact frame binding and run independent evaluation. |
| `singing-teacher-wave3-eval` / `codex/wave3-eval` | `57907c0` | Frozen independent evaluation protocol and first report. The unmodified result is mixed/inconclusive: gain perturbation improves robustness, unseen-vowel generalization is poor, and noise/out-of-support cases can be worse. Do not retune on these held-out cases. |
| `singing-teacher-wave3-control` / `codex/wave3-control` | `304ee87` plus untracked `control_pcm.py` | Architecture handoff is complete. Implement exact cue/context bindings, finite PCM execution banks, repeated-attempt support and residual calibration; root must add shared session/service/Astra/export hooks. |
| `singing-teacher-wave3-tongue` / `codex/wave3-tongue` | `dc0cf51` | Public TongueSAM region baseline, separate region metrics/exports, license/hash verification and browser QA passed. It was merged into the integration scratch branch but not `main`; submit as a focused PR after review. It remains visible-region evidence only. |
| `singing-teacher-wave3-source` / `codex/wave3-source` | `304ee87` plus dirty edits | Native two-mass source-family investigation is underway. It needs a guarded engine family switch, provenance restoration and equal-budget held-out comparison before integration. |
| `singing-teacher-wave3-motion` / `codex/wave3-motion` | `7bd8c58` plus `.local-tests` | Time-resolved conditional audio bank and uncertainty sets are implemented and native generated tests passed. Finish HTTP/browser verification, clean test artifacts and review source/articulation confounding. |
| `singing-teacher-wave3-probe` / `codex/wave3-probe` | `304ee87` plus dirty edits | In-app calibration-package setup is implemented in progress. Finish tests/docs, then integrate without allowing metadata to substitute for calibration evidence. |
| `singing-teacher-wave3-replay` / `codex/wave3-replay` | `37d4d54`, `77798af` plus dirty tests | Read-only batch recompute route/UI and spectral policy work exist. Register route/export checks on the integration branch and finish actual HTTP/browser verification. |
| `singing-teacher-wave3-phrase` / `codex/wave3-phrase` | `304ee87` plus dirty edits | Short 2–8-note frozen melody scoring is in progress. Finish browser QA, then review timing/voicing/missing-data semantics. |

The old worktree inventory also contains many historical agent branches. They are not a task board. Use `git log`, the relevant plan and this handoff before reviving any one.

## Wave 3 scientific work already learned

The native library exposes a real two-mass glottis family in addition to the geometric glottis. A guarded family switch can produce distinct dynamic waveforms, but requested F0 and observed F0 may differ; that difference must be recorded. It is not evidence of measured fold mechanics.

The native library also exposes full tract sections and transmission-line matrices covering pharynx, mouth, nose, fossa and sinuses. A five-equation oral/nasal external-drive solve has passed numerical reciprocity and residual checks, including exact zero nasal flow for a rigid sealed boundary. The next implementation should bind those native matrices and solve the coupled network using real native geometry, explicit CGS→SI conversion, frequency-grid bounds and declared source/receiver coupling. Do not replace the native nasal branch with a guessed tube or equate velum opening with nostril occlusion.

The first independent spectral evaluation is deliberately mixed: the richer objective is more robust to gain perturbation, but unseen-vowel generalization is weak, noise/out-of-support cases can degrade, and some predictions are unavailable or tied. This is exactly the evidence boundary the next agent must preserve. Wave 3 is not a license to call the new objective “more accurate” without a fresh held-out comparison.

## Prioritized continuation plan

1. Integrate the spectral branch only after its policy, exact original-frame binding, legacy compatibility and independent report are complete. Compare coarse and multi-resolution objectives at equal native budgets; retain both scores.
2. Implement cue-to-execution learning. Freeze the exact delivered cue and context before each attempt, match history by full anatomy/native/extractor/profile/cue/context identity rather than model ID, score a finite PCM control bank, and use at least three matched attempts to weight the next frozen forecast. Keep empirical microphone residuals separate from inferred physical controls.
3. Complete the two-mass source-family adapter and evaluate source-family selection on unseen pitch/vowel/source conditions. Do not call prescribed source parameters vocal-fold closure or muscle activity.
4. Integrate the time-resolved motion bank and the coupled oral/nasal probe operator. Preserve unvoiced, noisy, occluded and out-of-support windows as explicit missing evidence.
5. Complete in-app probe setup and read-only replay/recompute, then add the melodic transfer protocol. Each must have actual browser/native acceptance and a clear unsupported path.
6. Merge the tongue baseline as a separate visible-region feature after license, asset-hash and model-fallback review.
7. Run physical acceptance on both available iPhones: signed iOS build, permissions/interruption/camera-return, real depth/RGB/PCM timing, known-target calibration, actual acoustic-probe calibration and two real Astra-guided loops. The current host has Command Line Tools but no full Xcode/iOS SDK (`xcodebuild` unavailable).
8. Run the scientific evaluation matrix: held-out humans/reference objects, anatomy/source/articulation compensation, room/device perturbations, audio vs audio+RGB vs audio+RGB+depth at equal budgets, model mismatch, identifiability and cue-free phrase transfer. Positive recovery is not required; honest negative/inconclusive results are required.

## Shared integration contract

Every handoff must include: commit, branch, exact command, contract/version, expected artifacts, actual checks, evidence source (`synthetic`, `reference object` or `human`), scientific outcome (`untested`, `positive`, `negative` or `inconclusive`) and known limitations. New forecasts are frozen before target recordings. Model updates and no-change decisions retain parent IDs and artifact hashes. Legacy receipts must remain explicitly unverified when their scorer policy was not pinned.

The next agent should start from a clean `main`, create a new worktree per feature, integrate one lane at a time, run build/lint plus targeted tests, then run the real browser/native acceptance before merging. Keep API keys in the private `.env`; no handoff document should contain them. Never treat a generated fixture or a successful plumbing test as human anatomical validation.

## Useful commands

```sh
cd "/Users/nicolelu/Documents/ChatGPT/New project/singing-teacher-repo"
git fetch origin
git switch main
git pull --ff-only origin main
npm install
npm run build
npm run lint
npm test
OPENAI_ENV_FILE="/path/to/private/.env" \
LOCAL_DATA_DIR="/path/to/private/.local-data" \
SCIENCE_DATA_DIR="/path/to/private/.local-data/science-jobs" \
PHONATION_SOURCE_ENABLED=1 PHONATION_MEASUREMENT_ENABLED=1 \
LIDAR_PREVIEW_ENABLED=1 LIDAR_FUSION_ENABLED=1 \
VISUAL_LIKELIHOOD_ENABLED=1 VISUAL_TEACHING_ENABLED=1 \
VISUAL_TEACHING_MODEL_ENABLED=1 VISUAL_TEACHING_AUDIO_ENABLED=1 \
npm run science:local
```

For Wave 3 Python checks, use the existing shared environment when available:

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

Historical plans and reviews remain useful for rationale, but this handoff and the current-status document are authoritative for what is merged today.
