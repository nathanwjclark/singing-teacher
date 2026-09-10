# Live scientific experiment integration

The local application now loads its server-only `.env`, calls `gpt-6-astra`, commits a supported experiment against the current scientific model, scores the later capture, and supplies that score and successor model to its next decision. The Experiments page contains the decision controls, subjective sensation memory, and calibrated external-probe controls. Original calibration geometry remains explicitly historical when the retained model advances.

Start with `npm run build` and `npm run science:local` (or the existing private HTTPS launcher). Set `SINGING_PYTHON` if the scientific Python environment is outside this checkout. Set `OPENAI_ENV_FILE` only when the server configuration lives somewhere other than this checkout's `.env`. Normal recording, fitting, decisions, scoring and sensation entry are app actions. Credentials never need to be entered in the browser.

## Verified execution

On September 10, 2026, the actual native two-round test passed with the live API: Astra selected `/a/`, then selected `/i/` after receiving the measured synthetic outcome and updated model. The two unique decisions used 9,548 tokens total (4,772 and 4,776). Restart, decision replay and repeated outcome requests did not cause extra model invocations or duplicate scientific updates. A separate minimal provider check used 92 tokens.

The deterministic counterpart uses the same scientific worker, native synthesis, capture ingestion, route factories and durable session commands, with a test-injected decision provider. It verifies numerical outcome context, prospective design binding, immutable initial summary, fresh model/evidence on round two and persisted call limits. Transport and route tests cover rejected decisions, provider failures, cancellation, rest, stale observations and interrupted publication. Browser checks exercise the rendered decision and sensation controls, failures, retry identity and mobile layout.

These are implementation results with synthetic evidence. They do not establish human anatomical recovery, safe individual range expansion or coaching efficacy. Physical phone acquisition and independently measured acoustic-probe calibration still require the devices and participant.

## Reproduction

Run `PYTHONPATH=.:science/src "$SINGING_PYTHON" -m pytest -q science/tests/test_app_astra_loop.py` for the deterministic native loop. Explicitly setting `SINGING_TEST_LIVE_ASTRA_ENV` to the absolute private environment-file path runs the bounded two-decision live variant and incurs API usage. Tests never run paid calls by default.

The normal app records private decisions under `astra-decisions/<sessionId>/`, active selection under `science-runs/<runId>/astra-current.json`, scored attempts under that run's `outcomes/`, and subjective reports under `learning-memory/`. The scientific session replay retains its original inputs, numerical jobs and model lineage. A subjective report changes session history; it is not physiological evidence.

Probe import preserves original archives and invokes the existing response importer. Joint fitting requires verified calibration and explicitly declared placement controls; missing calibration produces an explicit rejection. See [probe app handoff](PROBE-APP.md). Codex-managed OAuth execution is not implemented; the verified runtime uses the supplied API key.
