# Connected runtime review

Scope: integration of remote `1067c89` with the durable session harness, followed
by live capture, native-rate outcome import/update and held-out probe evaluation.
This is a functional hackathon review, not another accuracy study or production
security expansion.

## Findings and fixes

1. **Route collision:** remote `scienceRoutes` consumed every `/api/science*`
   request and returned 405 for durable session/job routes. Root's `64cac1a`
   reconciliation separates legacy status/run/assets from the existing scientific
   proxy; root reports five real combined-route tests passed.
2. **Orphaned live forecasts:** the previous live script manually froze snapshots
   outside SessionController, so its forecasts were not committed session designs
   that could consume later outcomes. Reviewed `9c6c870` uses actual session
   ingestion/search/model freeze/design commitment and exposes session/model/design
   identity. Local and HTTP backends share those operations. Geometry exports are
   bound to verified job results; a missing baseline is retained as unavailable.
3. **Native outcome profile gap:** fixed-44.1k forecasts could not consume normal
   48/96 kHz native recordings. Reviewed `149440c` resamples only generated
   predictions through the existing resampler, freezes the exact rate/window/
   duration, validates update crops and leaves observed samples unchanged.
   Service whitelist fix `e642c57` admits that explicit profile. Independently
   ran 16 design tests: passed in 12.86 seconds.
4. **Outcome adapter identity:** imported session export and configured session
   ID were not compared, and the design model was not checked against its current
   snapshot. Owner `c330843` adds both checks before emitting an eligible command.
   Source manifest/frame bytes are verified, pose is explicit, and native
   `created_at` is correctly the Swift capture start (`startedAt`), not export
   completion. Its conservative chronology check does not fabricate UTC for an
   individual selected sample.
5. **Probe forecast scoring gap:** the existing forecast had no verified held-out
   consumer; fitting intentionally excluded held-out records. The new evaluator
   reruns the actual B importer on supplied original/supplemental bytes and checks
   exact derived document/receipt, target, calibration, placement, frequency and
   conditions. Candidate-common masks and missing bins remain explicit. It reports
   raw residuals without fitting, ranking or choosing a posthoc accuracy threshold.
   Independently ran seven evaluator tests: passed in 4.06 seconds, including the
   actual JobService route. Explicit articulatory overrides are currently rejected
   because the imported observation does not independently bind those controls.

## No-stubs, wiring and minimality

The live path calls actual sessions and jobs; the outcome adapter reads actual
native PCM and emits a real `submit_outcome` command; the evaluator reuses canonical
DSP instead of inventing a second extractor. Native-rate support reuses the inverse
resampler. No placeholder numerical response, fake completed job or new dependency
was found. Source classification and synthesis-count scope are explicit; rendering
a native mesh remains a model prediction rather than a measured anatomical scan.

Root owns final aggregate tests and the visible app integration. A prospective
prediction is not a scored observation until the real outcome command/evaluation
returns. Physical calibration, device timing and anatomical accuracy remain
separate evidence requirements, not new blockers to the connected software harness.

Final outcome verification: independently ran the real Node outcome test against
assembled root `e642c57` scientific modules. Both **44.1 kHz and 48 kHz** original
native bundles reached emitted command → SessionController → native update → new
model → replay; the test passed in **6.49 seconds**. Wrong-session/pose and precommit
capture cases were rejected. Final adapter revisions are `8b17fe2`/`c330843`.
Probe evaluator final commit is `d91dfb2`; owner additionally reports 14 focused
scorer/service tests passing after adding frequency/calibration/quality regressions.

No remaining functional or numerical blocker was found in the reviewed revisions.
