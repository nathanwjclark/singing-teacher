# Lead B implementation queue

Snapshot started from `30eaf6d78a4bc6c2c343c87f11043e9a44eee864`. Lead B is the integration owner and updates this board as agents are dispatched and reviewed. “Queued” means assigned scope, not completed work. Each ticket gets a separate worktree and one owner for each changed file. No ticket below claims scientific or device acceptance.

Status vocabulary: queued → in progress → review → integrated; blocked records its missing input. Record contract versions and actual integration commits at handoff. Lead A reviews scientific meaning and numerical claims.

| Ticket | Owner | Status | Prerequisites / bounded work | Acceptance evidence | Branch / PR | Contract / start |
|---|---|---|---|---|---|---|
| KIT-01 | B / contracts agent | queued | Revision 5; establish versioned artifact interfaces | Validate and replay supported records; incompatible versions rejected; genuine producer artifacts remain pending until available | Pending dispatch record | Pending / base above |
| INT-01 | B / integration agent | review | Existing npm scripts and worktree policy | Light lint/typecheck/build CI; local integration instructions; no CD | `feat/int01-light-ci` | Existing app / base above |
| CAP-01 | B / phone capture agent | queued | KIT-01 observation skeleton; secure reachable phone origin | QR pairing; guided mouth bootstrap snapshots with visible CV; optional phone microphone; measured device limitations | Pending dispatch record | KIT-01 pending / base above |
| CAP-02 | B / recording agent | queued | Capture timestamps and observation schema | Explicit start/stop; recording off by default; export/replay preserves timing and missing data | Pending dispatch record | KIT-01 pending / base above |
| AUD-01 | B / acoustic agent; A review | queued | Canonical feature definitions; actual audio input | Shared observed/synthesized extractor; automatic microphone/room calibration with quality limits | Pending dispatch record | KIT-01 pending / base above |
| EVAL-01 | B / evaluation agent | queued | Scoring protocol; KIT-01; executable producers for full acceptance | Independent held-out scoring, equal-budget baseline, provenance and leakage rejection; research does not count as labeled validation | Pending dispatch record | KIT-01 pending / base above |
| ACT-01 | B / orchestration agent | queued | Forecast contract; PRED-01, capture and evaluator for real loop | Validate proposal → freeze prediction → capture → score → permit update; retain failures | Pending dispatch record | KIT-01 pending / base above |
| DEPTH-01 | B / prospective depth agent | queued | A's PRED-01 numerical forecasts; genuine calibrated depth capture | Prospective experiment records frozen forecast and measured outcome; missing depth stays explicit | Pending dispatch record | KIT-01 pending / base above |
| DEPTH-02 | B / comparison dashboard agent | queued | Common evaluator; equal evidence/compute budgets | Dashboard compares audio, audio+RGB, audio+RGB+depth, including unavailable inputs and null results | Pending dispatch record | KIT-01 pending / base above |
| VIS-01 | B / anatomy visualization agent | queued | Genuine geometry/model contract for mapped anatomy | Default/mapped toggle; provenance and unsupported or absent mapped geometry clear | Pending dispatch record | KIT-01 pending / base above |
| REP-01 | B / reproducibility agent | queued | Immutable evidence, evaluator and versioned artifacts | Export/replay report includes versions, budgets, every attempt, failures and limitations | Pending dispatch record | KIT-01 pending / base above |

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
