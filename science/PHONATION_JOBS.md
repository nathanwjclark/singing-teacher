# Optional phonation source jobs

Existing `JobService` operations now include:

- `fit_phonation`: `document`, `candidates`; optional `max_synthesis_calls`, `timeout_s`, `enabled`.
- `forecast_phonation`: `fit_result`, `family`, `candidate_id`, `reference_trial_id`, `pose`, `controls`, `target_id`; optional `enabled`.
- `score_phonation`: `frozen`, `pcm`, `metadata`; optional `enabled`.

**All default off** and require `enabled:true` to run. Disabled jobs return a disabled capability result without constructing a native engine. Optional source imports happen only inside the existing disposable worker. Absent modules return unsupported; exceptions cannot replace a baseline model. Actual fit/source/score schema and scientific assumptions remain those of `phonation.py`; this layer adds no alternate physics or extractor. Request session/model binding, private durable artifacts and result integrity use the existing job service unchanged.

The source fit's internal cooperative deadline is capped to the service's aggregate job timeout. The parent scheduler also terminates the worker process group, including Node extractor descendants, for timeout/cancellation. Each worker starts a dedicated POSIX session; its watchdog kills that group on parent loss or hard expiry. No second scheduler is introduced. Existing timeout status is `failed` with reason `timeout`; callers translate capability presentation without treating it as a successful source estimate. The service is already POSIX-specific (flock); process-group cleanup uses that same platform scope.

Tests: `PYTHONPATH=science/src python -m pytest science/tests/test_phonation_jobs.py science/tests/test_service.py -q`. They execute real native fit, forecast and held-out score, default-off behavior, cancellation, suspended worker timeout, hung extractor descendant cleanup and a subsequent baseline forward job. Existing native job replay/parallel/stale-model tests remain included. The hung extractor uses a test-only executable process that sleeps; production code has no injected delay or alternate signal generator.
