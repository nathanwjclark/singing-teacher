# Research harness completion and three-hour finish plan

Revision 8 is the authoritative hackathon completion definition. It supersedes earlier implications that model accuracy, identifiability, positive modality comparisons or demonstrated learning improvement must pass before the app is considered complete. Preserve those scientific questions and their scoring tools; prioritize working feature connections now.

## What we are finishing

Build an executable personalized physiological research system: collect real evidence -> fit physical hypotheses -> Astra selects and explains a supported next action -> record the attempt and sensations -> score against the frozen prediction -> update or retain hypotheses with a reason -> visualize and replay the experiment.

The initial physical model may be coarse, inaccurate, ambiguous and untuned. A poor prediction followed by a faithful discrepancy report and useful next experiment is a valid demonstration. No positive anatomical recovery or coaching-efficacy result is required. A model that never receives the recordings, an unrelated anatomy animation, fabricated predictions, or scripted text presented as live Astra reasoning is an incomplete feature connection.

Use three independent status fields per feature:

- Implementation: planned, connected, or verified end to end on a specified commit.
- Evidence source: synthetic, physical reference object, or human; include artifact IDs.
- Scientific outcome: untested, positive, negative, or inconclusive, with score and assumptions.

Do not mark an implementation failed merely because a scientific score is poor. Do not mark it complete merely because its module tests pass. Invalid evidence must be rejected with a useful explanation; it need not force a numerical update. At least one valid supported observation must traverse the actual update path, while mismatch and unchanged-model paths also remain explicit.

## Completion checklist

| Capability | Finish criterion | Accuracy outcome required? |
|---|---|---|
| Capture and ingestion | Real recordings reach their consumer with original bytes, timestamps, provenance and missing-data flags. | No |
| Optional rear LiDAR — A-owned, not a release gate | Independently gated capture, preview and supported geometry fusion; compare against TrueDepth using measured targets. Disabled, absent or failed LiDAR preserves the existing app flow. See [LIDAR-01–05](optional-lidar-plan.md). | No requirement to outperform TrueDepth; physical acceptance and model contribution reported separately |
| Physical inference | Actual supported observations affect fitting/ranking of physical hypotheses; parameters and limits explicit. | No recovery threshold |
| Optional phonation and closure inference — not a release gate | When enabled, versioned audio descriptors reach their declared coaching/model consumers; full integration includes a forecast, recording, score and replay. Disabled, absent or failed capabilities preserve the core flow without false closure conclusions. See the [phonation plan](phonation-and-closure-plan.md), PHON-01–05, for graceful degradation. | No exact closure-recovery threshold; paired reference validation reported separately |
| Runtime Astra | A real server-side model invocation inspects hypotheses/forecasts, selects a supported action and gives an intuitive instruction. | No optimal-policy proof |
| Experiment execution | The instructed task is recorded; prediction is committed before outcome; unsuccessful attempts retained. | No successful gesture required |
| Score and update | Compare compatible quantities, then produce a new model version or explicit mismatch/no-change decision; retain history. | No prediction-error threshold |
| Embodied teaching | Record sensation, retrieve a personal cue, run recall/phrase-transfer protocol and display its results. | No learning improvement required |
| Illustrated physiological coaching — A-owned extension | Link the selected cue to before/after anatomy, intuitive mechanism, supported model predictions and recorded outcome comparison. Deliver cricothyroid and soft-palate educational mechanisms; independently gate personalized modes with text/static fallback. See [VIS-TEACH-01–05](visual-teaching-plan.md). | No learning-effect threshold; educational images alone do not establish personalized physiology or complete model-driven teaching |
| Visualization | Display measured evidence and the actual model state/alternatives, with inferred/fixed/unsupported distinctions. | No claim of accurate hidden anatomy |
| Active acoustic probing | Real external drive/response reaches a supported external-drive operator and joint fit; display its contribution or rejection. | No demonstrated added accuracy |
| Reproduction | Replay the selected run and recover its recorded inputs, decisions, scores and model lineage. | No favorable result required |

Hardware-modality limits stay visible. Audio-only success does not establish depth integration; capturing a sweep without a model consumer does not complete acoustic probing. Optional second-phone/nasal channels can remain explicitly unfinished while the supported one-phone path is completed. General sinus topology, tissue mechanics and population efficacy remain research goals.

