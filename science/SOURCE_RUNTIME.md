# Optional app source inference

Enable `PHONATION_SOURCE_ENABLED=1` once on the local server. Source operations run independently of the baseline model. `POST /api/source/analyze`, `/forecast`, and `/score` accept no parameters; `GET /api/source/status` supplies progress and results. No paid model call is made by these endpoints.

Analysis uses a hash-verified native import, an explicitly declared vowel, the measured acoustic pitch and the full retained anatomy support. It evaluates bounded prescribed pulse-skew alternatives against fixed-source and fixed-anatomy comparisons. Jaw, pressure and amplitude controls remain declared simulator assumptions. Eight candidate and 24 synthesis-call limits constrain this initial one-window analysis; larger anatomy support is explicitly unsupported.

Forecasting seals one conditional source prediction in the existing session, using the current selected Astra vowel when available. Scoring verifies a newly pulled original USB capture, its native-declared UTC chronology and its frozen sample rate, then uses the same optional canonical descriptors. No observed PCM is resampled. Unknown acquisition times cannot satisfy prospective chronology. A source score retains the current source hypotheses and reports discrepancy; it does not claim to update anatomy or establish glottal contact.

Per-attempt commands and input bindings are saved before submission. Explicit retries recover only their own worker job. Repeated identical submissions reuse completed results. Forecast identities include source model and completed score count, allowing subsequent rounds; score identities include the frozen target and original archive digest. Source result files never overwrite the baseline summary, geometry, forecast or score.

The status field `forecast.current` is authoritative for offering a recording task. A completed subprocess alone is insufficient: the source forecast must remain committed, compatible with the current baseline and source model, and numerically available. REST decisions block new source forecasts and scores. Missing optional modules, unsupported evidence and failed workers preserve the baseline.
