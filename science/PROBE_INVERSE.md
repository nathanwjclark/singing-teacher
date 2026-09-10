# Joint singing PCM and external acoustic probe fitting

`fit_probe_pcm(engine, pcm_document, probe_document, *, candidates,
max_native_calls=128, pcm_weight=1., probe_weight=1., node_binary=None)` evaluates
1–32 predeclared shared anatomical candidates. This is an internal scientific
profile, not the B acquisition schema. The executable native fixture is
`science/tests/test_probe_inverse.py::probe_fixture(engine)`.

PCM documents and candidate `trials` use `PCM_INVERSE.md`. Each candidate adds
`probe_trials`, a map from probe record ID to `{JA, gain, direct_gain,
coupling_gain, delay_s}`. Anatomy remains shared between modalities; quiet probe
JA is explicitly controlled separately from singing JA. Anatomical bounds and
full applied controls come from the existing finite PCM fitter/native engine.

Probe documents contain exactly `schema_version: "0.1.0"`,
`kind: "external_probe_observations"`, and `trials` (1–16 records). Each record:

- `id`, optional `split` (defaults to calibration; other splits excluded before
  reading response values), `channel: "oral_external"`, `pose_state: "held-quiet"`,
  native `pose`, and explicit `quality_flags`.
- `quantity: "recorded_pcm_per_digital_drive"`, increasing `frequency_hz`,
  `response_real`, `response_imag`, boolean `valid_mask`. Invalid components may
  be null. Arrays have 2–512 entries at 20–20000 Hz; native support is narrower.
- `comparison: "complex" | "magnitude"`, and `timing` with boolean
  `phase_verified`, `uncertainty_s`. Complex comparison additionally needs timing
  `evidence_id` and SHA256 `source_hashes`, with worst active frequency phase
  uncertainty at most 0.1 rad. This experimental guard does not certify timing.
- `bands`: disjoint sampled frequency bands `{low_hz, high_hz, sigma, weight}`.
  Sigma is a declared response-unit discrepancy scale, not inferred precision.
- `source`: `kind` (synthetic-fixture, physical-reference, human-recording),
  `drive_artifact_id`, `received_artifact_id`, `drive_sha256`, `received_sha256`.
- `placement` and `calibration` exactly as `ACOUSTIC_PROBE.md`.
- `nuisance_prior`: `prior_id`, calibration `source_hashes`, and `bounds` for
  gain, direct_gain, coupling_gain, delay_s. Supported outer bounds respectively
  [0.01,100], [0,2], [0,2], [-0.01,0.01] seconds. Fixed intervals are supported.
- `conditions`: explicit `termination`, `termination_resistance_pa_s_m3`,
  `attenuation_np_per_m` as accepted by the external operator.

The transformed response is gain × exp(-i2πf delay) × (direct_gain × direct +
coupling_gain × signed mouth response). Calibration identity binds placement,
calibration, prior, and scalar nuisance across records. Per-frequency fitting
filters are not supported. Calibration or priors cannot cite their own received
response as a source. Calibration, prior, and timing source hashes cannot cite any
fitted PCM or received probe response. Physical-reference and human-recording
responses require measured calibration; fixture calibration remains synthetic.
Evidence IDs/hashes are conservatively exclusive across
received probe records and singing PCM; repeated drive calibration is allowed.
Held-out received identity/hashes are excluded from calibration and conditioning,
without reading held-out numeric responses. Source bytes and physical provenance
are not authenticated by this function; the caller must verify artifacts.

Each frequency band contributes its mean standardized squared residual, then
bands receive declared weights, probe trials equal weights, and modalities their
explicit weights. This is a heuristic discrepancy, not a calibrated likelihood
or independent-bin evidence count. A candidate must predict every active
observed frequency; unsupported bands do not selectively vanish for a candidate.
All-invalid, unsupported-channel and unusable records retain exclusion reasons;
failed native predictions and missing canonical features retain failed candidates.

The fixed-anatomy comparison repeats identical nuisance candidates and declares
actual call equality separately from scientific identifiability. The budget
counts PCM synthesis, native probe geometry, and external numerical evaluations
separately, including failed invocations: normally `2*C*(P+2*Q)` calls for C
candidates, P PCM records, Q usable probes. Preflight rejects insufficient budgets.
Repeated fixed-anatomy candidates may duplicate computation; this is not a claim
of equally effective optimization. Inputs are copied and anatomy restored.

Outputs retain every candidate, prediction, failure, band score, native controls,
source/document hashes, comparison counts and best finite candidate. They never
assert identified anatomy or calibrated uncertainty. Real native analytic fixture
recovery verifies implementation consistency; an out-of-grid case retains mismatch.
Free-source oral conditions and explicit calibration remain strong assumptions;
real device validation, public B adapter, nasal/open-velum operators, simultaneous
voicing/probing and validated human physiological identification remain unsupported.
