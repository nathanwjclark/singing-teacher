# Lead B acceptance ledger

This ledger distinguishes executable checks from physical-device and learner evidence. A passing build does not close a human-data gate. Nicole's scientific queue is integrated from PR #3, commit `615fde362960c0452a233e80c1f75d2b4d7a03de`; it includes PR #1 revision 6 and PR #2. Scientific numerical implementations remain Lead A's reviewed work.

## Runnable handoff

Public contracts: `src/contracts/index.ts` (KIT 1.0.0). Validate exported records with `node --experimental-strip-types scripts/validate-contracts.ts FILE...`. Canonical microphone/synthesized-PCM measurement: `src/lib/audio.ts`; the same extractor analyzes native audio and human recordings. `docs/audio-measurement.md` defines quantity/units and calibration limits. **Native transfer magnitude in dB is not microphone amplitude in dBFS.** No adapter silently equates these quantities.

Native forward export to public KIT and rendered geometry:

```sh
git submodule update --init --recursive
python3.12 -m venv science/.venv
science/.venv/bin/python -m pip install -e './science[test]'
science/.venv/bin/python science/scripts/build_native.py
PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/replay_science.py science/artifacts/acceptance-replay --budget 20
node --experimental-strip-types scripts/import-science-forward.ts science/artifacts/acceptance-replay/synthetic-forward science/artifacts/acceptance-replay/capabilities.json science/artifacts/acceptance-kit
node --experimental-strip-types scripts/validate-contracts.ts science/artifacts/acceptance-kit/observation.json science/artifacts/acceptance-kit/candidate.json science/artifacts/acceptance-kit/measurements.json
```

Output directories must be new. Adapter checks all native artifact hashes and matching build provenance, preserves mesh triangles (centimeters converted to meters), and uses the canonical PCM extractor. Import candidate JSON and its geometry.gltf into Mapped mode. The displayed geometry is the actual native forward model with fixed parameters; this export is not a fit of the participant. Use the audio and observation/measurement records as A's concrete AUD/KIT handoff. No participant media belongs in the public repository.

## Gates that still need external evidence

- CAP native acceptance: actual iPhone synchronized audio/RGB/TrueDepth or LiDAR, calibration, sensor timestamps, missing samples and repeated stop/permission-loss trials on target devices. Current private-HTTPS browser capture does not expose raw hardware depth. A native acquisition adapter and a person operating the phone are required; browser landmark depth cannot substitute.
- AUD capture compensation: relative ambient-noise calibration is implemented. Recovering microphone/room transfer response requires a declared source/capture model and calibrated evidence, not only silence.
- G2: independently scored hidden synthetic recovery with equal-budget baseline and A numerical signoff. Replaying A's existing synthetic workflow alone is not independent confirmation of anatomical recovery.
- G3: real calibrated multimodal fitting and independently scored human outcomes. Depends on capture above and A's measured-audio likelihood.
- G4/G5: prospective real forecast/observation/score/update and independent two-person reproduction/modality comparison. Existing ledger/evaluator supports valid records; no human outcome has been invented to fill it.
- G6: repeated real gesture recordings with actual visible trajectories affecting fitting. Image-plane normalization is not a calibrated three-dimensional head frame.
- G7: specialist-reviewed cue library, actual learner attempts, independent cue-free recall/phrase-transfer comparison and later-session retention. Review declarations are not supplied by an automated test.

The tongue-label export is a real visible-tip annotation set with invalid direction categories excluded. It is not synchronized depth, a clinical anatomical measurement, or cue-learning evidence.

## Integration evidence from this run

- Fresh native build passed its required 21 native checks; no broad Python suite was rerun.
- Native fit/forecast replay and motion/control/conditional-forecast replay passed locally.
- New `scripts/import-science-forward.ts` verified producer hashes, converted 2,988 native triangles to self-contained glTF and validated KIT audio/geometry records.
- New `node --experimental-strip-types scripts/replay-native-kit.ts NEW_DIRECTORY` executes real native synthesis, canonical audio extraction, durable KIT commitment, later fresh synthesis, and independent scoring. Forecast model lineage and source artifact paths are preserved. This is a controlled fixed-source synthetic integration check; the initial waveform is intentionally deterministic, so low error is not predictive generalization or anatomical recovery evidence.
- The pitch fix was checked on 28 frequency/sample-rate combinations and Chrome's real MediaRecorder/decode path with A3 → A4 → silence → E4. Hardware microphone and phone audio-route checks still require the actual devices.

The reconstruction direction is recorded in [mouth-reconstruction-direction.md](../research/mouth-reconstruction-direction.md).

Revision 6 learning exports include `kit.records` alongside the local protocol/replay envelope. Run `node --experimental-strip-types scripts/validate-learning.ts EXPORT_JSON` to check the shared record schema and cue/attempt references. The validator cannot verify specialist credentials or substitute for actual learner evidence.

Native depth export inspection is available as `python3 scripts/review-native-depth.py CAPTURE.zip --output NEW_REPORT.json`. It verifies recorded bytes and metadata and reports valid-depth coverage. It does not undistort, infer missing surfaces, or certify interior-mouth measurement accuracy.
