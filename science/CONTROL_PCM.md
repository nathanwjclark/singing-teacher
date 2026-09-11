# Cue-execution learning with PCM control banks

Evidence so far: `synthetic` (native-engine recordings). Scientific outcome: `untested`. No human attempt has been scored, so nothing here shows that any cue changes how a person moves.

## Goal

Astra delivers a cue in words ("Sing an easy, comfortable ah."). The singer then records one attempt. This feature records the exact wording and context before the attempt and freezes a prediction over a finite bank of simulator executions: jaw angle `JA` and `F0` alternatives for each retained anatomy hypothesis. It then scores the later original recording against every alternative. Once the same wording and context have at least three matched scored attempts, the next frozen prediction weights the alternatives by how well each matched those attempts.

Wave 3 acceptance: bind exact delivered cues and context to original outcomes; finite PCM control banks and matching repeated attempts change the next frozen prediction; empirical residual calibration stays distinct from inferred physical execution.

## What the numbers mean

- **Control weights** are standardized-descriptor affinities under engineering scales. For one attempt and one anatomy, each alternative gets `exp(-0.5 * sum((observed - predicted) / scale)^2)`, normalized over the bank. The scales (pitch 20 Hz, spectral centroid 250 Hz, flatness 0.1) are engineering choices, not measured noise. The weights are not execution probabilities, measured movement or anatomy evidence.
- **Execution support** (`execution_support`) is the only frequency model: per anatomy, `weight = (1/C + sum of attempt affinities) / (1 + n)` with every matched attempt weighted equally. Below three matched attempts the weights stay uniform.
- **Residual calibration** (`empirical_residual_calibration`) reports count, mean and sample SD of observed minus the earlier frozen weighted prediction, per anatomy and descriptor. It is `empirical` at three or more matched attempts, otherwise `insufficient`. It never enters weights or `conditional_predictions`. Those earlier predictions used different weights, so the residuals are not stationary measurement noise and they do not describe physical execution.
- **Gain** is an acquisition response. It is one declared nuisance for the whole bank and never an alternative. dBFS is therefore not scored; a level mismatch would otherwise be credited to `JA` or `F0`.
- `JA`/`F0` alternatives can trade off against anatomy. When anatomies lead with different alternatives the support reports `anatomy_control_tradeoff: true`; exact ties are listed in `leading_control_ids`.

## Matching rules

History matches by one compatibility key: native provenance, extractor hashes, frame profile, feature scales, the cue (wording and its SHA-256, identity, mode), the context, the bank, the gain and the policy. Within that key, each attempt contributes per applied-anatomy SHA-256. A changed model ID or a pruned hypothesis set therefore keeps each surviving anatomy's history. Changing any part of the key excludes earlier attempts with an explicit reason.

The policy pins `control_pcm.py` and the PCM scorer modules by their SHA-256 at import (`pcm_design.SCORER_PIN`). Any edit to these files starts a new key, so earlier attempts no longer count. This is deliberate: an edited scorer may score differently. Restart the worker after an upgrade.

Repeated physical evidence (a reused attempt ID or any overlapping original hash) is an error. Stopped, failed and unscorable attempts stay in the ledger and never count. A score whose observed descriptors are missing is `unscorable`; a score where some anatomy rows were stopped or failed is `partial` and counts only for the complete anatomies.

## Design

| Layer | File | Responsibility |
|---|---|---|
| Core | `science/src/singing_physics/control_pcm.py` | `bank_binding`, `forecast_control_pcm`, `score_control_pcm`, `execution_support`, `residual_calibration` |
| Worker | `service.py` | `forecast_control_pcm` and `score_control_pcm` jobs in the isolated worker |
| Ledger | `session_control.py`, `session.py` | Immutable bindings, committed forecasts, receipts; history only from the ledger's own receipts |
| App job | `science/scripts/app_control.py` | `forecast`, `score` and `stop` phases for the current Astra decision and the latest USB pull |
| Server | `server/controlLearning.mjs` | `GET /api/control/status`; `POST /api/control/forecast`, `/score`, `/stop` (localhost, no body) |
| Astra | `server/astra.mjs` | `prompt.controlLearning`; optional `cueBindingId` decision field |
| Export | `server/sessionExport.mjs` | Binds `control-attempts/*/result.json` to the ledger and the retained original manifest |
| UI | `src/experiment/control/ControlLearningPanel.tsx` | Delivered wording, matched attempts, weights and a separate residual block |

### Session commands

- `declare_control_binding {binding_id, binding: {cue, context, controls, gain}}`. Redeclaring the same content is a no-op; the same ID with different content is rejected.
- `forecast_control {binding_id, target_id, parameters}`. `parameters` accepts only `profile`, `feature_scales`, `max_synthesis_calls` and `timeout_s`. The session injects its snapshot (with expected digest) and history from its own collected score receipts. Callers cannot supply either.
- `score_control {forecast_id, pcm, metadata}` requires a committed forecast for the current baseline, capture after the commitment and unused original hashes.
- `record_control_attempt {forecast_id, status: stopped|failed, reason}` preserves an attempt that was not scored.

Collected forecasts must retain every anatomy x control alternative of the declared binding. Collected scores must retain every committed alternative and bind to the forecast hash. A worker reply that fails these checks is kept as a `rejected` receipt instead of blocking the session. At most one control forecast is committed at a time: committing a new one marks the previous one `superseded` with a receipt, so the cue shown to the learner is the one the next recording is scored against. A baseline change marks committed forecasts `stale`. None of these operations changes the baseline model.

