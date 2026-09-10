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

Verification: `PYTHONPATH=.:science/src python -m pytest
science/tests/test_app_probe.py -q` runs the real B importer from original synthetic
PCM, checks preserved archive hashes, explicit missing-calibration rejection and
tamper rejection. Hardware calibration and human acoustic validity are distinct
unverified evidence questions. Native joint/session tests belong to the session
adoption integration and must also pass before claiming complete app fit wiring.
