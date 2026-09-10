# Optional prescribed-source inference (PHON-02)

This additive module is scientifically executable and defaults off. It does not
modify Engine.synthesize, baseline models, sessions, app startup or live coaching.
The app's source-inference capability must remain disabled until a worker consumer
and optional prediction/update policy are connected and independently verified.
Measurement-only phonation coaching can run independently.

The pinned JD3 speaker XML selects **Geometric glottis**. The module verifies its
hash against Engine provenance and checks native parameter bounds, rather than
inferring a physical source family from sound. Supported controls are F0 65–600 Hz,
PR 4000–12000 dPa and pulse skewness PS −0.3–0.3. The experiment's source-shape axis
is PS. Flutter FL=0, double pulsing DP=0 and aspiration AS=−40 dB are declared fixed
values; all remaining parameters use recorded native defaults. Every synthesis
resets the solver and applies a 25 ms pressure ramp. Identical actual native calls
were exactly repeatable in the fixture. These are prescribed simulator controls,
not measured muscle, airflow, vocal-fold contact, closure or tissue parameters.

`fit_phonation(engine, document, *, candidates, max_synthesis_calls=96,
enabled=False, timeout_s=60, cancelled=None)` consumes a document with
`schema_version: phonation-fit-1` and 1–4 calibration-only `trials`, each exactly
`id`, `pose`, `pcm`, `sample_rate_hz`, `metadata`. PCM is one unmodified canonical
frame at 44100/48000/96000 Hz. Metadata uses PHON-01's shared schema. Candidate
objects contain `candidate_id`, anatomy overrides, and `trials` keyed by trial ID,
with explicit JA/F0/PR/PS/gain. Up to eight candidates are evaluated.

The same Node/TypeScript PHON-01 extractor measures observed and generated frames.
Its source/configuration and imported contract files are hashed. All four features
(pitch, periodicity, flatness, raw acoustic harmonic slope) are required here; null
features yield unavailable/unscorable enhanced inference, not zeros. The raw slope
is not inverse-filtered glottal tilt and flatness is not HNR. Generated metadata
hashes exact float32 frame bytes; the window offset describes the declared crop
inside the synthetic trial, not an independently supplied full-recording artifact.
User metadata/source hashes are declarations; original source bytes are not fetched
or authenticated by this low-level API.

Three finite families use equal actual synthesis counts and identical nuisance
choices: joint anatomy+PS, fixed PS=0 with anatomical alternatives, and fixed
reference anatomy with PS alternatives. Complete discrepancy rankings, failures,
requested/native controls and features are retained. No posterior is computed.
The hard budget covers all three families. Exhausted/failed optional results never
publish a partial enhanced model. Native state is restored even on errors.

There are cancellation/deadline checkpoints and bounded extractor subprocesses.
A checkpoint cannot interrupt a hung native C call; deploy this API only inside a
process-isolated JobService-style worker with an external wall timeout/cancellation
before enabling it in the app. No second scheduler or mandatory dependency is
introduced. Module/extractor absence, disabled state, missing features and failed
comparisons preserve the existing baseline; callers retain errors/status separately.

`forecast_phonation` freezes one fitted family/candidate's PS for a new vowel and
explicit known JA/F0/PR/gain conditions, with a new target ID, source/extractor
lineage and digest. `score_phonation_forecast` checks digest, target, post-forecast
observation time and calibration-frame exclusion, runs the same extractor, and
returns a discrepancy without updating the model. Forecast profile is currently
44100 Hz/4096 samples/start4410. The function consumes one synthesis call outside
the fitting budget and declares that count explicitly.

Native tests recover a declared PS/anatomy candidate and score a later a-vowel at
200 Hz against fixed-source predictions. The attempted i-vowel held-out change
has insufficient harmonic descriptors; the test retains that unscorable failure.
Neither synthetic recovery nor missing harmonic evidence validates human contact
or unique source/tract separation. Human reference validation remains unavailable.
