# Frozen external-drive probe prediction

`probe_prediction.predict_probe` wraps the shared `acoustic_probe` external monopole
and oral transmission-line operator. It does not call the glottis-to-mouth transfer
function. Each retained anatomy produces an explicit direct-path plus mouth-scattered
response under the declared instrument, placement and boundary conditions.

The input is an immutable full-applied-anatomy snapshot from
`pcm_design.freeze_pcm_hypotheses`; its historical name does not require the anatomy
to have been fitted from PCM. This forecast creates no anatomy. It verifies the
snapshot digest, complete support, native library/geometry-basis provenance and
model seal, then uses one external-operator call per hypothesis in a dedicated Engine
context. Process-global native state is released on success and failure.

## Private API

```python
forecast = predict_probe(
    snapshot,
    expected_digest=snapshot.sha256,
    prediction_id="probe-forecast",
    target_evidence_id="next-probe-capture",
    generated_at=generated_at,
    pose="a",
    frequency_hz=frequencies,
    placement=placement,
    calibration=calibration,
    calibration_evidence_ids=["calibration-reference"],
    calibration_frozen_at=calibration_frozen_at,
    articulation=None,
    channel="oral_external",
    comparison="magnitude",
    timing={"phase_verified": False, "uncertainty_s": None},
    termination="rigid",
    termination_resistance_pa_s_m3=None,
    attenuation_np_per_m=0.5,
    max_operator_calls=32,
)
```

The shared operator owns validation of source/microphone/mouth positions, exact
frequency grid, calibrated source volume velocity per digital drive, microphone
PCM/pressure response, route/placement identity, calibration evidence hashes,
propagation loss and glottal termination. Its calibrated response has quantity
`recorded_pcm_per_digital_drive`; it is not microphone dBFS, glottal transfer, a
universal reflection coefficient or a directly scanned cavity.

Calibration also needs source evidence IDs and a freeze timestamp at this wrapper
boundary. Its physical operator schema contains hashes but does not independently
identify the calibration capture records or their chronology. Those supplied IDs
and timestamps are retained with the operator calibration; their authenticity is
explicitly unverified. Forecast target identity must differ from fitting evidence,
calibration evidence and the calibration record itself.

`generated_at` must follow both the sealed model and declared calibration freeze,
and cannot be future-dated. The completed artifact records an actual server
`sealed_at`. The coordinator must commit its exact bytes/digest **before** recording
the target. Local seal time cannot independently authenticate physical capture time.

## Outputs and support

The returned immutable `Artifact` has kind `frozen_external_probe_prediction` and
includes model/snapshot identity, native/operator provenance, exact configuration
and calibration/placement hashes, fitting/calibration evidence, frequency grid,
requested band and actual/max operator calls. Each `predictions` item contains the
original hypothesis identity, applied anatomy, response magnitude and complete
shared operator result, including direct and mouth components and validity reasons.

`common_valid_mask` identifies bins supported by every retained candidate. If there
is no common valid bin, availability is `unavailable` with an explicit reason;
unsupported frequencies remain null, never zeros. All other raw operator masks and
limitations remain available for inspection. Repeating identical inputs gives
identical numerical operator predictions; server seal timestamps distinguish separate
executions. Saving an artifact refuses to overwrite an existing file.

Magnitude is the default comparison. Complex comparison requires an explicit
verified timing record and uncertainty producing no more than 0.1 radian phase error
at each candidate's highest supported frequency. Mathematical complex model outputs
may still be inspected in magnitude mode, but that mode does not authorize measured
phase comparisons or anatomical time-of-flight claims.

Only the current closed-velum oral operator is supported. Nasal channels, open-velum
branches, head/phone diffraction and unconstrained room response are not fabricated.
The source must satisfy the shared compact-mouth placement/radiation assumptions.
Candidate differences are conditional model predictions, not a calibrated posterior
or proof of anatomy recovery. No public KIT probe schema is defined here; B owns that
contract and capture/measurement/evaluation integration.

## Verification

With the shared acoustic-probe module and native build available:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_probe_prediction.py -q
```

Tests compare real native candidate forecasts directly with the shared external
operator, preserve masked bands and component-derived magnitude, reject stale native
basis/digests, unsupported nasal/open-velum/boundary requests, invalid calibration,
chronology/evidence overlap and exceeded budgets, and verify native release and
artifact no-overwrite behavior.
