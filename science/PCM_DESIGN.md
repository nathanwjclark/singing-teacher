# Canonical PCM experiment design and conditional support update

This component asks which **predeclared simulated experiment** most separates a
retained finite set of physiological hypotheses in canonical PCM descriptors. It
synthesizes waveforms and uses B's canonical extractor. It does not reuse transfer
spectra as microphone features, estimate information gain, or select runtime human
cues.

## API

`freeze_pcm_hypotheses(model_id, evidence_ids, evidence_hashes, provenance,
hypotheses, frozen_at)` is keyword-only and returns an immutable `Artifact`.
Each hypothesis is `{hypothesis_id, anatomy}`. A dedicated native Engine validates
geometry, expands overrides to complete applied anatomy, and closes afterward.
Identical applied geometries collapse to one support point with retained alias
metadata. Renaming an identical candidate does not create extra uncertainty mass.
The freeze records caller time and an actual server seal timestamp.

`design_pcm(snapshot, *, expected_digest, design_id, target_observation_id,
generated_at, experiments, feature_scales, minimum_separation=1,
retention_margin=1, maximum_discrepancy=2, max_synthesis_calls=64,
node_binary=None, profile=None, objective='canonical-coarse-v1')` returns a sealed `frozen_pcm_experiment_design` artifact.
With `objective='multires-log-spectrum-v1'`, pair separation and later scores use
the spectral discrepancy (`docs/physiology/WAVE3_SPECTRAL_OBJECTIVE.md`), and pitch
and periodicity scales must be declared.

Each experiment declares exactly `experiment_id`, native `pose`, `JA`, `f0_hz` and
positive scalar `gain`. Bounds are JA −5 to −1 degrees, F0 65–1000 Hz and gain
0.001–100. Up to 16 experiments and 32 distinct anatomy candidates are supported,
with a hard ceiling of 512 synthesis calls. All geometry starts from its explicit
complete anatomy. Requested/applied native controls are retained.

The default profile uses 44.1 kHz, duration 0.25 seconds, and samples 4410:8506
(4096 samples, starting at 100 ms), preserving existing callers. For native phone
recordings, explicitly pass `profile={"sample_rate_hz":48000,
"frame_start_sample":4800,"frame_size":4096,"duration_s":0.25}`. A 96 kHz
profile uses 8192 samples (for example, starting at sample 9600). The profile must
contain exactly these four fields; supported rates are 44100, 48000 and 96000 Hz.
The frame must fit within the declared 0.1–5 second synthesis duration, and its
size must match the canonical extractor for that rate. These dimensions are frozen
before receipt, and updates must explicitly match rate, offset and size.

Only generated forecasts are resampled, using the same `resample_native_pcm`
polyphase conversion as PCM inverse fitting. Conversion settings and SciPy version
are retained per prediction. Actual observations retain their original sample rate
and samples; no automatic observation resampling or window substitution occurs.
The chosen offset is relative to the declared source recording; this API does not
recover capture time or align an independently executed gesture automatically.

`feature_scales` declares 3–5 canonical feature names, each with `{unit, scale,
assumption}`. Supported names and units are `dbfs`/dBFS, `centroidHz`/Hz,
`flatness`/ratio, `pitchHz`/Hz and `periodicity`/ratio. Positive scales and their
assumptions are explicit inputs, not estimated noise or confidence intervals.

Pair separation is RMS feature difference divided by those declared scales. The
criterion maximizes the **worst retained-pair** separation. Missing required features
for any candidate make that experiment ineligible; missingness cannot improve its
score by dropping difficult features. Identical outcomes, insufficient distinct
support, and separation below the chosen threshold yield `selected_experiment_id:
null`. Ties use experiment identity for deterministic ordering.

`update_pcm(design, snapshot, *, expected_design_digest,
expected_snapshot_digest, experiment_id, observation_id, artifact_id, observed_at,
pcm, sample_rate_hz=44100, frame_start_sample=4410, frame_size=4096,
source_kind='engine-generated', node_binary=None)` consumes an actual supplied PCM
frame. Human input requires explicit `source_kind='human-observation'`.

