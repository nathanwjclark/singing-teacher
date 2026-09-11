# Lead B implementation queue

> Historical queue retained for contract provenance. The original prototype
> tickets below are integrated or superseded; their old “planned” wording does
> not describe the current repository. For the authoritative merged state and
> active third-wave work, use [current status](current-status.md) and the
> [Wave 3 handoff](../coordination/WAVE3-HANDOFF.md). No row in this historical
> board is a claim of physical-device or scientific accuracy acceptance.

Snapshot started from `30eaf6d78a4bc6c2c343c87f11043e9a44eee864`. Lead B is the integration owner and updates this board as agents are dispatched and reviewed. “Queued” means assigned scope, not completed work. Each ticket gets a separate worktree and one owner for each changed file. No ticket below claims scientific or device acceptance.

Status vocabulary: queued → in progress → review → integrated; blocked records its missing input. Record contract versions and actual integration commits at handoff. Lead A reviews scientific meaning and numerical claims.

| Ticket | Owner | Status | Prerequisites / bounded work | Acceptance evidence | Branch / PR | Contract / start |
|---|---|---|---|---|---|---|
| KIT-01 | B / contracts agent | integrated prototype | Revision 5; establish versioned artifact interfaces | Validate and replay supported records; incompatible versions rejected; genuine producer artifacts remain pending until available | `3dafa97` | KIT 1.0.0 |
| INT-01 | B / integration agent | integrated prototype | Existing npm scripts and worktree policy | Light lint/typecheck/build CI; local integration instructions; no CD | `364e86f` | KIT 1.0.0 |
| CAP-01 | B / phone capture agent | integrated prototype | KIT-01 observation skeleton; secure reachable phone origin | QR pairing; guided mouth bootstrap snapshots with visible CV; optional phone microphone; measured device limitations | `a2170dd` | KIT 1.0.0 |
| CAP-02 | B / recording agent | integrated prototype | Capture timestamps and observation schema | Explicit start/stop; recording off by default; export/replay preserves timing and missing data | `e9f0410` | KIT 1.0.0 |
| AUD-01 | B / acoustic agent; A review | integrated prototype | Canonical feature definitions; actual audio input | Shared observed/synthesized extractor; automatic microphone/room calibration with quality limits | `b4d64d1` | KIT 1.0.0 |
| EVAL-01 | B / evaluation agent | integrated prototype | Scoring protocol; KIT-01; executable producers for full acceptance | Independent held-out scoring, equal-budget baseline, provenance and leakage rejection; research does not count as labeled validation | `0ed3c0d` | KIT 1.0.0 |
| ACT-01 | B / orchestration agent | integrated prototype | Forecast contract; PRED-01, capture and evaluator for real loop | Validate proposal → freeze prediction → capture → score → permit update; retain failures | `9075f36` | KIT 1.0.0 |
| DEPTH-01 | B / prospective depth agent | integrated prototype | A's PRED-01 numerical forecasts; genuine calibrated depth capture | Prospective experiment records frozen forecast and measured outcome; missing depth stays explicit | `778d438` | KIT 1.0.0 |
| DEPTH-02 | B / comparison dashboard agent | integrated prototype | Common evaluator; equal evidence/compute budgets | Dashboard compares audio, audio+RGB, audio+RGB+depth, including unavailable inputs and null results | `f6db7a1` | KIT 1.0.0 |
| VIS-01 | B / anatomy visualization agent | integrated prototype | Genuine geometry/model contract for mapped anatomy | Default/mapped toggle; provenance and unsupported or absent mapped geometry clear | `ce4a8a0` | KIT 1.0.0 |
| REP-01 | B / reproducibility agent | integrated prototype | Immutable evidence, evaluator and versioned artifacts | Export/replay report includes versions, budgets, every attempt, failures and limitations | `2404840` | KIT 1.0.0 |

User scope decisions: keep testing light; no CD; deploy locally; recording is opt-in; phone bootstrap runs in the browser while native depth remains a separately verified capability. Phone microphone operation is distinct from bootstrap. Webcam appearance does not establish internal muscle position or sound quality.

Cross-cutting investigations: microphone/room compensation belongs to AUD-01; evidence integrity to EVAL-01/ACT-01; device reliability to CAP-01/CAP-02; incremental depth value to DEPTH-02. Public hosting or tunneling requires a separate discussion before launch.

## Handoff record

Append one short entry per reviewed integration:

```text
Ticket / implementation owner / reviewer:
Starting commit / feature branch / owned files:
Contract version / prerequisite artifacts:
Handoff commit / actual commands and results:
Manual acceptance / missing device or scientific evidence:
Integrated commit / local deployment result / worktree cleanup:
```

The integrator updates status after review; an agent's completion report alone does not mark a ticket integrated. See [INT-01](INT-01.md) for the minimal workflow.

## INT-01 handoff

- Base: `30eaf6d78a4bc6c2c343c87f11043e9a44eee864`; branch: `feat/int01-light-ci`.
- Owned files: `.github/workflows/ci.yml`, `docs/implementation/INT-01.md`, this board.
- Local `npm ci`, `npm run lint`, `npm run build`, and `git diff --check` passed. Build emitted the existing large-bundle advisory.
- Hosted CI execution, integration, local deployment and worktree cleanup are pending the integration owner. No device or scientific acceptance is claimed.

