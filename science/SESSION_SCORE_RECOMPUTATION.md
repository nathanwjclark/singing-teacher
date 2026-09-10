# Offline recomputation of one real session score

`scripts/recompute_session_score.py` closes one bounded part of REP-01: rerun an actual completed `update_pcm` score using the original received PCM frame and the frozen design/snapshot. It does not re-fit anatomy, re-synthesize predictions, publish a model, or modify the session. It is an offline research tool; it is not connected to an app button and is not required for each singing attempt.

From the repository root with the scientific environment and certified native build available:

```sh
PYTHONPATH=science/src python science/scripts/recompute_session_score.py \
  --export /path/to/session-export.json \
  --job-id actual-completed-update-job-id \
  --original-replay /path/to/retained/replay.json \
  --frame /path/to/original-received-frame.f32 \
  --output /path/to/new-recomputation-report
```

The output directory must be new. The report and freshly recomputed update are private files. Exit 0 means numerical agreement under the current implementation, **not verified historical policy**; inspect `status` and `policy_verification`. Exit 2 means missing evidence, invalid evidence, version mismatch, or numerical disagreement. The original session and native model state are not saved or altered.

## Required originals and integrity boundary

- Select exactly one succeeded `update_pcm` in the exported session's jobs. Other scientific operations are outside this adapter.
- Supply the original, unredacted controller replay saved by the outcome runner (`replay.json`). Every event's canonical hash, order, session identity, previous hash, final state, and final ledger digest are checked against the exported `workerLedgerSha256`.
- Supply the exact mono little-endian float32 frame received by that update, saved independently before or at original scoring. The byte length and SHA-256 must match the receipt and the float32 conversion of the original request PCM. The adapter never synthesizes or reconstructs missing originals.
- Frozen snapshot/design canonical hashes, request/model/result/receipt bindings, receipt hash and updated snapshot hash are checked. Exported result and non-media request values must agree with the original ledger. The existing `update_pcm` then repeats its canonical prediction, feature, timing, profile, evidence and threshold validation.
- The supplied native library must be certified by `Engine` and have exactly the recorded provenance. Canonical extractor and contract hashes/versions must match the frozen design before scoring.

The ordinary shareable export intentionally omits raw media. In addition, its JavaScript serializer converts Python numeric spellings such as `0.0` to `0`, including inside embedded request JSON. Those untouched exported values cannot reproduce the original Python canonical hashes. Missing unredacted replay is therefore `missing_artifacts`, not permission to guess original types. Keep original evidence separately. Inputs are bounded to 24 MiB per export/replay and one canonical frame; larger sessions require a future bounded original-receipt export rather than silent truncation.

Hashes establish internal consistency against the supplied export, not independent authentication of a person or acquisition hardware. The float32 frame does not prove the full recording, crop location, lack of overlapping windows, capture timestamp, or physical provenance. The redacted request's JSON-value hash is not claimed recovered from float32 bytes: the original request can contain higher-precision numbers before conversion.

## Versions, budgets, and comparison

Legacy designs do not pin the historical Python scoring implementation. Consequently a successful run reports `status: "version_unverified"`, `policy_verification: "unverified"`, and a separate boolean `numerical_agreement`. Current scorer/helper source hashes are recorded for subsequent inspection; they are not retroactively authenticated historical versions. No caller-selected Git revision is accepted as proof. Native/extractor mismatch is `version_mismatch` and prevents scoring.

The fixed numerical budget is zero synthesis calls and at most one canonical frame extraction. The existing bridge also performs two profile/version validations; each subprocess has its existing 30-second timeout. No candidate search or optimization is run. This is a numerical call bound, not a hard wall-clock limit for native initialization.

Comparison includes score rows, scientific status, missing reason, and retained hypothesis identities. New local receipt times and dependent model/receipt hashes intentionally differ; the tool does not forge the old receipt timestamp to obtain byte equality. A matching score does not establish correct anatomy, calibrated uncertainty, human performance, or superiority to a coach.

## Verification and remaining wiring

```sh
PYTHONPATH=science/src python -m pytest science/tests/test_recompute_session_score.py -q -W error
```

Five tests passed in 4.98 seconds on the certified local build. They create fictional synthetic evidence, execute actual `SessionController`/`JobService` design and update jobs, save the original frame before update, invoke the actual JavaScript session exporter/redactor over the genuine controller replay, and recompute with the real canonical extractor. Only exporter transport is substituted with the saved controller response; no scientific score or receipt is mocked. Coverage includes missing originals, wrong frame, absent job, altered frozen request, altered exported score, original ledger tampering, extractor-version mismatch, fresh CLI output, and overwrite rejection.

No TODO, FIXME, placeholder, dummy, or fake production paths were introduced. The CLI is explicitly offline; no disconnected app success path is claimed. It reuses the existing scorer and dependencies. REP-01 is only partially satisfied: arbitrary historical scorers, complete-recording reconstruction, other operation families, and an app replay-recompute action remain outside this bounded implementation. Future prospective policy pinning must cover the scorer and its dependencies in the original frozen artifact; exporter-added metadata cannot authenticate old code after the fact.