A forecast request carries only score receipts of bindings with the same content, because other bindings can never match its key. This keeps the request under the worker's 2 MB input bound; each receipt is a few kilobytes plus about 0.2 KB per bank row. The ledger still rejects reused evidence across all bindings.

### Context contract

`context = {capture_context_id, source_kind, pitch_hz, vowel, level, posture}`. `pitch_hz`, `vowel`, `level` and `posture` reuse the control profile contract (`singing_physics.control._context`). The app declares: `native-usb-pcm`, the run's evidence kind, the calibration-measured median pitch as reference pitch, the selected experiment's vowel, level `comfortable` and posture `not-instructed`. These are declarations about what was delivered, not measurements.

### App bank

`app_control.py` uses five alternatives around the selected experiment: the selected `JA` at the reference pitch, `JA ± 1`, and `F0` one semitone lower and higher. Gain is the experiment gain. With `n` retained anatomies a forecast needs `5n` native synthesis calls; the bank is refused when `5n > 96`, so at most 19 anatomies are supported. A forecast that times out keeps the remaining rows as `stopped`.

### Astra

When the session has bindings, the decision schema requires `cueBindingId` with enum `[null, ...binding ids]`. Choosing a binding delivers that wording verbatim; the provider's own text is kept as `providerCue`. `app_control.py` then reuses that binding exactly (wording, context, bank and gain), so its history matches even if the selected experiment would produce a different bank. Rest decisions, unknown IDs and bindings whose vowel differs from the selected experiment are rejected. `null` means a new free-text cue, which starts a new binding with no history. Without bindings the schema is unchanged.

## Usage

Local app: `npm run build`, then `npm run science:local`. Fit a voice capture, ask Astra for a recording decision, open Experiments → Cue-execution learning, press **Freeze prediction for this cue**, record one attempt with that exact wording, use **Pull iPhone**, confirm and press **Score latest capture** (or **Record attempt as stopped**). Each Astra decision gets one prediction; after it is scored, stopped or replaced, ask Astra again. Repeat with the same cue (Astra can choose `cueBindingId`). The fourth prediction is the first that can leave uniform.

Direct use:

```python
from singing_physics.control_pcm import forecast_control_pcm, score_control_pcm
frozen = forecast_control_pcm(snapshot, expected_digest=snapshot.sha256, cue=cue, context=context,
                              controls=[{'control_id': 'selected', 'JA': -3., 'f0_hz': 180.}, ...],
                              gain=4., target_id='attempt-4', history=ledger_receipts)
receipt = score_control_pcm(frozen=frozen, pcm=frame, metadata=metadata)
```

`history` must be receipts your own ledger collected; the function checks their self-hashes, not their origin.

## Verification

- `science/tests/test_control_pcm.py`: uniform below three matches and changed predictions at three; pruned support keeps per-anatomy history; changed wording, level, capture context, bank, gain, scales and profile exclude history; repeated evidence and tampered receipts rejected; outcome before the seal rejected; gain absent from support; residual calibration never applied; silent frames unscorable and uncounted; budget and timeout rules; the isolated worker path.
- `science/tests/test_session_control.py`: ledger-owned history, caller history rejected, history limited to same-content bindings, one committed forecast at a time, binding immutability, stale-on-baseline, pruned successor, stopped/failed/unscorable attempts preserved and uncounted.
- `science/tests/test_app_control.py`: the app's binding derivation, verbatim reuse of a repeated binding, and refusals for pitch range, budget, rest and non-recording decisions.
- `science/tests/test_app_control_loop.py`: real app routes, Astra route with a test-only provider and the HTTP worker through four delivered-cue rounds, plus a bound export.
- `server/controlLearning.test.mjs`, `server/astra.test.mjs`, `server/sessionExport.test.mjs`, `src/experiment/control/controlClient.test.ts`.
- `npx playwright test tests/control-learning.spec.ts` (default config, which builds the app) runs the built app, real routes and a real worker over a seeded session and saves screenshots under `test-results/`.

Measured on generated frames from the first anatomy at the `open` alternative (`test_control_pcm.py` fixture): forecasts 0–2 hold `1/3` for each alternative; after three matched attempts the first anatomy's weights are closed 0.247, open 0.451, higher 0.302 and its predicted centroid moves from 667.5 Hz to 693.2 Hz. A successor model with only that anatomy reproduces the same weights.

## Known limits

- Generated fixtures prove plumbing only. Human cue execution, and whether a cue changes execution at all, is untested.
- The five-alternative bank is a coarse finite support; the true execution can lie outside it. Weights near uniform mean the bank does not discriminate, not that execution is ambiguous in the body.
- A learner could pull several takes and score only the best one. Unscored takes leave no trace, so repeated attempts can be selected. Record every take, or record it as stopped.
- The same original capture may also be submitted as the baseline outcome. Control support is conditional per anatomy and never changes anatomy support.
- The session ledger stores the full state in every event. In the four-round app test the replay reached about 37 MB, above the exporter's 24 MiB bound, so long sessions export as `partial` without the replay. The first scored round exports completely. This ledger design predates this feature; each control round adds roughly 250 KB of state (mostly the scored PCM frame and the frozen bank in the score job request).
