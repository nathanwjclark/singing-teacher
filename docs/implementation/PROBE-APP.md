# App external probe handoff

`createProbeRoutes({repo,dataRoot,json})` in `server/probe.mjs` exposes the import,
fit, calibration setup and status routes behind the application's existing request checks. Register
the factory in the local server before its API fallback.

`POST /api/probe/import` takes `{requestId}` and verifies the latest USB probe or
linked-session archive. Original ZIPs remain private. Without the independently
measured calibration configuration it still executes the exact B response importer
and returns a retained review with a useful ineligibility reason.

## Calibration setup in the app

After **Pull iPhone → Analyze latest probe**, open **Calibration setup**. Upload
the calibration package and every original evidence file named by that package.
Enter the metric source/microphone/mouth positions, coordinate frame, placement
identity, held-quiet pose, trial identity and the five declared model controls.
Review the provenance, exact frequency grid and declared nuisance bounds, then
select **Verify and save calibration setup**. Analyze the probe again and, once a
voice model is available, select **Fit probe with voice model**. No per-user server
configuration edit is needed.

The calibration package is measurement-workflow output, not a new estimate made
by the app. It is JSON with `schema_version: "0.1.0"` and
`kind: "probe_calibration_package"`. It contains `comparison`, `selected_indices`,
`calibration`, `nuisance_prior`, `processing`, `bands`, `conditions` and `evidence`
with the exact schemas in [the canonical import specification](../../science/PROBE_IMPORT.md).
An existing `probe_science_import_configuration` JSON can also be uploaded as a
package; its placement/pose fields prefill the form, and the app binds the saved
configuration to the selected original capture. Calibration arrays must already
be measured at the selected response frequencies. The app never substitutes unit
calibration, infers response from a level check, or fits calibration against its
own target recording. Evidence files use unique basenames and must match the
package's exact SHA-256 and byte count. Limits: 2 MB package, 32 evidence files,
16 MB total evidence. Human/physical input requires measured calibration and
characterized route evidence; a software fixture stays explicitly synthetic.

`POST /api/probe/setup` receives `{requestId,importId,manifestSha256,packageBase64,
evidence:[{name,base64}],placement,profile,trialId,pose}`. The route validates
bounded controls (including the package's nuisance prior), metric distances and
capture identity, then invokes the actual canonical importer against retained
original PCM. Missing/corrupt evidence, unsupported calibration and mismatched
frequency/route bindings leave the current setup unchanged. Successful requests
return 200 with a receipt; they do not submit a fit. Evidence verification proves
file integrity and the caller's declared binding, **not physical calibration
accuracy or authenticity**.

Each attempt retains private immutable files under `probe-setups/<requestId>/`.
The original package, original evidence, generated `configuration.json`,
`profile.json` and canonical verification outputs are retained. Only after a
successful verification does an atomic rename publish `probe-setup-current.json`,
whose SHA-256 binds `summary.json`. The receipt binds configuration and profile
hashes. An import freezes that setup ID and both hashes; subsequent fit/retry uses
that exact setup, even after a different setup becomes active. Before submitting
a fit, the runner re-reads and verifies original supplemental evidence. A new
capture with a different manifest remains reviewable and needs a new explicit
calibration binding. Damaged setup files permit review and replacement in-app;
they never silently enable fitting.

Existing private `probe-science-config.json` and `probe-fit-profile.json` remain
compatible when there is no saved app setup. The latter declares exactly `JA`,
`gain`, `direct_gain`, `coupling_gain`, and `delay_s`. These are explicit controls,
not automatically estimated physiology. Imported legacy configurations retain
their legacy resolution; an unrelated later app setup cannot replace them.

`POST /api/probe/fit` takes `{requestId,importId,expectedModelId}`. It re-verifies
the original capture and calibration, uses the current session's retained anatomy
support with its initial singing trial controls, submits `fit_probe`, collects its
terminal receipt and preserves the complete request/result/session replay. It
does not relabel the immutable B measurement's `includedInFit` field. The separate
fit result reports actual modality contribution and adoption. Subsequent voice
predictions must be regenerated for an adopted model before recording an outcome.

Import and fit POST routes start bounded background processes and return 202. GET
`/api/probe/status` returns `busy`, `import`, `measurement`, `fit`, `error`,
`currentModelId`, `canFit`, `fitBlockedReason` and `setup` (capture identity and
saved setup receipt); browser refresh reads the same
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
science/tests/test_app_probe.py -q` passed seven tests: real B importer from original
synthetic PCM, preserved archive hashes and missing-calibration rejection; tamper
rejection; original probe re-import through the actual native joint runner and
durable session adoption, including process death immediately after submission
and after collection, and cancellation followed by an app-style fresh retry.
The new immutable-setup case changes the active setup after import and confirms
that the actual native fit uses the earlier import's original jaw/control values.
Repeated completed runs preserve the session version and single adoption.
The successful fit performs 12 operator calls and retains a
large negative model discrepancy, explicitly not successful anatomical recovery.
`node --test server/probe.test.mjs` passed two tests covering local-only,
interrupted imports, invalid IDs, automatic fit restart and reuse of the original
model binding when the browser has already observed an updated model.
`node --experimental-strip-types --test server/probeSetup.test.mjs` runs the real
HTTP route, subprocess importer and generated original PCM. It verifies missing,
corrupt and unsafe evidence rejection, prior/grid rejection, atomic publication,
unchanged review eligibility before reimport, and hash-bound calibrated reimport.
`npx playwright test --config playwright.probe-setup.config.ts` covers actual
calibration uploads and response import (no intercepted probe responses), reload,
mobile form bounds and existing probe-review UI regressions. No API calls to a
paid model occur in these checks. Real hardware calibration and human acoustic
validity remain separate acquisition/validation work.
