# Optional saved-recording phonation

`PHONATION_MEASUREMENT_ENABLED=1` enables `POST /api/phonation/analyze` with no body. Default is disabled. `GET /api/phonation/status` and `readPhonationContext` expose measurement, source inference and coaching independently.

Analysis verifies the completed run's original import digest and each analyzed derived LPCM artifact digest, then executes the shared canonical extractor in a separate Node process. It examines the first canonical frame of at most four imported segments. Browser-reported descriptors are never substituted for these measurements. Absolute capture time is unverified, so `evidenceAt` is null. Analysis time is retained separately and cannot establish evidence freshness. `readPhonationContext({dataRoot, compact:true})` omits full history and stale descriptors for Astra.

Work is bounded to 15 seconds and one concurrent request. Three consecutive failures or interruptions open a persisted session circuit. Starting a new fit creates a fresh session. Results and failures are retained under `.local-data/phonation/<sessionId>` with their original timestamps and canonical extractor/configuration versions. Saved recording descriptors do not authorize live coaching; the microphone module supplies that separate capability. Five-minute-old descriptors are omitted from current Astra context but remain visible as dated history.

Source inference is an explicitly gated conditional research path in this runtime. `PHONATION_SOURCE_ENABLED=1` permits the isolated source fitter, prospective source bank, later score and Astra context; disabled or unavailable states preserve the baseline. Existing frozen forecast descriptors, source assumptions, scores and model updates remain unchanged unless an authoritative source receipt says otherwise. Astra must not add a source action absent from the actual frozen forecast.

Missing optional modules, disabled flags, low quality, timeouts and worker failures return non-blocking capability states. The core server does not import the optional extractor at startup. No paid model calls occur in this module.
