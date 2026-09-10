# DEPTH-01 — prospective depth protocol

The dashboard component `DepthProtocolPanel` provides deliberate, repeatable comfortable-vowel tasks, modality selection, evidence readiness checks and a protocol/report JSON download. It never starts sensors or recording. Existing Capture controls own recording; ACT-01 owns prediction commitment, experiment transitions and the ledger.

Pass `observation?: ObservationBundle`, `commit?: PredictionCommit`, and `captureStartedAt?: string` from the capture-owner receipt. Optional `onProtocolChange` exposes requested modalities to integration. Missing props are an explicit waiting state. `inspectDepthTrial` is independently callable by orchestration.

Default acquisition requests audio, RGB and measured depth. Three five-second front-facing comfortable “ah” repetitions follow bench geometry checks, alignment-event calibration and stable room/microphone setup. Each repetition gets its own committed forecast and trial ID; rest between trials. Use identical evidence and budgets for later modality ablations. The 20 ms synchronization goal comes from the planning addendum and is provisional, not a sensor accuracy claim.

Readiness verifies KIT schema, immutable forecast digest, human-held-out mode, prediction linkage, evidence exclusion, required sample presence, explicit hardware depth provenance, calibration reference and a common capture clock with known uncertainty. Native adapters must set depth stream `settings.depthSource = "hardware"`; face meshes, landmarks and browser RGB do not qualify. Calibration artifacts must retain intrinsics and depth/RGB alignment. The panel checks metadata/reference presence, not the correctness of calibration bytes or the honesty of acquisition provenance.

KIT has no wall-clock capture-start field. Supply a timezone-qualified ISO capture-start receipt from the acquisition owner. Never substitute bundle `createdAt` (export time), network arrival time or a new timestamp on import. Missing receipts block prospective readiness. The helper does not verify media hashes or parse sensor artifacts; ingestion owns byte-level integrity.

The report always retains a manual quality-review item covering scale bias, missing pixels, repeatability, filtering, clock drift and room calibration. `ready-for-review` is not scientific acceptance or an assertion that the sensor recovered hidden anatomy. No native depth integration, forward model, numerical forecast or performance result is fabricated. Automatic room calibration belongs to AUD-01; this protocol asks that its artifacts be retained.

Validation: production TypeScript/Vite build and one targeted gate test (valid manifest, missing capture receipt, post-capture prediction, estimated depth and absent depth). No deployment or CI changes in this feature.
