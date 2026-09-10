# Live capture jobs and durable scientific sessions

`python science/scripts/live_capture_jobs.py --source PRIVATE_NATIVE_CAPTURE
--output NEW_PRIVATE_RUN` verifies/imports captured LPCM, selects two eligible
canonical voiced windows under a saved protocol, launches bounded anatomical
search, freezes supported geometries, commits a prospective vowel design, then
exports the selected model's native geometry. It does not score a later outcome.

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
which bind future outcome commands to the authoritative session. `hypotheses.json`
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
