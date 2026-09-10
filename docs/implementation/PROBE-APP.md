# App external probe handoff

`createProbeRoutes({repo,dataRoot,json})` in `server/probe.mjs` exposes the import,
fit and status routes behind the application's existing request checks. Register
the factory in the local server before its API fallback.

`POST /api/probe/import` takes `{requestId}` and verifies the latest USB probe or
linked-session archive. Original ZIPs remain private. Without the independently
measured calibration configuration it still executes the exact B response importer
and returns a retained review with a useful ineligibility reason.

The private `probe-science-config.json` follows `science/PROBE_IMPORT.md`; its
relative evidence paths resolve beside that configuration. A separate
`probe-fit-profile.json` declares exactly `JA`, `gain`, `direct_gain`,
`coupling_gain`, and `delay_s`. These are explicit experimental controls, not
estimated automatically from the response. Do not insert fixture calibration for
human input. The scientific operator checks controls against its declared prior.

`POST /api/probe/fit` takes `{requestId,importId,expectedModelId}`. It re-verifies
the original capture and calibration, uses the current session's retained anatomy
support with its initial singing trial controls, submits `fit_probe`, collects its
terminal receipt and preserves the complete request/result/session replay. It
does not relabel the immutable B measurement's `includedInFit` field. The separate
fit result reports actual modality contribution and adoption. Subsequent voice
predictions must be regenerated for an adopted model before recording an outcome.

Both POST routes start bounded background processes and return 202. GET
`/api/probe/status` returns `busy`, `import`, `measurement`, `fit`, `error`,
`currentModelId`, `canFit`, and `fitBlockedReason`; browser refresh reads the same
private artifacts. Transport request IDs suppress immediate duplicate submission.
The worker's session commands additionally use durable idempotent command IDs.
After server restart, the next app status poll resumes an unfinished fit using its
saved folder and original model binding. The runner records its exact session
command before submission, finds its owned pending or completed job and collects
it before reconstructing missing output. A process lock prevents an orphaned
runner and its replacement from acting on the same folder concurrently. A retry
does not submit a second fit or adopt the same result twice. Terminal failed or
cancelled jobs are collected to release the session, and the app can then start
a fresh attempt. A transient worker outage leaves the Retry action available;
it does not require a backend command. Interrupted raw imports restart from the
retained archive. Session history and original artifacts remain intact.

Verification: `PYTHONPATH=.:science/src python -m pytest
science/tests/test_app_probe.py -q` passed six tests: real B importer from original
synthetic PCM, preserved archive hashes and missing-calibration rejection; tamper
rejection; original probe re-import through the actual native joint runner and
durable session adoption, including process death immediately after submission
and after collection, and cancellation followed by an app-style fresh retry.
Repeated completed runs preserve the session version and single adoption.
The successful fit performs 12 operator calls and retains a
large negative model discrepancy, explicitly not successful anatomical recovery.
`node --test server/probe.test.mjs` passed two tests covering local-only,
interrupted imports, invalid IDs, automatic fit restart and reuse of the original
model binding when the browser has already observed an updated model.
Hardware calibration, human acoustic validity and the browser
flow are distinct verification tasks.
