# Read-only recomputation of retained session scores

`scripts/recompute_session_score.py` closes one bounded part of REP-01: rerun an actual completed `update_pcm` score using the original received PCM frame and the frozen design/snapshot. It does not re-fit anatomy, re-synthesize predictions, publish a model, or modify the session. This CLI handles one update offline; the app runs the same comparison over a whole session (see [App batch verification](#app-batch-verification)). Neither is required for each singing attempt.

From the repository root with the scientific environment and certified native build available:

```sh
PYTHONPATH=science/src python science/scripts/recompute_session_score.py \
  --export /path/to/session-export.json \
  --job-id actual-completed-update-job-id \
  --original-replay /path/to/retained/replay.json \
  --frame /path/to/original-received-frame.f32 \
  --output /path/to/new-recomputation-report
```

The output directory must be new. The report and freshly recomputed update are private files. Exit 0 means the recomputed score agrees: `status` is `verified` (the design's scorer pin matches this runtime) or `legacy_version_unverified` (a coarse design sealed before pins existed). Exit 2 means `missing_artifacts`, `missing_media`, `invalid_evidence`, `version_mismatch`, `runtime_unavailable` (Node, extractor or native engine cannot run here) or `numerical_disagreement`. A disagreement is never reported as `verified`. The original session and native model state are not saved or altered.

## Required originals and integrity boundary

- Select exactly one succeeded `update_pcm` in the exported session's jobs. Other scientific operations are outside this adapter.
- Supply the original, unredacted controller replay saved by the outcome runner (`replay.json`). Every event's canonical hash, order, session identity, previous hash, final state, and final ledger digest are checked against the exported `workerLedgerSha256`.
- Supply the exact mono little-endian float32 frame received by that update, saved independently before or at original scoring. The byte length and SHA-256 must match the receipt and the float32 conversion of the original request PCM. The adapter never synthesizes or reconstructs missing originals.
- Frozen snapshot/design canonical hashes, request/model/result/receipt bindings, receipt hash and updated snapshot hash are checked. Exported result and non-media request values must agree with the original ledger. The existing `update_pcm` then repeats its canonical prediction, feature, timing, profile, evidence and threshold validation.
- The supplied native library must be certified by `Engine` and have exactly the recorded provenance. Canonical extractor and contract hashes/versions must match the frozen design before scoring.

The ordinary shareable export intentionally omits raw media. In addition, its JavaScript serializer converts Python numeric spellings such as `0.0` to `0`, including inside embedded request JSON. Those untouched exported values cannot reproduce the original Python canonical hashes. Missing unredacted replay is therefore `missing_artifacts`, not permission to guess original types. Keep original evidence separately. Inputs are bounded to 64 MiB per export/replay and one canonical frame; larger sessions require a future bounded original-receipt export rather than silent truncation.

Hashes establish internal consistency against the supplied export, not independent authentication of a person or acquisition hardware. The float32 frame does not prove the full recording, crop location, lack of overlapping windows, capture timestamp, or physical provenance. The redacted request's JSON-value hash is not claimed recovered from float32 bytes: the original request can contain higher-precision numbers before conversion.

## Versions, budgets, and comparison

Designs sealed by current code carry `scorer_implementation_pin` (see [PCM design](PCM_DESIGN.md) and [the spectral objective](../docs/physiology/WAVE3_SPECTRAL_OBJECTIVE.md)). The recompute applies the same check as `update_pcm` (`pcm_design._require_pin` against `SCORER_PIN`, which hashes `pcm_design.py`, `pcm_inverse.py`, `pcm_spectral.py`, `prediction.py`, `engine.py`, `extract_pcm.ts` and the numpy/scipy versions). A matching pin gives `policy_verification: "verified"`. A coarse design without a pin gives `legacy_version_unverified`: agreement then only says the current code reproduces the recorded numbers. A changed pin, or a spectral design without one, is `version_mismatch` and is not scored. So is a native or extractor mismatch. The current `SCORER_PIN` is recorded as `current_scorer_implementation_pin`. No caller-selected Git revision is accepted as proof.

The fixed numerical budget is zero synthesis calls and at most one canonical frame extraction. The existing bridge also performs two profile/version validations; each subprocess has its existing 30-second timeout. No candidate search or optimization is run. This is a numerical call bound, not a hard wall-clock limit for native initialization.

Comparison includes score rows (with spectral objective components), scientific status, missing reason, and retained hypothesis identities. New local receipt times and dependent model/receipt hashes intentionally differ; the tool does not forge the old receipt timestamp to obtain byte equality. A matching score does not establish correct anatomy, calibrated uncertainty, human performance, or superiority to a coach.

## Verification and limits

```sh
PYTHONPATH=science/src python -m pytest science/tests/test_recompute_session_score.py -q -W error
```

Five tests passed in 5.3 seconds on the certified local build. They create fictional synthetic evidence, execute actual `SessionController`/`JobService` design and update jobs, save the original frame before update, invoke the actual JavaScript session exporter/redactor over the genuine controller replay, and recompute with the real canonical extractor. Only exporter transport is substituted with the saved controller response; no scientific score or receipt is mocked. Coverage includes missing originals, wrong frame, absent job, altered frozen request, altered exported score, original ledger tampering, extractor-version mismatch, fresh CLI output, and overwrite rejection.

It reuses the existing scorer and dependencies. REP-01 is only partially satisfied: arbitrary historical scorers, complete-recording reconstruction and non-score operation families remain outside this bounded implementation. Pins are prospective: only the frozen artifact can bind its scorer, and exporter-added metadata cannot authenticate old code after the fact.

## App batch verification

The Scientific session replay panel has **Recompute retained scores**. The local
server (`server/sessionRecompute.mjs`, mounted in `server/local.mjs`) starts
`scripts/app_recompute.py`, which reads one authoritative session ledger from the
worker, checks its canonical event hash chain once, and compares up to the latest
16 successful scoring operations. It reads through the worker's
`GET /sessions/<id>/ledger` route (`session.read_ledger`): the session database
opened read-only (`mode=ro`) in one deferred transaction. Unlike the `state` and
`replay` session reads, that route never submits a pending job, appends
`job_dispatched` or registers a model, so the ledger version, events and job
database stay byte-identical. It never issues model commands or publishes
numerical results back into the session. No API model calls or
synthesis are performed.

Supported comparisons:

- `update_pcm`: exact received float32 frame recovered from the retained private
  request, verified against the original frame receipt, frozen design, extractor,
  native provenance and scorer implementation pin (coarse and spectral objectives).
- `score_visual_forecast`: retained original annotation numbers and frozen native
  projections, including missing/occluded evidence. It does not redecode video or
  independently validate the anatomical correspondence.
- `score_phonation` and `score_phonation_bank`: retained float32 frame and sealed
  source forecast. The scorer's own frozen policy and extractor check decides
  whether the score can be reproduced.

Every retained job lands in exactly one outcome, and the counts add up to the
job total:

| Outcome | Row `status` | Meaning |
|---|---|---|
| matched | `verified`, `legacy_version_unverified` | The recomputed score agrees. `counts.policyVerified` and `counts.legacyVersionUnverified` split pinned from unpinned matches. |
| failed | `numerical_disagreement`, `invalid_evidence` | The score differs, or the retained evidence is inconsistent (changed frame, digest or binding). |
| unavailable | `missing_media`, `missing_artifacts` | The original score, frame or receipt is absent. Nothing stands in for it. |
| unsupported | `version_mismatch`, `runtime_unavailable`, `unsupported_operation` | The frozen scorer, pin, extractor or native provenance differs from this process; this computer cannot run the scorer now (no Node, an extractor that fails its evidence-free validation call or times out, a native engine fault); or the job is a fit, freeze or synthesis rather than a score. |
| skipped | `operation_limit`, `time_limit` | Outside this run's 16-operation or wall-time budget. |

The run is bounded to 16 scoring operations, one extraction per audio score, zero
synthesis and zero geometry calls. The verifier arms SIGALRM for 290 seconds before
its scientific imports and ends there. A scoring row makes at most three 30-second
extractor calls, so rows start only during the first 190 seconds after process
start (a 100-second reserve per row); later rows are `skipped` with `time_limit`
and the report is still written. The verifier leads its own process group, and the
server stops that group 300 seconds after spawn. It runs with only `PATH`, `HOME`,
`TMPDIR`, `SCIENCE_URL`, `SCIENCE_TOKEN` and `PYTHONPATH`; provider keys are not
passed on. It writes no temporary files of its own. Raw replay and PCM are not
written into downloadable artifacts.

Only one verifier runs at a time, also across server restarts. The running record
stores the verifier pid, the kernel's start time for that pid (`ps -o lstart=`) and
the spawn time. A restarted server reports the attempt as running while a process
with that pid and start time exists within 300 seconds of spawn, then records its
outcome. A reused pid has a different start time and is not mistaken for it.

Private `replay-verifications/replay-<uuid>/` contains the request, a comparison
report and a receipt binding the report's SHA-256 and byte length to the run,
session and captured ledger. Requests with the same identity and parameters return
an existing successful report. An interrupted attempt stays historical; a new
button press creates a fresh attempt without editing the failed evidence. Report
integrity is rechecked before display. The report download includes hashes,
numerical comparisons, implementation policy, outcomes and limitations, without
raw media or credentials. Reports are capped at 8 MiB. The session export
includes the latest report for the same run and session as a
`read-only-score-recomputation` artifact while it still matches its receipt;
`binding.current` says whether it was computed against the exported ledger. If the
index names a completed attempt whose receipt or report is absent, changed or
oversized, the export lists it under `missing`. Never having run a recompute is
not missing evidence.

Routes: `GET /api/session-recompute/status` and
`POST /api/session-recompute/run` with `{requestId, maxOperations}`. `requestId` is
`replay-` plus a UUID and `maxOperations` is an integer from 1 to 16. Only local app
requests can invoke the verifier. This verifies numerical scoring reproducibility,
not complete session replay, original capture authenticity, anatomical accuracy or
human learning effectiveness.

Checks: `science/tests/test_app_recompute.py` (real controller jobs, real HTTP
worker, spectral and coarse updates, each outcome from a rehashed altered ledger,
real runtime faults, the row admission window, and a ledger with a pending intent
that the recompute leaves byte-identical), `server/sessionRecompute.test.mjs`
(route, restart single flight, pid reuse, verifier environment, mount in
`server/local.mjs`), `server/sessionExport.test.mjs`, and
`tests/session-recompute.spec.ts` (run with `npx playwright test -c
tests/session-recompute.config.ts`, also run in CI: real server and worker, spectral fit and
outcome, recompute from the panel, byte-identical retained files and ledger).
Evidence source for all of these is `synthetic`; scientific outcome `untested`.
