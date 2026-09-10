# Independent phonation review

Reviewer: PHON-05, independent of measurement and source-fit authors. Review date: 2026-09-10. This document separates scientific constraints from verified implementation behavior. It does not establish physical vocal-fold closure detection.

## Scientific guardrails

1. Cepstral prominence depends on estimator implementation, vowel, pitch and vocal intensity. A custom estimator must have its own version and definition; values cannot inherit Praat/ADSV clinical thresholds. Compare matched tasks using the same extraction configuration. Supporting primary studies: [implementation sensitivity](https://pubmed.ncbi.nlm.nih.gov/25944288/) and [vowel/intensity effects](https://pubmed.ncbi.nlm.nih.gov/22480754/).
2. Uncorrected harmonic-amplitude differences and spectral tilt describe the recorded source-plus-filter signal. They are not direct contact measurements. Mark any filter correction and the tract assumptions used; changing articulation can change these descriptors without a corresponding change in vocal-fold contact.
3. Inverse filtering is conditional estimation. A comparison of manual and semiautomatic methods supports estimation of source features on sustained vowels, not unique recovery of anatomy: [Lehto et al.](https://pubmed.ncbi.nlm.nih.gov/16478660/). A controlled synthesis study found substantial feature errors and increased error when fundamental frequency approached the first formant: [source-filter interaction study](https://pubmed.ncbi.nlm.nih.gov/32921855/). Include source-only and tract-only variations and high-pitch cases in validation.
4. Verify the actual native model family and controls. The [VTL manual](https://www.vocaltractlab.de/download-vocaltractlab/VTL2.3-manual.pdf) distinguishes geometric and self-oscillating glottis models. Do not describe a prescribed source control as measured tissue mechanics or inferred muscle activity.
5. Electroglottographic contact quotient and airflow closed quotient are different measurements. A paired reference study is an eventual validation step, not a substitute label inferred from audio: [comparison in singers](https://pubmed.ncbi.nlm.nih.gov/25510160/).

## Required failure checks

| Condition | Required behavior |
| --- | --- |
| Feature disabled or dependency absent | Core startup and capture/fit/coaching continue; independent capability states show the reason. |
| Deadline, cancellation or extractor exception | Bounded optional work stops; no partial enhanced model publication; usable baseline retained. |
| Silence, noise, clipping, irregularity, insufficient harmonics | Explicit null/unavailable descriptors or guarded quality state; no closure conclusion. |
| Stale result or new recording | Suppress live cues immediately; keep old evidence only as dated history. |
| Measurement available, inference unavailable | Measurements may display; no inferred source/closure claim. |
| Capability changes after a prediction is frozen | Preserve committed feature/model versions; incompatible component unscorable; compatible baseline remains scoreable. |
| Repeated failure and recovery | No uncontrolled retry loop; retry/new evidence is deliberate; restart preserves baseline and status. |

## Evidence status

Primary-source guardrails have been reviewed and sent to implementation owners. Implementation review and test evidence are recorded below when the modules are available. The plan alone is not evidence that these cases pass. No synchronized human EGG or laryngeal imaging was available to this reviewer; physical closure accuracy is unvalidated.

## Initial implementation review

Reviewed the canonical extractor, worker, contracts and tests in `singing-teacher-a-phonation`; saved-recording wrapper and tests in `singing-teacher-a-phonation-wrapper`; and live runtime, component, comparison helper and tests in `singing-teacher-a-phonation-ui`. These were separate in-progress worktrees, so the results below are module evidence, not proof of final app wiring.

Concrete findings, highest priority first:

- **P1, corrected by owner and verified:** `src/phonation/measure.ts` initially hashed a copied buffer before an asynchronous digest, then analyzed the caller's mutable original buffer. The owner now snapshots once; the mutation regression passes independently.
- **P1, corrected by owner and verified:** `src/phonation/runtime.ts` originally kept polling after an extractor returned failed/timed-out observations. It now stops the optional graph for returned failures, as well as worker errors and hard timeout. The focused actual-extractor timeout regression passes independently.
- **P1, corrected by owner and verified:** `server/phonation-worker.mjs` initially used fit completion time as observation evidence time. The integrated correction (`bb8de7d`, `3f73943`) preserves unknown original capture time as null and records analysis time separately. The old-recording freshness regression and real worker test pass independently.
- **P1, integration requirement:** `science/src/singing_physics/phonation.py` has finite candidate counts and individual extractor subprocess timeouts, but requires an aggregate isolated deadline/cancellation boundary before session integration. Native synthesis must not hold the core process indefinitely.
- **P2, corrected in code:** native source-family capability originally checked only control names/bounds. It now checks the selected speaker model and matching speaker artifact hash. Report actual fitted controls separately from supported bounds.
- **P2, corrected by owner and verified at helper level:** live reference compatibility resets on processing metadata changes even when the same stream object remains active. The comparison helper regression passes; full component verification is separate.

Independent commands and results:

- `node --experimental-strip-types --test src/phonation/measure.test.ts`: **4 passed**. Covers analytic harmonic slope, source-kind invariance, silence/noise/clipping/high pitch, cancellation, insufficient harmonics, and caller-buffer mutation.
- Additional analytic harmonic probes at 44.1/48/96 kHz: 18 cases executed. 65/180/600 Hz produced supported estimates near the expected −6 dB/octave slope; 800/1000/1600 Hz were explicitly unavailable. This tests the declared estimator gates, not human validity.
- `node --experimental-strip-types --test server/phonation.test.mjs`: **6 passed** on the integrated branch after the timestamp correction. Covers disabled mode, missing module, saved history, timeout/circuit status, old-recording freshness and the actual isolated canonical extractor on imported PCM.
- `node --experimental-strip-types --test src/phonation/runtime.test.ts`: **8 passed** at UI commit `035bafe`. Uses the actual canonical extractor behind injected browser surfaces. Covers optional graph cleanup without stopping caller tracks, silence/mute/end, hung worker, worker error, extractor-returned timeout, cancellation during startup, evidence expiration and matched-reference variation. It is not a real-browser microphone test.
- Actual local-server startup with `server/phonation.mjs` absent: **passed** against root registration `545e376`. Copied the server tree into an isolated temporary directory, excluding the optional module and all `.env` files; enabled the feature and used an ephemeral loopback port. `/api/status` returned HTTP 200 with `local: true`; `/api/phonation/status` returned HTTP 200 with measurement `unsupported` and baseline scoring `unchanged`. The isolated process was terminated and temporary files removed.

No-stubs audit: no `TODO`, `FIXME`, `placeholder`, `dummy`, `fake` or `stub` matches in the reviewed canonical and server phonation production paths. Injected test surfaces are explicitly test infrastructure; no fixture measurement replaces production DSP.

Wiring audit: the extractor and saved-recording worker call the same canonical function. Live DSP runs in a dedicated worker and does not open a second microphone stream. Final App/server registration, source fitting into current session updates, and prediction-capability compatibility must be verified in the integrated branch before claiming end-to-end completion.

Minimality audit: no new third-party DSP dependency was introduced for these modules. The source fitter's Node subprocess bridge preserves one extractor, at the cost of process startup per candidate. Keep execution bounded; do not add a second feature implementation merely to avoid that overhead.

## Opt-in measurement acceptance

The reviewed software evidence supports enabling the acoustic measurement and within-session comparison UI **by explicit opt-in**, while source inference remains disabled. This acceptance covers graceful degradation and honest acoustic feedback; it does not establish closure detection, personalized tissue mechanics or clinical accuracy.

Browser verification supplied by the separate QA owner at `24622f4` reports two passing integrated tests. This reviewer read those tests: they generate an audio MediaStream, then use the real application graph, dedicated Worker and canonical extractor. They check disabled startup, measured tone, suppression on silence, optional worker failure, and retention of the shared microphone when phonation stops. Astra calls are blocked in this browser test; it does not independently prove the native/Astra scoring loop. Unit/runtime checks complement the browser cases with expiry and timeout behavior.

Native source research module at `6ab2d5a`: this reviewer independently ran `PYTHONPATH=.:science/src <existing science venv>/bin/python -m pytest -q science/tests/test_phonation.py`: **4 passed in 12.07 seconds**. Actual synthesis tests cover equal finite source/tract comparisons, held-out pitch change, tract-only change, unavailable harmonic descriptors, pre-cancellation, invalid controls/budgets, synthesis failure and baseline restoration. No model update is performed. The module remains internal and disabled pending an aggregate isolated execution boundary and actual session integration.

The internal missing-extractor scorer finding was corrected in `4212faa`: missing or changed extractor files after forecast commit return unsupported, with no score or model update and no mutation of the frozen artifact. The owner verified six native tests. Source inference remains disconnected and disabled.

Final integration note: the first default-browser batch exposed a test-fixture autoplay assumption. `2d99407` fixes it by activating the generated stream through normal visible microphone controls and a user gesture. The separate browser owner repeated both cases twice against the integrated application with default Chrome settings; all four executions passed. No product workaround or fabricated feature observations were introduced.

The root's final integrated batch subsequently passed all **14 browser tests**, covering phonation, Astra decisions, memory, capture processing, probe UI and scoring recovery. The root also passed **12 native Python tests** for source research and probe recovery, **24 server tests**, the native two-round app loop, build/type checking and lint. The experimental source inference remains disabled despite its module tests; its missing runtime/session connection is explicit in the delivery status.
