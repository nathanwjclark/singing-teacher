# Durable local scientific session controller

`SessionController(root, service: JobService, session_id).execute(command)` accepts
JSON-compatible dictionaries. Use a controller root separate from the existing
JobService root. The HTTP transport supplies paths; clients cannot select paths
or executables. No Engine is opened in the controller thread. Search, numerical
design and update run through the existing isolated JobService queue.

Read commands are `{"action":"state"}` and `{"action":"replay"}`. Both return
`state` and `ledger_sha256`; replay additionally returns immutable ledger events
and, once the ledger holds a format 2 event, the state `nodes` those events name
(see Ledger format below).
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

Events include the state (see Ledger format), command hashes, previous-event
hashes, receipt times and session identity. Replay verifies every stored
event/hash link and does not re-run numerical work. Local root/database
permissions are 0700/0600, symlink root/database and foreign-owned root are
rejected, and SQL queries bind session IDs. This is local integrity detection, not cryptographic protection against a
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

## Optional source-model lifecycle

Three additive commands reuse the existing isolated numerical JobService:

- `fit_source`: `parameters` has document/candidates and optional
  max_synthesis_calls/timeout_s. The source document uses PHONATION_SOURCE.md.
  Candidate anatomies must exactly cover the current baseline's full retained
  geometries. Every trial's metadata must identify this session and original
  artifact hashes. A successful worker result is adopted only when all candidates
  in all three comparison families are scorable with equal recorded compute.
- `forecast_source`: `parameters` has family, candidate_id, reference_trial_id,
  pose, controls (JA/F0/PR/gain), and fresh target_id. It injects the authoritative
  source fit. Collecting the completed worker commits an immutable artifact in
  source_forecasts[target_id] before accepting capture.
- `score_source`: forecast_id, pcm, metadata. It requires the current baseline
  and source model, exact target, post-session-commit evidence timestamp and
  disjoint original artifact IDs/hashes. Native sample rate, window and scoring
  policy are frozen. The numerical score records explicit model_updated:false;
  it never silently refits anatomy or source parameters.

Usual command_id and expected_version rules apply. All worker requests explicitly
opt into the optional capability. source_model is a separate artifact containing
model_id, baseline_model_id, parent_source_model_id, result, result_sha256,
evidence_ids/hashes and adopted_at. source_forecasts records source/baseline IDs,
artifact, committed_at, status and later score_result. source_receipts records
attempts, failures and adoption; source_status reports the latest optional result.
Old sessions may lack these fields and remain valid. A baseline model change makes
source forecasts stale. Failed, cancelled, incomplete or unavailable enhancements
preserve both the baseline snapshot and any prior valid source artifact.

Calibration evidenceAt may be null when absolute capture UTC is unknown;
calibration fitting does not require prospective time proof. Do not replace unknown
capture time with receipt/re-import time. Held-out evidenceAt must represent the later capture,
not a re-import timestamp. Original hashes are excluded conservatively across
calibration/heldout artifacts. The low-level session API cannot authenticate device
clocks or supplied raw files; app importers retain that responsibility.

## Ledger format

Each event row stores canonical JSON (sorted keys, compact, ASCII) and its
SHA-256. Two event formats exist:

- **v1 (full state)**: `session_id`, `previous_sha256`, `action`, `received_at`,
  `details`, `state`. Written before format 2 existed. These rows are never
  rewritten and read back byte for byte (`science/tests/test_session_ledger.py`
  pins a recorded ledger and its response hashes).
- **Format 2 (content-addressed state)**: `format: 2`, `session_id`, `version`,
  `previous_sha256`, `action`, `received_at`, `details`, `state_root`. All new
  events use it. A ledger may continue from v1 events into format 2, never back.

`state_root` is the SHA-256 of the root node of the state tree. Nodes live in the
`nodes` table (`session`, `digest`, `body`), stored once per session in the same
transaction as the event. A node body is canonical JSON of `["v", value]` (a
leaf), `["d", {key: child}]` or `["l", [child, ...]]`; a child is `["v", value]`
inline or `["h", digest]`. The writer stores every value whose canonical JSON
reaches 1024 bytes as its own node, plus the root. Readers accept any valid tree,
so the threshold can change without a new format. Unchanged values keep their
digest from version to version, so an event adds only the nodes that changed.
A list or object whose elements are each under 1024 bytes keeps them inline, so
that whole node is stored again whenever one element changes; lists that grow by
small records (control jobs and receipts, for example) make the per-round growth
rise slowly (see the measurements below).

Before an event is written, the writer proves inside the same transaction that
the stored tree rebuilds exactly the state being written and that the rebuilt
text parses; otherwise the command fails and nothing is committed. Readers
rebuild a state's canonical text without recursion and parse it once, as they
parsed a full-state event, so every depth canonical JSON can hold stays readable.
A state may not exceed 64 MiB of canonical JSON (`MAX_STATE_BYTES`, the largest
replay `app_recompute.py` and `recompute_session_score` accept): the writer
refuses such a state, and a read stops rebuilding any value that grows past it,
so a few crafted nodes that reference each other repeatedly cannot force
unbounded work.

Every read (`state`, `replay`, `GET /sessions/:id/ledger`, and
`recompute_session_score.verify_replay` for a supplied replay) runs the same
check: each event's hash, version, previous hash and session; the exact format 2
key set; each node's hash and shape; every reference resolves; no stored node is
unreachable from an event root; each root's `version` and `session_id` equal its
event's. Any failure is `Session ledger integrity failure` (HTTP 409). A replay
returns `nodes` as `{digest: node}` only when a format 2 event exists, so
v1-only ledgers return the same bytes as before. A database written before the
`nodes` table existed still opens read-only.

The app's session export (`server/sessionExport.mjs`, schema still
`singing-session-export/1`) redacts the replay including its `nodes`, then keeps
only nodes the redacted events still reach: a node referenced only through an
omitted media or credential field (a PCM leaf, for example) is dropped and listed
in `omissions`. Inside a node, an omitted field's `jsonValueSha256` covers the
child entry, which for a stored child is its `["h", digest]` reference.

Measured on the real app loop (`science/tests/test_app_control_loop.py`: baseline
search, Astra decisions, four control forecasts, three scores; 33 events) and on
`science/scripts/measure_control_ledger.py --anatomies 4 --rounds 6` (38 events).
Timings come from one interleaved run of both formats on one development Mac:
"append" re-appends every recorded state in order with `_append`, which verifies
the whole ledger first; "read" is one verified `read_ledger` of the final ledger.

| Ledger | Stored v1 → format 2 | Replay response v1 → format 2 | Append, mean (max) | Verified read |
|---|---|---|---|---|
| App loop | 23.95 MB → 0.92 MB | 24.96 MB → 1.98 MB | 95 (209) ms → 63 (89) ms | 165 ms → 21 ms |
| Measurement, 6 rounds | 6.73 MB → 0.94 MB | 7.00 MB → 1.23 MB | 22 (52) ms → 19 (39) ms | 43 ms → 12 ms |

In the app loop each further Astra round (decision, forecast, score) adds about
0.29 MB to the replay; with v1 events each round added 6-7 MB, more every round.
That increment is not constant: over 20 rounds of the measurement script it rose
by about 5 KB per round, from 194 KB to 283 KB (replay 4.77 MB after 20 rounds).
Extrapolating the app loop's 0.29 MB with the same rise, its replay reaches the
exporter's 24 MiB bound after about 54 more Astra rounds in one session.

Rollback: code from before format 2 cannot read a format 2 event (it reports the
session as not found). Returning to it after the first new write needs a backup
of `sessions.sqlite3` taken before the upgrade.
