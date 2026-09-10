# Run the connected local scientific harness

This prototype adds callable scientific sessions to the existing local app server.
It does not add accounts or a production service. The launcher generates a local
transport token in memory; it is never printed or sent to browser JavaScript.
No paid model call is made by this launcher or numerical service.

After scientific environment/native setup and the existing npm dependencies:

```sh
npm run build
npm run science:local
```

Open `http://127.0.0.1:5173`. `SINGING_PYTHON` may name an existing scientific
Python environment; the default is `science/.venv/bin/python`. `SCIENCE_PORT`
defaults to 8766 and `SCIENCE_DATA_DIR` to `.local-data/science-jobs`. Ctrl-C stops
both processes. Persistent jobs and session history remain available after restart;
interrupted jobs retain failure status rather than fabricated completion.

The app's ordinary pairing/capture routes remain available. Scientific commands
are desktop-local, forwarded under `/api/science/`; the same endpoints cannot be
used remotely from a paired phone. Startup can briefly report an unavailable
worker while native capabilities load. `GET /api/science/health` is the readiness
check; configuration alone does not establish readiness.

## Integration surface for the UI and runtime Astra owner

```js
const state = await fetch('/api/science/sessions/demo/state').then(r => r.json());
const result = await fetch('/api/science/sessions/demo/commands', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(command)
}).then(r => r.json());
```

Use the exact versioned commands from [SESSION.md](SESSION.md). Check HTTP errors;
retain the returned state/version and job IDs. The intended loop is ingest actual
calibration, search, collect the completed job, propose a numerical design, collect
and commit it, record a matching outcome, collect its scored update, then replay.
Stopped/failed attempts and sensations have separate commands. Sensations remain
subjective reports and never become acoustic measurements.

Individual operations are also available via `POST /api/science/jobs` with
`{request, idempotency_key}`; poll `/jobs/ID`, read `/jobs/ID/result`, or POST `{}`
to `/jobs/ID/cancel`. Request bodies use [SERVICE.md](SERVICE.md). No shell command,
output path or executable is accepted from the browser. Requests and native-call
budgets remain bounded. See [HTTP_SERVICE.md](HTTP_SERVICE.md) for the worker API.

## Recording handoff

B's `/api/science/run`, `/status` and `/asset` routes coexist with the durable
worker routes. With this launcher, the saved-capture run uses the running worker
and publishes its authoritative `sessionId`, `modelId`, `sessionVersion` and
`designId`; it does not open a competing scheduler. See
[LIVE_CAPTURE_JOBS.md](LIVE_CAPTURE_JOBS.md). A private `science-input.json` may
set `evidenceKind:"development-fixture"` for explicitly generated test captures;
ordinary configured captures retain the human-observation declaration.

- Combined native exports: [SESSION_BUNDLE.md](SESSION_BUNDLE.md) verifies and
  unpacks original video/probe archives without asserting simultaneous capture.
- Ordinary native voice: [SINGING_SESSION_IMPORT.md](SINGING_SESSION_IMPORT.md)
  creates canonical calibration and an optional versioned ingestion command.
- External probe recordings: [PROBE_IMPORT.md](PROBE_IMPORT.md) retains exact
  original source/calibration bindings and produces supported probe-fit inputs.
- Later voice recordings: [SINGING_OUTCOME_IMPORT.md](SINGING_OUTCOME_IMPORT.md)
  emits a versioned outcome command bound to the committed profile and capture
  time. Submit it to the published session, poll and collect its numerical job.
- Heldout probe targets: [PROBE_EVALUATION.md](PROBE_EVALUATION.md) reruns canonical
  processing from original bytes and scores frozen forecasts without fitting.

The numerical service uses actual native physics and B's canonical extractors.
Live Astra invocation and the user-facing experiment flow remain B integration
work: provide compact state/forecasts to the model, validate the chosen supported
action, invoke these endpoints, and show the recorded score/update. Keep paid API
keys in the server environment and set a finite call budget. Do not label this
numerical transport or a scripted replay as a live Astra session.
