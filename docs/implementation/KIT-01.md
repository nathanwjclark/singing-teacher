# KIT-01: runnable contract boundary

Contract version: `1.0.0`. Starting integration commit: `30eaf6d`. Owner: Lead B.

The implementation is in `src/contracts/index.ts`; import its types and validators directly. This is the G0 schema handoff. It does not satisfy G1 genuine engine/capture artifact exchange: an engine-generated audio/geometry pair and a real synchronized phone capture are still needed from their producer owners.

## Shared decisions

- Records are ordinary JSON, with `schemaVersion`, a discriminating `kind`, a stable opaque `id`, timezone-qualified ISO `createdAt`, and provenance. Use `crypto.randomUUID()` for new IDs. IDs are unique across a replay; do not reuse an observation ID for a changed recording.
- Provenance distinguishes `human-observation`, `engine-generated`, `derived-measurement`, and `development-fixture`. Store producer/version and source IDs/hashes. Fixture evidence is never a live reconstruction result. Physical interpretations need scientific review by Lead A.
- Media bytes are separate artifacts. Each artifact has a relative bundle URI, byte length, media type and lowercase SHA-256 digest. A digest records content integrity, not authenticity or scientific correctness.
- Capture timestamps are milliseconds on a declared source clock, relative to session start or device monotonic origin. Record `clockId`, any measured offset to a reference clock, and synchronization uncertainty. Unknown uncertainty/offset stays `null`; network arrival times cannot substitute for capture timestamps. Cross-device clock synchronization remains the capture producer's responsibility.
- Every observation describes audio, RGB and depth. An absent modality has zero samples and an explicit missing reason. Browser landmarks are not measured depth. Captured depth needs its own samples, depth/disparity representation, physical units, camera optical coordinate frame and filtering flag. Camera optical means x right, y down, z forward. Calibration points to a separate hashed artifact; that artifact should contain intrinsics, extrinsics and alignment diagnostics appropriate to the sensor. Missing calibration remains explicit.
- Audio measurements name their method, evidence, clock and window, and each value's unit/uncertainty. Missing values are `null` plus a reason. dBFS is a digital level, not calibrated sound pressure. The initial unit vocabulary can be extended only through an intentional contract revision.
- Profile captures describe visible-surface bootstrap steps and capture/skip/failure evidence. They do not establish hidden muscles or internal anatomy.
- Candidate anatomy separates global/dynamic/nuisance parameters, measured/inferred/fixed status, bounds, physical meaning and simulator mapping. An available candidate needs solver/config provenance. An unavailable candidate has no parameters or geometry and an explicit reason, such as `engine-unavailable`. Imported illustrative anatomy is not a fitted candidate.
- Forecasts specify frozen model/version/evidence, experiment/intervention, named scoring rule, units and uncertainty, held-out mode and solver-call budget. Unavailable forecasts carry no invented outcomes. Scientific support for interventions must be checked by the engine adapter/orchestrator; a valid JSON forecast alone does not establish support.
- Jobs expose explicit states, an idempotency key, input/output references and failed/blocked reasons. Job execution, persistence, cancellation and stale model rejection belong to the service and orchestrator.

## Prediction commitments and evaluation

`createPredictionCommit(forecast, { id, committedAt, provenance })` creates an independent JSON snapshot, SHA-256 hashes its canonical sorted-key representation and recursively freezes it. `verifyPredictionCommit(record)` validates the schema and digest. Store the resulting record once; never regenerate it after observing outcomes.

`validateProspectiveEvaluation(commit, evaluation)` additionally checks the matching prediction ID/digest, capture after commitment, non-overlapping fit/held-out observation IDs and matching baseline solver-call budget. It returns an array of errors. Independent evaluation still owns singer/session split leakage, actual measured capture timing, fixed scoring implementation, eligibility and alternative-budget accounting. A hash and browser freeze are tamper detection aids, not an external trusted timestamp or append-only archive; the service must enforce write-once storage and chronology for a stronger prospective claim.

Failures/exclusions retain observation IDs and reasons. No result is implied simply by validating a manifest. The kit does not run an engine or infer anatomy.

## Commands

One focused smoke exercises incompatible versions, explicit missing data, immutable snapshots, digest tampering and prospective leakage/chronology:

```sh
node --experimental-strip-types --test src/contracts/contracts.test.ts
npx tsc -b
```

Replay validation of a saved record or JSON array of records:

```sh
node --experimental-strip-types scripts/validate-contracts.ts manifest.json
node --experimental-strip-types scripts/validate-contracts.ts --artifact-root ./capture-export observation.json prediction.json evaluation.json
```

The second command additionally verifies observation artifact bytes against declared lengths/hashes. Include the referenced prediction alongside evaluations to check their prospective boundary. Paths must stay within the artifact directory. The CLI accepts only local file-backed media for verification, never downloads arbitrary URLs, and exits nonzero on invalid schemas, mismatched bytes/digests, duplicate IDs or failed prospective checks.

## Current validation and blockers

The focused smoke and TypeScript build passed. Its synthetic values are explicitly `development-fixture` and test software integrity only. Runtime validation enforces field shapes and the described local invariants; it cannot verify that a producer's scientific statements are true. Genuine engine export, native measured depth, calibrated sensor synchronization and end-to-end scientific replay remain pending producer deliverables, not silently passing gates.
