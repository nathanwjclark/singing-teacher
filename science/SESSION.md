# Durable local scientific session controller

`SessionController(root, service: JobService, session_id).execute(command)` accepts
JSON-compatible dictionaries. Use a controller root separate from the existing
JobService root. The HTTP transport supplies paths; clients cannot select paths
or executables. No Engine is opened in the controller thread. Search, numerical
design and update run through the existing isolated JobService queue.

Read commands are `{"action":"state"}` and `{"action":"replay"}`. Both return
`state` and `ledger_sha256`; replay additionally returns immutable ledger events.
State contains version, snapshot, calibration, pending, designs, attempts,
sensations and completed jobs. A pending job has `job_id` after dispatch. Poll the
JobService status; collect only when terminal. There is one outstanding numerical
job per session, not a separate scheduler.

Every mutation requires `action`, `command_id`, and integer `expected_version`,
plus exactly the fields below. Reusing a command ID requires byte-equivalent
canonical JSON, including the original version; it returns current state without
repeating the transition. New commands must match the latest state version.
Dispatch itself adds an event, so always use the returned version.

| Action | Additional fields |
|---|---|
| register_model | snapshot: frozen PCM hypotheses dictionary |
| ingest_calibration | document: canonical PCM observation document |
| search | parameters: anatomy_bounds, nuisance_profiles, optional max_synthesis_calls, rounds, seed |
| propose_design | parameters: design_id, target_observation_id, experiments, feature_scales; optional minimum_separation, max_synthesis_calls, retention_margin, maximum_discrepancy, profile |
| collect_job | job_id |
| submit_outcome | design_id, parameters: experiment_id, observation_id, artifact_id, observed_at, pcm, source_kind; optional sample_rate_hz, frame_start_sample, frame_size matching the committed profile |
| record_attempt | design_id, attempt_id, status (stopped or failed), reason |
| record_sensation | attempt_id, text |

Session calibration supports the fitter's 44100, 48000 and 96000 Hz rates,
B canonical frame size for each rate, declared 0.1–5 second duration and exact
source-window offsets. Frames must fit inside the declared duration; repeated
physical intervals are rejected. Prospective design retains its separate fixed
44100 Hz, 4096 sample, offset 4410, 0.25 second profile. Ingestion checks canonical feature validity and
B contract validation; source crop/pose and complete operator support are checked
again by the real search job. This is a restricted supported path, not acceptance
of arbitrary microphone artifacts. Calibration is immutable after modeling starts.

Successful search collection freezes at most 32 unique scored full applied
geometries, ordered by discrepancy and candidate ID; the original complete search
result remains in the ledger. Selection/truncation is declared, not a posterior.
A supplied frozen model is validated without opening native state, then actual
worker operations verify native provenance. Successful design collection commits
the design and server receipt timestamp before accepting any outcome. An outcome
must match the selected experiment, target and current model; caller-declared
capture time must follow this local commit. The worker additionally verifies raw
frame hashes, feature support, chronology and all design/snapshot bindings.

Model update occurs only on explicit collection of a successful current job.
Mismatch/missing-feature outcomes preserve the numerical module's status and
retained support. Failed/cancelled jobs remain visible. Stop or failure of an
active attempt prevents subsequent outcome ingestion; if its update is running,
the service job is cancelled and its result can never be published by this
controller. Subjective sensations remain separate notes and never enter model
parameters, evidence scores, or anatomy bounds. Successful/failed update jobs
also create attempt records addressable by their observation ID.

SQLite `BEGIN IMMEDIATE` serializes state transitions across controllers/threads.
A persisted launch intent precedes submission; its stable JobService idempotency
key recovers a crash between job creation and local ID receipt. Startup/read
reconciles an undispatched intent. Existing queued/running jobs obey JobService's
restart policy; they are never silently re-executed. Controllers own their
session's model registry; do not mutate that registry through another API.

Events include full state, command hashes, previous-event hashes, receipt times
and session identity. Replay verifies every stored event/hash link and does not
re-run numerical work. Local root/database permissions are 0700/0600, symlink
root/database and foreign-owned root are rejected, and SQL queries bind session
IDs. This is local integrity detection, not cryptographic protection against a
user who controls and rewrites the database and every hash. External source-byte
authenticity and independent capture-time attestation remain outside this layer.

Explicit orchestration can commit a choice from a current numerical forecast via
`select_experiment`, with `source_design_id`, fresh `design_id`, fresh
`target_observation_id`, `experiment_id`, and bounded `selection_reason` (plus the
usual command ID/version). No job may be pending. The source must be committed or
unsupported and belong to the current snapshot; every selected prediction must
have complete features. The new design preserves all rankings, scores and native
predictions, records its source digest and declared selection policy, and receives
a fresh commit timestamp. The source becomes superseded. Outcomes must reference
the new selected design/experiment/target; old or changed choices are rejected.

A complete forecast with one hypothesis or insufficient separation can be chosen
for a repeated observation. This does not manufacture anatomical evidence:
`update_pcm` retains `no_design_separation` and the existing support when appropriate.
After the outcome creates a successor model, submit a fresh `propose_design` job
using the previous design's experiment list, feature scales, thresholds and native
profile, then collect and explicitly select again. Old-model forecasts cannot be
reused. Selection itself adds zero synthesis calls and carries no physiological
claim about whether a user executed the declared controls.

`fit_probe` accepts `parameters` containing `probe_observations`, `candidates`,
and optional `max_native_calls`, `pcm_weight`, `probe_weight`. It injects the
session's stored PCM calibration and submits existing `fit_probe_pcm` through
JobService. Candidates must supply full anatomies exactly matching current retained
snapshot geometries and cover all of them; nuisance alternatives remain explicit.
No new geometry or invented source/microphone calibration is introduced here.
Previously incorporated raw probe IDs/hashes cannot be reused as new evidence.

Collection of a usable joint result creates a new model ID, retaining every prior
geometry and ordering scored geometries by joint discrepancy. Failed/unscored
geometries remain support, not rejected anatomical possibilities. The snapshot
retains all parent evidence and adds included probe, drive, calibration, timing
and prior lineage plus the original joint-result digest. The complete result and
adoption receipt remain in the session ledger. Old forecasts become stale; the
next forecast must bind the new model. Unsupported or unscorable joint results
remain visible with `session_adoption.status: no_usable_joint_probe_result` and
leave the model unchanged. Successful adoption reports `ranked_retained_support`.

This ranking uses original PCM calibration and newly supplied probe measurements.
Later PCM outcomes are preserved in lineage/current support but are not rescored
by this operator. Ranking is a finite discrepancy comparison, not a cumulative
Bayesian posterior, likelihood calibration, or physiological identification.
