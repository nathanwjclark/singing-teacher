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

## Core operator and inverse review

Reviewed forward `e8d93bd`, forecast `dfd56c1` and inverse `8860edf` plus the
owner's physical-calibration follow-up. No sign/unit/passivity blocker was found
within the declared approximation. The mouth-to-glottis section recurrence uses
`gamma=alpha+i*omega/c`, with rigid `-i Zc cot(kL)` and pressure-release
`i Zc tan(kL)` lossless limits. The outgoing monopole phase uses `exp(-ikr)`;
inward mouth flow contributes a negative outward monopole. Length/area conversion
is cm→m and cm²→m² before pressure/volume-flow impedance evaluation. Low-ka oral
support is masked, and open velum is rejected instead of dropping its branch.
These are internally consistent software/model checks, not evidence that an
unflanged pipe plus free monopoles reproduces a face/phone acoustic boundary.

Independent verification:

- Forward analytic/native tests: **4 passed in 0.49 s**. Includes uniform analytic
  limits, subdivision invariance, matched load, nonuniform passivity, reciprocal
  source/receiver placement, source scaling and actual native geometry/masks.
- Forecast tests: **18 passed in 4.22 s**, using the integrated root module because
  the isolated forecast worktree did not contain its separately owned forward
  dependency. This resolves the initial isolated import failure without changing
  code or bypassing dependency validation.
- Inverse tests before the final provenance follow-up: **4 passed in 17.42 s**.
  Includes actual joint/baseline calls, invalid-mask/timing/held-out rejection,
  all-candidate unsupported prediction handling and direct-only confounding.

### Physical source versus fixture calibration — corrected boundary

The inverse initially accepted a `human-recording` or `physical-reference` source
with `synthetic-fixture` calibration. That could make physical evidence appear
included under invented instrument calibration. The owner added rejection unless
physical-source calibration is `measured`. A regression changes only the source
kind of the existing synthetic fixture and verifies exclusion. Calibration remains
caller-attested, not authenticated; this guard prevents a known declaration
contradiction, not forged metadata. The owner also excludes conditioning hashes
(calibration/prior/timing) that alias fitted PCM or received probe evidence.

### Inclusion, masks and budgets

`included_in_fit` is recomputed from probe predictions contributing to complete
scored candidates. A parsed usable record with no supported complete candidate
is not marked included. Candidate-specific unsupported bands cannot become zeros
or improve a score by selective omission: candidates must support every active
observed band. Complex comparison requires bounded timing uncertainty; magnitude
comparison does not authorize delay inference. Within-band residual averaging is
explicitly not independent-bin likelihood. Joint and baseline have identical
finite nuisance support, and both external evaluation and actual geometry calls
are counted alongside PCM synthesis, with separate counters.

### No-stubs, wiring and minimality

No placeholder physics or fabricated response arrays were found in these modules.
The external operator consumes the real native forty-section geometry, forecast
calls that operator, and inverse calls both canonical PCM fitting and external
prediction. The probe path does not reuse the glottal transfer as an external
measurement. Existing NumPy, artifact and engine primitives are reused without a
new physics dependency. Root owns durable service integration and the raw B
extractor bridge; the latter needs its own review when available. Real calibration,
playback/capture and G8/G9 acceptance remain distinct open gates.

Final inverse boundary follow-up `b223dfa`: independently reran both affected
mask/lineage and held-out/confounding tests; **2 passed in 14.60 s**. The prior
four-test run plus this targeted follow-up covers the reviewed changes.

## Raw-response bridge review (pending corrections)

Read `9d3ebf3` `science/scripts/import_probe_science.ts`, B's actual raw importer,
and Swift manifest producer. Two concrete issues were sent to the owner:

1. **Private output modes:** new bridge directories/files used default filesystem
   permissions, commonly 0755/0644, despite containing private response/configuration
   evidence. Require explicit 0700 output directories and 0600 files; verify mode
   bits, including nested B outputs or protection by their private parent.
2. **Capture/configuration binding:** supplemental calibration and processing route
   identifiers matched each other but not the original capture. Placement and
   declared pose likewise lacked original-manifest binding. A mismatched route,
   placement or pose could therefore be eligible. Require verified original
   bindings (including an explicit exact-manifest mapping where schemas differ);
   absent physical binding must remain captured but ineligible. Swift already
   records route, level-check route signature, placement and pose.

Otherwise the bridge reuses the actual B extractor and full response artifact,
reverifies source/derived bytes, retains exact selected bin indices and units,
keeps B's includedInFit flag immutable, and does not fabricate phase support.
No final bridge acceptance is claimed until the two corrections are verified.

Root's pending service/CLI diff was read: forecast dispatch opens its own native
context, joint fitting uses the worker-owned context, and allowed/required
parameters and snapshot model binding are wired. The one-shot CLI registry is
explicitly local and not authorization over a shared session. Root's prior real
service tests need not be repeated by this review without a relevant change.

## Final bridge disposition

Both pending bridge findings are fixed in integrated `ab54dbb`/`afdf931`.
The output parent is created 0700 before B writes any descendants; scientific
JSON files are 0600, and nested B output directory/files are explicitly restricted
to 0700/0600. The fixture regression verifies permissions and fresh-only output.

`capture_binding` now binds the exact original manifest hash and declared pose,
route and placement. Physical-source eligibility additionally checks the original
Swift pose, placement ID and level-check route signature against that binding.
Missing/mismatched declarations retain capture but produce no fit document.
The known-route mismatch regression exercises exclusion. This guards consistent
recorded declarations, not physical authenticity or placement measurement accuracy.
B identity fix `d2bd6a5` also preserves derived IDs when native metadata is spread.

Independently ran the complete integrated bridge suite with its documented
scientific runtime configuration:

```sh
PROBE_PYTHON=/path/to/science/.venv/bin/python PYTHONPATH=science/src \
node --experimental-strip-types --test science/scripts/import_probe_science.test.ts
```

**5 passed in 2.43 s.** Initial invocation without that documented Python/PYTHONPATH
configuration passed four Node-only tests and failed the native test's import;
using the existing scientific environment resolved it without code changes.
The real original-PCM → B extractor → A joint fitter regression used **12 actual
operator calls**, reported `joint_probe_evidence_used`, and retained large
nonzero probe discrepancies **6126.29688549578** and **6126.287609975195**.
This verifies a connected harness with a mismatched physical model; it does not
turn that mismatch into an accuracy gate or anatomical recovery claim.

No remaining blocking defect was found in the reviewed core/bridge revisions.
Root owns final aggregate tests, strict TypeScript verification and publication.