The update extracts canonical descriptors itself. It seals observation identity,
exact little-endian float32 frame hash, frame profile, extractor hashes and actual
server receipt time. Caller-declared capture time must follow the design's server
seal and precede receipt. This establishes local receipt order, **not authenticated
physical recording time or crop origin**. External capture/commit attestation remains
necessary. Recordings are not relabeled human by default.

The output contains `status`, per-hypothesis scores, `observation_receipt` and digest,
plus `updated_snapshot` and its digest. Wrap the latter as
`Artifact(_encode(result['updated_snapshot']))` for another design. Updated model
identity depends on parent snapshot, design, experiment, receipt and retained support;
different designs cannot alias distinct updates under the same model ID.

## Conservative update behavior

Only a separated, fully observed experiment with best standardized discrepancy no
larger than the frozen `maximum_discrepancy` can narrow support. It retains every
candidate within the frozen `retention_margin` of the best score. Missing observations,
missing predictions, model mismatch, and nonseparating experiments retain all current
support and preserve the reason/history. A single retained candidate ends further
pair discrimination; it does not establish physiological identification.

Evidence IDs and hashes accumulate. Reusing exact frame bytes is rejected even with
renamed observation/artifact IDs. Input evidence hashes should include raw canonical
float32-frame hashes when available. Whole-file hashes and different overlapping
crops are not equivalent to frame hashes; uniqueness does not establish statistical
independence. Earlier snapshots and designs remain unchanged and retain eliminated
alternatives for audit. No irreversible scientific certainty is claimed.

Native provenance includes geometry basis/library identity. Extractor and contract
source hashes must remain unchanged across design and update. Each design records
`objective`, `objective_policy` and `scorer_implementation_pin` (hashes of the Python
scoring modules and the extractor bridge script, plus NumPy/SciPy versions, computed
once when the process imports them). Selection and update reject a design whose pin
differs from the running code. Designs sealed before pins existed are still accepted
for the coarse objective and the update reports `scorer_pin_status:
legacy_version_unverified`; otherwise it reports `verified`. Canonical prediction
features, hypotheses and score/status bindings are checked on update. Digests protect
content identity and internal consistency; they are not cryptographic authentication
of externally supplied assertions.

## Scientific limits and verification

This is conditional on specified executed jaw position, pitch, gain, source physics,
window and retained geometry search space. People do not necessarily execute a cue
at those controls. Coarse PCM features cannot recover complete anatomy, hidden tissue
mechanics or unknown room/microphone filters. Thresholds are heuristics; outputs are
neither calibrated posteriors nor human efficacy claims.

Run `PYTHONPATH=.:science/src science/.venv/bin/python -m pytest
science/tests/test_pcm_design.py -q`. Native tests cover real synthesis/extraction,
receipt/update lineage, missing-feature abstention, indistinguishable support,
source-frame replay rejection, budgets, state release, canonical tamper detection,
model mismatch and distinct model identity across different designs. Native 48/96
kHz regressions synthesize a later waveform after sealing the design, use the
canonical rate conversion, verify exact descriptor agreement and original frame
hashes, and reject mismatched or altered profiles. These are synthetic physics
integration checks, not human recording validation.

`select_pcm_experiment` commits an explicit choice among an existing design's
complete numerical forecasts. It validates both artifact digests and current
snapshot binding, requires fresh design/target IDs and a bounded reason, and
preserves all numerical forecasts unchanged. The artifact records source-design
lineage, `selection_policy`, and `additional_synthesis_calls: 0`. This supports
orchestrator-selected repeated actions without reclassifying single-hypothesis or
nonseparating predictions. Outcomes of explicitly selected designs must match the
committed experiment; the ordinary discrepancy/status logic remains unchanged.