Existing G0-G9 gates retain their artifact/chronology/integration requirements. G2 means the hidden-synthetic evaluation executes correctly, not that recovery error passes a threshold. G3/G6 mean actual supported human evidence traverses fit/motion paths, not that inferred anatomy is validated. G7 means recall/transfer is executed and scored, not that the learner improves. G8/G9 mean real probe-to-model and Astra-orchestrated execution, not accurate echo tomography. Scientific positive-result flags remain separate from these implementation gates.

## Three-hour execution window

This is a relative finish schedule starting from team adoption, not an automated timer or an assertion about remaining wall-clock time. No agents are launched by this document.

| Window | A: model and service | B: product and integration | Exit artifact |
|---|---|---|---|
| 0-30 minutes | Freeze current supported fit/design/update interfaces and publish reviewed handoff. | Establish shared integration commit, actual private capture handoff and runtime Astra owner. | One session contract and runnable producer/consumer commands. |
| 30-90 minutes | Connect real media to physical fit, candidate export, forecasts and update; preserve execution assumptions. | Wire UI, actual Astra calls/tool routing, instructions, recording, scoring and model display. | First real capture -> model -> Astra action -> new observation -> score/update loop. |
| 90-135 minutes | Fix integration/numerical-semantics failures; finish supported probe/model and motion connections. | Repeat actual device flow; finish cue/sensation and probe UI; test stop/retry/replay. | Two complete runs; capability matrix identifies unfinished paths. |
| 135-180 minutes | Freeze behavior and verify replay/model provenance; resolve release-blocking defects. | Rehearse demo, verify startup/recovery and prepare explicitly labeled recorded fallback. | Reproducible application and evidence-backed demonstration. |

At 90 minutes, prioritize any broken edge of the main loop over all model tuning. Active probing remains an implementation workstream: aim for its complete one-phone path, but do not conceal a missing external-drive operator or block every other feature on two-phone support. If unfinished at the cutoff, report the exact missing connection. This is explicit remaining scope, not a silently substituted feature.

## Rebalance existing agents

A integration owner assembles the current scientific queue rather than starting another optimizer. A data/model agent connects verified media and supported geometry to fitting. A numerical reviewer checks quantities, native basis, execution assumptions and leakage on the selected path. B runtime-Astra owner implements model invocation and deterministic tool execution; B session/UI owner connects the app; B acquisition owner handles actual device capture, calibration and probing; B end-to-end reviewer independently executes the flow.

Reuse existing owners and worktrees. Extra available capacity can complete the PROBE capture/DSP and external-drive physics pair in parallel, with shared files still owned by their current maintainers. Human leads coordinate private data/device access and decide the supported demonstration protocol. Do not interrupt or transfer an active task implicitly; record the handoff first.

Defer broad accuracy tuning, new optimizer comparisons, large robustness matrices, population training and additional visual polish. Preserve already obtained negative findings. Keep targeted checks for incorrect physics/units, invalid source lineage, numerical crashes, clipping, contaminated forecasts, broken state transitions and misleading presentation: those are harness correctness, not optional tuning.

Independent evaluation now primarily verifies that experiments are honestly recorded and correctly scored. B does not need a positive recovery result to accept a functioning research workflow. Comparative studies can run later using the same harness.

## Runtime Astra acceptance

The application must call Astra during the session, not merely display a generated plan. Keep API credentials server-side. Supply compact model hypotheses, real numerical forecasts, capture quality and learner history. Use the available documented tool interface for supported actions; deterministic code validates IDs, budgets and action constraints. Log model/configuration, tool inputs/results, instruction and outcome lineage without secrets. A generated explanation is not a simulated acoustic result.

Demonstrate that the next decision consumes newly measured evidence: Astra selects a supported action, explains it as a familiar cue, receives the score and then revises its instruction or explains why more information is needed. Handle unavailable API, rejected action, stopped recording and failed fit without fabricated success. A recorded fallback must be labeled replay; it does not satisfy live runtime acceptance by itself.

## Demonstration narrative

“We built a system that conducts personalized physiological experiments and learns from them. Here it is running on a person, including where its current model is wrong.”

Show an initial recording and candidate anatomy, an Astra-selected action and prediction, the new attempt, the observed discrepancy, and the model/teaching update. A retained ambiguity or detected mismatch is an informative result. Show what the software did separately from what the experiment established. This retains the physiological moonshot while making the hackathon deliverable a complete research harness.
