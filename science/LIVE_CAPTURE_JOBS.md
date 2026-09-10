# Live capture jobs and durable scientific sessions

`python science/scripts/live_capture_jobs.py --source PRIVATE_NATIVE_CAPTURE
--output NEW_PRIVATE_RUN` verifies/imports captured LPCM, selects two eligible
canonical voiced windows under a saved protocol, launches bounded anatomical
search, freezes supported geometries, commits a prospective vowel design, then
exports the selected model's native geometry and a same-pose reference comparison. It does not score a later outcome.

When both `SCIENCE_URL` and `SCIENCE_TOKEN` are present, every numerical job and
session command uses that existing authenticated worker. The URL must be literal
`http://127.0.0.1:PORT`; redirects, proxies and remote hosts are not supported.
Tokens are never placed in command arguments or output artifacts. Geometry files
arrive through `/jobs/:id/exports`; returned lengths and hashes are checked against
the verified forward result before publication. No second scheduler is opened.

Without either environment variable, the script opens standalone JobService at
`OUTPUT/jobs`, with the session ledger under `OUTPUT/jobs/sessions`. A later local
HTTP server can reopen that directory after this script exits. Partial environment
configuration fails explicitly. Run identity deterministically identifies a new
session; existing session history is never replaced by a repeated calibration run.

`summary.json` includes `sessionId`, `modelId`, `sessionVersion` and `designId`,
which bind future outcome commands to the authoritative session. Forecasts use
the first selected calibration window's native sample rate and canonical frame
size, with a declared 100 ms offset and 0.25 second synthesis duration. That
immutable profile binds the later outcome; recorded audio is not resampled. `hypotheses.json`
is exactly the session snapshot; `forecast.json` is its committed design;
`session-ledger.json` retains verified state/history even when a later stage fails.
Search and forecast jobs are collected through SessionController; geometry export
is another JobService job bound to that same model/session. Rejected or unscorable
searches retain their attempted support and fail instead of inventing a model.

`nativeCalls` counts PCM synthesis calls only, including the export's synthesis.
The export also performs transfer, geometry, mesh and SVG operations; the summary
states this accounting scope explicitly. Missing baseline scores remain null.
Selection assumes prompted ah corresponds to the native a pose and fixes jaw
control; source pitch is estimated from the recording. These are declared model
assumptions, not measured internal physiology.

Source classification is the importer's declared human-observation or explicit
`--development-fixture`. Package hashes establish consistency, not device or human
origin. Native-generated fixtures test software wiring without claiming observed
anatomy or human validation. Existing observations remain unmodified.

CLI SIGTERM/SIGINT is handled as an interruption. The script cancels only its own
current session-job intent, collects the terminal receipt to clear pending state,
and cancels its current candidate or reference forward-export job. Sequential
exports reset their active job identity before each submission. An idempotent forward request recovers
a lost submission reply. A job that completed before cancellation is retained,
but the script does not launch the next stage. `interruption.json` records cleanup
and `session-ledger.json` preserves the remaining state. HTTP cleanup uses bounded
three-second request timeouts. Unreachable services produce an explicit
`reconciliation_required` receipt instead of claiming cancellation succeeded.
SIGKILL, host crashes and power loss cannot execute this cleanup; existing durable
session/job state remains available for manual cancellation/collection on restart.

## Integrated geometry comparison

The live path exports both candidate and reference anatomy through the same local
or HTTP backend. Both forward results and every copied file are verified before
`space-diff.json` is paired and hashed into the summary. Reference files remain in
`reference/` under the private run. The two exports add two PCM synthesis calls;
the current five-hypothesis protocol uses 77 calls total. The initial search varies
both hard palate length and lip width with three declared gain alternatives; its
60-call budget covers the full two-dimensional initial design and fixed-anatomy
comparison (previously 36 calls for one anatomical dimension). These forward jobs are
bound to the session/model but do not alter the committed forecast ledger. The
Studio model-adjustment control consumes this paired artifact while retaining
live tongue motion. The explicit fixed jaw pose is a preview, not a fitted jaw
correction. Neural tongue model endpoints and private USB actions coexist with
the durable scientific proxy routes.
