# Native external-probe scientific bridge

`science/scripts/import_probe_science.ts` connects an **original native bundle** to A's `fit_probe_pcm` observation input. It calls B's exact `importAcousticProbe`, verifies its full response artifact, and selects explicit full-resolution frequency bins. It never fits B's display summary, reimplements DSP, substitutes glottal transfer, or changes B's immutable `includedInFit:false` record.

## Run

```sh
node --experimental-strip-types science/scripts/import_probe_science.ts RAW_CAPTURE FRESH_PRIVATE_OUTPUT CONFIG_JSON
```

The exported function is `importProbeScience(captureDirectory, outputDirectory, configPath)`. It returns `{probe_document, receipt, measurement}`. `probe_document` is an `external_probe_observations` document suitable for the existing joint fitter's `probe_document` argument, together with separately supplied canonical singing observations and candidates. Unsupported captures produce `probe_document:null`, with captured status and reasons retained. Eligibility is not evidence that a fit has executed.

Outputs are `probe-science-document.json`, `probe-science-receipt.json`, the exact configuration bytes, and the unchanged B records/full response under `b-import/`. The output must be fresh. Directories are mode0700 and files0600. Source capture/evidence files are read without following file symlinks; bounded byte lengths and hashes are verified. Original manifest, drive, received and native level-check artifact are verified again after extraction. No original bytes are modified.

## Required explicit configuration

See `setupFixture()` in the test for a complete runnable synthetic example. JSON fields:

- `schema_version:"0.1.0"`, `kind:"probe_science_import_configuration"`, `trial_id`, `pose`, `pose_state:"held-quiet"`, `comparison:"complex"|"magnitude"`.
- `selected_indices`: 2..512 strictly increasing indices into B's **full** response. Selection is supplied, never optimized on outcome. Calibration frequencies must exactly match selected frequencies. Masks are preserved, no interpolation or averaging occurs.
- `bands`: 1..32 nonoverlapping selected-bin groups with `low_hz`, `high_hz` (exclusive), positive `sigma` and `weight`. These are declared discrepancy scales; adjacent FFT bins are not independent observations.
- `placement`, `calibration`, `conditions`: exact external operator declarations from `ACOUSTIC_PROBE.md`. Source-volume-flow per digital drive and microphone PCM/Pa arrays are mandatory. Unknown device/room response cannot be replaced with invented calibration.
- `nuisance_prior`: `prior_id`, `source_hashes`, and fixed or bounded `gain`, `direct_gain`, `coupling_gain`, `delay_s` intervals from `PROBE_INVERSE.md`.
- `evidence`: 1..32 `{path,sha256,byteCount}` files relative to the configuration directory. Every calibration/prior source hash must correspond to verified supplied bytes. Received target bytes cannot calibrate themselves.
- `processing`: `{kind,evidence_id,route_id,source_hashes}`. Kind is `declared-software-fixture` for fixture evidence or `characterized-measurement` for physical evidence; hashes must bind verified supplemental evidence. Missing processing characterization excludes the observation while retaining B's original warning. This is an explicit caller-supported declaration, not automatic device characterization.
- `capture_binding`: `{manifest_sha256,pose,placement_id,route_id}` binds the supplemental configuration to the exact original capture. For physical/human captures `native_route_signature` must additionally equal `native.calibration.levelCheck.routeSignature`; native pose and placement must match. Missing or mismatched binding yields no fit document. Fixture bindings do not fabricate native hardware metadata.

Physical-reference evidence requires calibration kind `measured`; fixture declarations stay `synthetic-fixture`. Verification proves supplied bytes and bindings, **not authenticity or physical sufficiency** of calibration. Route processing and calibration evidence require independent scientific assessment.

A `human-recording` capture is never eligible, whatever the configuration declares. Every calibration, processing and placement field in a configuration is a declaration: nothing in this repository yet derives calibration arrays from measurement recordings (for example a reference-microphone sweep), and hashing evidence files is not measurement. The importer still writes the review and receipt, with the reason `Calibration is declared, not measured; no measured-calibration evidence was derived.` first in `reasons`, and a null fit document. The inverse fitter also rejects probe records whose source kind is `human-recording` (`human_recording_calibration_declared_not_measured`) or that list iPhone recorder fields (`native_capture_fields_mark_human_recording`). The fitter sees only the probe document, so a hand-built document that claims another source kind and omits those fields is not caught there. In the app every fit re-runs this importer on the original capture bytes first; a direct `fit_probe` command to the authenticated worker relies on its caller for provenance. Lifting this rule needs a pipeline that derives the calibration from recordings; changing labels in a package is not enough.

Provenance is still self-declared. The capture `manifest.json` and the `native-pull-latest.json` receipt (`{name, sha256, bytes}`) are unsigned, and `capture_binding.manifest_sha256` hashes whatever manifest is present. The importer therefore classifies the source from the manifest's own fields (`probeSource` in `src/contracts/probes.ts`), not from the label alone: any field only the iPhone recorder writes (`route`, `playbackSchedule`, `rgbDepth`, `linkedDepthCaptureId`, `collectionSessionId`, `calibration.levelCheckArtifact`, `calibration.deviceResponseCalibrated`) makes it a human recording whatever `provenance` says, and a `software-fixture` label counts only with the fixture generator's calibration id (`digital-fixture-no-human-playback`, written by `scripts/acoustic-probe-fixture.ts`). A contradicted label is reported as a reason and in the receipt (`provenance`, `declared_provenance`, `native_capture_fields`). This only refuses labels the manifest contradicts: a manifest edited to drop those fields and add the fixture id still passes as a software fixture. The recommended fix is to record provenance outside the manifest: the USB pull writes the source device and archive hash into its own receipt at pull time, or the iPhone signs the manifest with a device key, and the importer checks that instead of the label.

Phase follows B's native timing and must satisfy the inverse operator's maximum .1-radian uncertainty at active frequencies. Unsupported phase is excluded rather than assigned zero uncertainty. Explicit magnitude comparison may use unknown phase/delay. Stopped, clipped, discontinuous, unrepeatable and no-supported-band captures remain captured but ineligible. No nasal channel is synthesized.

## Verification and scientific result

```sh
PROBE_PYTHON=/path/to/science/.venv/bin/python \
PYTHONPATH=science/src \
node --experimental-strip-types --test science/scripts/import_probe_science.test.ts
```

The native test also uses `science/tests/test_probe_inverse.py::probe_fixture` for independent singing PCM/candidates. `PROBE_FIXTURE_TEST` can locate that test in a sibling integration checkout during development; it is not a production bridge input.

Executed **5 tests, all passed**: B's original known-filter fixture test; exact full-bin/source binding; private permissions/fresh output; stopped/unsupported-processing/phase paths; corrupt bytes/calibration grid/capture binding; and original B fixture -> actual joint native fitter. Two later tests cover a human recording with a declared-measured package (ineligible with the reason above) and the unchanged physical-reference and synthetic paths; the file now runs 7 tests. The end-to-end run used **12 actual operator calls** and reported `joint_probe_evidence_used`. Probe discrepancies were **6126.29688549578** and **6126.287609975195** for its two candidates. The known FIR filter does not represent the operator's vocal anatomy, so this is a connected harness with a negative model-match result, not recovery validation. Evidence source: software fixture. Human/hardware acquisition remains untested here.

Strict TypeScript verification **passed** after integrating the owner's B importer identity fix `d2bd6a5` (local cherry-pick `e3aba64`):

```sh
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict \
  --allowImportingTsExtensions --module nodenext --target es2023 --types node \
  science/scripts/import_probe_science.ts science/scripts/import_probe_science.test.ts
```
