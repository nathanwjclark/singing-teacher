# Ordinary native singing capture → calibration input

`importSingingSession(captureDirectory, freshOutputDirectory, configPath)` in `science/scripts/import_singing_session.ts` connects an original `singing-native-rgbd-1.0.0` bundle to the existing canonical PCM fitter and session calibration ingestion. Production code reuses `importNativePcm` and B's exact audio extractor. It does not generate audio, infer the sung pose, or use a test fixture factory.

```sh
node --experimental-strip-types science/scripts/import_singing_session.ts RAW_CAPTURE FRESH_PRIVATE_OUTPUT CONFIG_JSON
```

The configuration is explicit, source-bound JSON:

```json
{
  "schema_version": "0.1.0",
  "kind": "singing_session_import_configuration",
  "source_manifest_sha256": "<SHA256 of exact original manifest bytes>",
  "participant_id": "local-participant",
  "session_id": "local-session",
  "evidence_kind": "human-observation",
  "recording_kind": "ordinary-singing",
  "contains_external_excitation": false,
  "expected_session_version": 0,
  "selections": [{"trial_id":"vowel-a","segment_index":0,"frame_start_sample":4800,"pose":"a","execution_controls":"unknown"}],
  "candidates": [{"candidate_id":"conditional-template","anatomy":{},"trials":{"vowel-a":{"JA":-2,"f0_hz":180,"gain":0.1}}}],
  "max_synthesis_calls": 2
}
```

The hash above must be supplied from the original file, not copied literally. All source and derived PCM bytes are verified. Native formats, exact windows, rates, highest-energy channel selection, timestamp gaps and original-chunk offsets follow `NATIVE_PCM.md`. Select 1..10 existing canonical windows by segment index and start sample. No automatic replacement window or successful subset is selected. Reused or overlapping derived/original source intervals are rejected, including aliases under another trial ID. Pose is user-declared; if the native manifest declares a pose it must agree. Execution controls remain **unknown**. Candidate JA, pitch and digital gain are hypotheses, not measurements of execution or true physiological limits. Finite candidate anatomy is additionally validated by the actual native fitter.

Declare `evidence_kind:"development-fixture"` for generated test data. Physical recordings require their actual provenance; package consistency does not authenticate a phone. Explicit probe/excitation metadata is rejected, and the caller must declare that ordinary recordings contain no external excitation. This is a provenance boundary, not an audio-content detector. Unknown room response and source behavior remain model limitations.

Outputs under a fresh0700 directory (files0600):

- `native-pcm/`: canonical records and verified derived PCM with original-chunk lineage.
- `singing-observations.json`: selected usable `canonical_pcm_observations`, with exact unchanged measurements.
- `singing-fit-params.json`: `{observations,candidates,max_synthesis_calls}` for `fit_pcm`; null when any selected window is ineligible. Budget covers candidates and equal-compute fixed-anatomy baseline.
- `singing-session-command.json`: `{action:"ingest_calibration",expected_version,document}` when every selection is usable and `expected_session_version` is supplied. It does not execute the command or automatically launch search.
- `singing-import-receipt.json` and original configuration bytes: all selections, exclusions, source bindings, cuts and uncertainty. No actual fit is claimed by the receipt.

Clipped, unavailable or descriptor-poor windows remain listed with reasons. A partial usable set does not silently become a complete calibration request; revise selections and candidate declarations explicitly. Existing raw gaps cannot be bridged by selecting a window.

## Verification

```sh
SINGING_PYTHON=/path/to/science/.venv/bin/python PYTHONPATH=science/src \
node --experimental-strip-types --test science/scripts/import_singing_session.test.ts
```

Executed **3 tests passed**. A newly written original synthetic native bundle traversed original-byte validation, canonical extraction and the actual native PCM fitter: **4 synthesis calls, two scored candidates**. This is a software integration result, not human singing/anatomy validation. Tests also cover duplicate intervals, clipping, unavailable starts, private modes, fresh outputs, source-config mismatch, corrupt bytes and external-probe rejection. The test constructs its original PCM bundle directly and uses no prior test fixture factories or alternate extractor.

Strict TypeScript with bundler resolution passed. NodeNext checking requires explicit extensions in the existing `audio.ts` / `audioCalibration.ts` reciprocal type imports; the integration owner is fixing those dependencies. Native Node execution of the three tests passes because type imports are erased.
