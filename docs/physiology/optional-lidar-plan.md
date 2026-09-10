# Optional rear LiDAR — workstream A

Approved September 10, 2026. All tickets below start as planned. Rear LiDAR is an optional measured-depth input and comparison experiment, not a replacement for the existing TrueDepth path or a release gate. Workstream A owns the entire feature, including native capture, contracts, UI, scientific integration and independent verification. B has no new implementation, review, acquisition or acceptance assignment. This feature-specific exception supersedes the general B acquisition ownership only for this extension; it does not transfer unrelated work or interrupt active file writers.

## Goal and scope

Test whether rear LiDAR on the available iPhone 13 Pro Max or iPhone 15 Pro supplies useful visible-surface measurements at the actual working distances. Compare coverage, bias, repeatability and usable detail with TrueDepth before recommending a preferred sensor. Do not assume LiDAR is more accurate because of its name, or mistake a dense rendered mesh for independently measured detail.

Use supported native camera/depth APIs and expose actual capabilities at runtime. Start with separate deliberate rear-camera scans of held poses; do not assume simultaneous front TrueDepth, rear LiDAR, audio and RGB capture is supported. A different scan pose or time is separate evidence, not the geometry of an earlier sung note. Neither sensor observes hidden tissue around corners. Rear LiDAR does not replace the acoustic device/placement calibration required for probing.

## Owned tasks and acceptance

| Ticket | Owner within A | Deliverable and acceptance |
|---|---|---|
| LIDAR-01: native capture | Native implementer | Optional rear LiDAR capture mode with actual supported formats, RGB/depth calibration, source timestamps, sensor identity, filtering and missing-data metadata. Reuse existing archive/transfer conventions. Verify raw captured artifacts on a supported phone before claiming hardware acceptance. |
| LIDAR-02: controlled comparison | Independent evaluator, separate from implementation author | Predeclare target dimensions/reference uncertainty, distances, angles and tolerances. Measure coverage, bias, repeatability and retained detail for both sensors against independent targets; do not calibrate against the evaluated depth itself. Retain poor and missing results. Human mouth trials follow with visible-region and motion limitations explicit. |
| LIDAR-03: ingestion and geometry | Geometry/inverse implementer | Add backward-compatible sensor provenance and a supported projection adapter reusing existing validation. Preserve raw versus processed depth and confidence availability. Demonstrate original bytes -> projected visible geometry with units, alignment and uncertainty; never fill holes as measured anatomy. |
| LIDAR-04: app experience | Frontend/native integration implementer | Optional sensor selection, capture guidance, coverage/quality display and explicit unavailable state. Preserve existing microphone/camera lifecycle and baseline capture. Show LiDAR and TrueDepth artifacts with their real sensor/time/pose identities; a separate scan cannot silently replace current geometry. |
| LIDAR-05: conditional model use and recovery | Scientific integration implementer; independent A reviewer | Only accepted, registered visible-surface observations enter a supported geometry likelihood. Missing registration, correspondence or error characterization produces review-only evidence. Test prospective lineage, disabled/absent/failed paths and preservation of the last valid model; compare with/without LiDAR under equal budgets when evidence supports it. |

A owns dependency changes, focused tests, documentation, app/server registration, integration fixes and a release-ready PR. Use additive modules and small shared-file patches in isolated worktrees. Check current remote and protect active single-writer ownership before touching shared iOS/app files. Existing B infrastructure is reused without assigning B a new deliverable or feature-specific sign-off. A arranges later physical/reference measurements; unavailable hardware evidence is an explicit verification gap, not a blocker for the core app.

## Optional capability contract and graceful degradation

- Independently gate capture, geometry preview and model fusion; unfinished capabilities default off. Ordinary startup, TrueDepth/RGB/audio capture, fitting, Astra coaching, scoring and replay must not require LiDAR or its optional module.
- Report disabled, unsupported-device, unavailable-format, permission-denied, insufficient-quality, interrupted, failed and available states with reasons. Actual sensor provenance must distinguish rear LiDAR, front TrueDepth, RGB-only and derived face geometry.
- Reject unsupported capture combinations before disrupting the active session. Do not switch cameras mid-recording or acquire a second competing microphone. On explicit switching between recordings, release only owned resources and preserve the established baseline path.
- Bound optional processing and retries. A missing module, timeout, disconnection, invalid calibration, malformed archive or poor depth must not abort ordinary audio capture or publish a partial model. Do not silently label RGB estimates or TrueDepth as LiDAR fallback.
- Keep the current valid model and its declared limitations when LiDAR is absent or rejected. Old scans remain dated history; they do not become live measurements. Retain rejected evidence and reasons for inspection without granting it fitting weight.
- Freeze sensor, calibration, feature/operator versions and evidence IDs with each experiment. If required LiDAR evidence becomes unavailable, mark that component unscorable; score independent compatible components where possible. Do not rewrite a committed prediction or substitute another sensor after the fact.
- Astra receives explicit capability/quality status and chooses supported baseline tasks when LiDAR is unavailable. No mandatory setup wizard, blocking modal or repeated request for unsupported hardware.

## Verification and rollout

1. Verify capability discovery, archive handling and baseline fallback with controlled software evidence; such tests do not establish sensor performance.
2. On physical phones, test supported capture modes, permission denial, interruption, switching and ordinary recording after failure. Full native build/device checks remain explicit if Xcode or hardware is unavailable.
3. Run independent target comparisons and label whether LiDAR is useful at each tested distance/angle. A negative result is valid and may justify leaving fusion disabled.
4. Enable preview only after its path is verified. Enable fusion separately after calibration, registration, correspondence and real model consumption are verified. Preview-only delivery is valid partial scope, not completed inference.
5. Verify the existing app loop with LiDAR off, absent and failing. Record implementation status, evidence source and scientific outcome independently. This optional extension never gates the core release.

## References

- [Apple: capturing depth using the LiDAR camera](https://developer.apple.com/documentation/avfoundation/capturing-depth-using-the-lidar-camera)
- [Existing capture and depth plan](capture-and-depth-plan.md)
- [Independent native-depth target diagnostics](../../science/DEPTH_ACCEPTANCE.md)