## Current integration evidence

All eleven bounded agents returned separate commits. Build/typecheck and lint pass. Focused checks covered contract validation, immutable chronology, equal-budget scoring/comparison, saved MediaRecorder artifacts, pixel-to-tongue animation, WebRTC peers, QR generation, model import integrity, replay audit and the 1280×720 Studio layout. CI runs build/lint only; there is no CD. Local deployment uses `npm run local`.

Remaining acceptance dependencies: a trusted HTTPS connection and physical phone testing; native depth acquisition/calibration; Lead A engine-generated forecasts, candidate geometry and actual fitting; independent human-data evaluation. The integrated prototype exposes these gaps explicitly. Automatic ambient calibration estimates relative noise/SNR; full microphone/room transfer-function recovery is not claimed. No datasets were downloaded or trained on.

## Revision 6 and cross-lead integration update

The original eleven rows remain prototype implementation statuses, not scientific acceptance. The repository now includes Nicole's reviewed PR #3 scientific queue, native engine replays, a real native audio/geometry → KIT adapter, and the controlled native PCM commitment → later synthesis → independent scoring replay. See [the acceptance ledger](LEAD-B-ACCEPTANCE.md) for commands and explicit remaining gates.

| Ticket | Implementation now available | Acceptance still requiring external evidence |
|---|---|---|
| CUE-01 | Source-attributed cue candidates, actual specialist-review entry, explicit attempt recording/replay, sensation and mnemonic memory | Actual teacher/specialist review of wordings for the learner/context |
| LEARN-01 | Frozen pitch protocol, baseline/variant, cue-free recall, phrase transfer, new-session delayed retention, independent score and failure retention | Real learner comparison/retention evidence; no efficacy claim |
| MOT-02 B capture | Repeated neutral/gesture/return video/audio and visible-motion traces, timestamps, markers, export/replay | Native calibrated RGB-D/head pose and actual visible observations affecting fitting |
| KIT/AUD handoff | Validated genuine native mesh/audio and canonical measurements; fixed-parameter geometry displayed in web viewer | A's microphone-source/capture likelihood and human fitting |
| Pitch repair | Rate-aware live analysis; explicit no-pitch reasons; 10Hz saved pitch replay/export | User's actual mic/phone route confirmation |

Private Wi-Fi HTTPS is prepared and locally deployed. A native TrueDepth/RGB/optional-PCM app is now implemented and compiles unsigned; physical device acquisition acceptance remains unfinished. The browser surface capture route was a user-selected prototype scope, not satisfaction of the native device gate. The new surface-reconstruction direction does not turn estimated landmark z into measured depth.

## Planned active acoustic probing (revision 7)

Newly planned scope, not implementation claims. The [active probing plan](../physiology/active-acoustic-probing-plan.md) defines contracts, user flow, external-drive physics and acceptance.

| Ticket | Accountable owner | Status | Next dependency / acceptance |
|---|---|---|---|
| PROBE-01 native drive/record | B capture | planned | Supported full-duplex route and reviewed level protocol; real drive/response capture with local stop. |
| PROBE-02 response records/DSP | B contracts/acoustics | planned | Minimal schema agreement; verified source data and repeat-derived response quality. |
| PROBE-03 external-drive operator | A physics | planned | Shared tube geometry and explicit lip/source boundaries; analytical checks and supported channels. |
| PROBE-04 inverse/service | A inverse/service | planned | PROBE-02/03; actual response contributes to joint anatomy fit with bounded nuisance model. |
| PROBE-05 Astra/UI | B orchestration/teacher | planned | Real responses/forecasts; runtime tool-mediated probe selection and scored adaptation. |
| PROBE-06 evaluation | B evaluation; A review | planned | G8 real capture-to-fit and G9 prospective Astra loop; compare with/without probing, retain null results. |

Existing lane owners coordinate edits; this board update does not assign running agents or change current acceptance statuses.

## Revision 8: research-harness finish priorities

The [three-hour finish plan](../physiology/research-harness-finish-plan.md) is authoritative for hackathon completion. Preserve all existing implementation/evidence statuses; no gate is marked passed by this planning change. Track implementation, evidence source and scientific result separately. Accuracy/identifiability/learning improvement are not release requirements.

| Priority | Owner | Required handoff |
|---|---|---|
| Shared runnable commit | A publishes; B integrates | Existing fit/design/update, media and KIT paths execute together. |
| Runtime Astra | B server/orchestration | Real API invocation chooses a supported action from actual model evidence and adapts after score. |
| Recording-to-model | A adapter/inverse; B ingestion | Verified real media affects the physical hypotheses; no disconnected import-only completion. |
| Session/UI | B | Instruction, recording, score, actual model display, sensation memory and replay work end to end. |
| Probe connection | Existing PROBE owners | One-phone real drive/response reaches supported external-drive model; accuracy gain not required. |
| Acceptance | B end-to-end reviewer; A numerical review | Two runs plus replay; quantity, provenance, chronology and failure checks. |

Allocate agents to these connections before broad robustness studies, tuning or additional visual polish. At 90 minutes, repair broken main-loop edges first; use the final 45 minutes for defects, startup/recovery and rehearsal. Preserve negative research results and report any unfinished modality or operator explicitly.
