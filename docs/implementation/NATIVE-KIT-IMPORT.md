# Private native capture → KIT observation

After the native iPhone app exports a capture ZIP, unpack it locally. The importer accepts the **directory containing `manifest.json`**, rather than the ZIP itself. Keep original bytes; it neither uploads nor converts media.

```sh
node --experimental-strip-types scripts/import-native-capture.ts "/path/to/capture-ID" \
  --participant local-participant --session session-2026-09-10 \
  --output "/path/to/native-observation.json"
```

The output must not already exist. It is written with owner-only permissions. Keep output outside the capture directory (which is checked for unreferenced files). Open Experiments → Import results and select this JSON: `records` contains a KIT-01 `ObservationBundle` checked by `validateRecord`. Relative artifact URIs resolve against the original capture directory, not the metadata export's location. Preserve that directory beside the export or supply it as the artifact base to a scientific consumer; the dashboard imports metadata and does not upload/load raw media automatically.

The optional preceding `scripts/review-native-depth.py` ZIP review reports coverage. The importer independently verifies all referenced artifact hashes and exact byte counts, safe single-component filenames, regular files without symlink traversal, numeric ordered source timestamps, raw packed float32 metre depth dimensions, consistent filtering, and interleaved LPCM format/byte counts. Arbitrary unreferenced entries are rejected; normal `.DS_Store` files and `__MACOSX` directories from Finder are ignored. Import is bounded to 512 MB of manifest/artifact data.

## Meaning of the resulting observation

- RGB JPEG, raw depth and optional PCM chunks remain separate artifacts. The original manifest is itself a hashed artifact preserving **all** per-frame calibration, source formats, invalid-depth semantics, dropped output/write errors, device and timing metadata. No image rotation, rectification, RGB registration, depth-to-point conversion or model fitting occurs.
- Each modality has its own declared native source clock. `captureMs` is the original rational source timestamp converted to milliseconds, with `device-monotonic` origin. Clock epochs must remain constant within each modality. Reference clock, offset and synchronization uncertainty remain `null`. Similar timestamps and synchronizer delivery do not establish measured physical synchronization.
- The depth stream declares hardware/front TrueDepth source based on native metadata. Its calibration references the original manifest **only if every acquired depth frame contains validated camera calibration**. Partial/missing calibration remains `not-calibrated`; no universal intrinsic matrix is substituted. Native lens distortion remains unapplied.
- Nonfinite/nonpositive depth pixels remain in the raw artifact and valid counts are reported per sample. All-invalid frames are low-confidence. Relative/unknown native depth-accuracy labels mark that sample `not-calibrated`; they cannot count as validated absolute-depth evidence in the dashboard. Camera calibration alone does not establish sensor accuracy.
- Unavailable modalities have explicit reasons. Known missing/drop callbacks contribute to `droppedSamples`; an unknown number of undelivered PCM samples is not inferred from this count. Gaps and ASBD metadata remain available in the original manifest. No synthetic audio, depth, hidden geometry or clock alignment is substituted.
- `predictionId` is null. This capture is not retrospectively claimed as a prospective trial. Consent describes the native explicit private recording path; importer execution does not establish participant enrollment or specialist approval.

Hashes establish package consistency, not device authenticity. The native schema is self-reported. Synthetic fixtures used by the three focused importer tests are software checks only and must not be imported as human observations or treated as device acceptance evidence. Native iPhone recording and reconstruction validation remain separate acceptance gates.
