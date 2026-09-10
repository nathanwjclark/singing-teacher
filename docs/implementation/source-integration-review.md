# Independent source integration review

Review date: 2026-09-10. Scope: optional phonation measurement, conditional source/tract fitting, prospective source scoring and delivery of those results to Astra. The reviewer did not author the implementation. This report distinguishes reviewer-run checks from final integration results supplied by the integration owner.

## Concrete findings, resolved

| Priority | Finding and affected files | Resolution and evidence |
| --- | --- | --- |
| P1 | Native worker termination could leave its Node extractor child alive (`science/src/singing_physics/service.py`). | Disposable process groups now contain native and extractor descendants. Independently ran the three phonation-job tests, including a real hung child whose PID disappears after timeout and baseline recovery. |
| P1 | A forecast pinned the extractor but used mutable scoring scales (`science/src/singing_physics/phonation.py`). | Forecasts now pin scoring policy, feature scales, source adapter, sample-rate profile, pose and target. Incompatible policy or missing extractor returns unsupported rather than silently changing the score. |
| P1 | Frame-only exclusion could admit a different crop of calibration audio as held-out evidence (`science/src/singing_physics/session_source.py`). | Session binding also excludes original artifact hashes and capture/attempt identities; scoring requires the correct session and target after commitment. Native session tests reject calibration aliasing and pre-commit timestamps. |
| P1 | Constant phase keys could repeatedly return the first forecast (`server/sourceInference.mjs`). | Forecast attempts incorporate current source identity and round state; scoring incorporates forecast and capture identity. Actual lifecycle verification reaches a fresh committed target after scoring and recovery. |
| P1 | The app runner could collect someone else's pending job of the same operation (`science/scripts/app_source.py`). | Recovery requires the exact stable command key and operation. Results retain their original request binding. |
| P1 | Calibration frames were incorrectly labeled `/a/` regardless of their declared vowel (`science/scripts/app_source.py`). | The adapter resolves the matching imported trial's declared vowel and rejects missing declarations. Scoring uses the immutable forecast pose. Independent actual-extractor checks retained `/i/`, rejected an undeclared vowel and preserved null capture time. |
| P1 | Analysis time could make an old recording appear newly captured (`server/phonation-worker.mjs`). | Unknown acquisition time remains null; analysis time is separate. Prospective native capture time is explicitly device-declared, not independently authenticated human evidence. |

No unresolved correctness finding from this review remains a blocker to the tested opt-in software flow. This is not a claim that the implementation has no possible defects or that anatomical inference is validated.

## Verification evidence

- **Reviewer-run:** `science/tests/test_phonation_jobs.py`: **3 passed in 8.46 seconds**. Actual native fit/forecast/score, default-off behavior, timeout/cancellation and descendant cleanup.
- **Reviewer-run:** `science/tests/test_phonation.py` plus `science/tests/test_session_source.py`: **9 passed in 26.28 seconds**. Conditional source/tract alternatives, held-out source scoring, missing/changed capability, original-artifact exclusion, baseline preservation and restart lineage.
- **Reviewer-run:** `server/sourceInference.test.mjs`: **2 passed**. Disabled results are not active; consumed/stale forecasts are not current merely because their process succeeded. These focused tests inject session HTTP responses.
- **Reviewer-run:** actual adapter/canonical-extractor probe on temporary generated PCM preserved declared `/i/` and unknown capture time, and rejected a missing vowel declaration.
- **Final integration-owner run:** the actual source lifecycle and source-to-Astra integration test passed in **47.92 seconds**. It uses native synthesis, actual source fitting/session jobs, original-capture import, committed forecasts, later scoring, restart/idempotency recovery and missing-runner fallback. It verifies that exact source alternatives and the later discrepancy reach Astra's decision input. The provider is explicitly injected for this test; **no paid model call occurs**. This verifies provider-input wiring, not a live model's reasoning quality.
- **Final integration-owner browser run:** **20 tests passed**. The browser last-run artifact inspected by this reviewer reports `passed` with no failed tests. Generated microphone audio traverses the real analysis worker; this is software-flow evidence, not a human voice evaluation.

The final integrated runtime result supersedes earlier reports that left source-to-Astra wiring or browser acceptance pending. Counts above describe distinct runs; they are not an aggregate claim that this reviewer personally reran the entire final suite.

## No-stubs, wiring and minimality audits

No `TODO`, `FIXME`, `placeholder`, `dummy`, `fake` or `stub` logic was found in the reviewed production source modules and app adapter paths. Generated PCM and the injected provider are confined to explicitly identified tests. Production measurements use the canonical extractor and native source synthesis rather than fixture values.

The app routes call the source runner, which invokes existing isolated scientific jobs and versioned session commands. Source state, forecasts and scores remain separate from the valid baseline anatomy snapshot. Failed or incomplete enhancements retain valid prior state. Source hypotheses and later scores now reach Astra, while unsupported capabilities leave baseline exercises available. Scoring reports a discrepancy and explicitly preserves the hypotheses; it does not pretend to perform an anatomy update.

The implementation reuses the existing job service, session lineage and canonical audio extractor. It introduces no second native execution service or competing microphone owner. A Node bridge preserves one numerical feature definition for observed and synthesized audio. This incurs bounded process overhead; it does not justify duplicating the extractor.

## Scientific and motion limits

Pulse skew is a prescribed geometric-glottis simulator parameter. It is not a vocal-fold contact percentage, tissue measurement, pathology diagnosis or proof of complete closure. The finite source/tract alternatives expose conditional discrepancies; matching generated audio does not establish unique human anatomy or calibrated uncertainty.

These source experiments analyze bounded, approximately stationary vowel windows with declared or fixed execution assumptions. They do not recover time-varying fold motion, collision mechanics, muscle activity or a complete coupled dynamic source/tract model. Visible mouth motion and acoustic changes are not direct measurements of internal vocal-fold contact.

No paired human electroglottography or laryngeal imaging validation was available. Device-declared timestamps and verified artifact bytes support reproducible software lineage, but do not validate physiological accuracy or confirm that a learner executed the requested maneuver. Measurement, comparison and source inference therefore remain independently gated, with explicit limitations and non-blocking fallback.
