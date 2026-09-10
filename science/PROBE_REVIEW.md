# External acoustic probe independent review

Scope: revision-7 plan `ab7415d`, PROBE-03 physics and PROBE-04 inverse/service.
This report separates software verification from physical phone acceptance.
Implementation findings and evidence will be appended after owner revisions exist.

## Physics acceptance

- Declare one harmonic sign convention. Complex propagation, attenuation,
  radiation/termination impedances and external propagation delay must all use it.
- Verify a uniform tube against its analytic input impedance; verify matched,
  closed and open termination limits and equivalence of split versus unsplit
  segments. Lossless matched propagation must not manufacture gain. Passive
  loads and declared dissipative propagation must have nonnegative absorbed power.
- Preserve dimensional units: pressure/volume-velocity impedance, mouth area,
  length, density, sound speed, frequency and dimensionless reflection are
  distinct from received digital PCM per transmitted digital PCM.
- A free-field source includes direct and reradiated paths and an explicit
  coupling/instrument model. A sealed-tube reflection formula or existing
  glottal-source transfer cannot be relabeled as phone response.
- Unbranched oral geometry supports only its declared boundary/channel model.
  Nasal/branching observations without an implemented operator remain excluded,
  with an explicit reason, rather than interpreted as internal geometry.

## Inverse acceptance

- Canonical observed response units, source hashes, extractor version,
  calibration validity and frequency masks are validated before scoring.
- Phase contributes only when timing supports it; masked/invalid values cannot
  affect scores. All-invalid channels remain recorded as unused.
- Complex components and correlated frequency bins do not become independent
  samples merely by array length. Uncalibrated scales yield a labeled discrepancy,
  not a posterior or calibrated anatomical confidence.
- Shared anatomy and pose-specific controls feed both operators. Gain, placement,
  leakage and constrained instrument nuisance parameters remain distinct from
  anatomy. Joint and fixed-anatomy baselines receive the same nuisance support.
- Budget accounting includes PCM synthesis, probe operators, baseline and failed
  attempts; report distinct units rather than equating one spectrum evaluation
  with one synthesized waveform.
- Preserve held-out/calibration separation and physical source evidence lineage
  across modalities. Reimporting the same observation cannot silently add weight.

## Software versus physical acceptance

Analytic fixtures and synthetic recovery/mismatch tests can verify equations,
units, masks, lineage, budgets and end-to-end software wiring. They do not certify
speaker/microphone calibration, output acoustic level, real placement coupling,
processing absence, capture synchronization or hidden anatomical accuracy.
Physical G8/G9 acceptance still requires actual recorded probes and independent
scoring. Software progress does not need to wait for those external inputs, but
must preserve them as distinct unmet evidence requirements.
