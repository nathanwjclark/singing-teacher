# Acoustic mapping review

The Experiments page accepts `probe-measurement.json` from the dedicated acoustic-probe importer. It validates the additive `probe-records-1.0.0` schema and retains each file by its SHA-256 in private browser IndexedDB (`singing-teacher-probe-review`). Identical imports are idempotent. Capture IDs, calibration records, source hashes and extractor identities remain unchanged. Review copies can be exported or deleted; deletion does not delete source captures on the Mac.

The chart displays valid-band response magnitudes, with invalid bands omitted. A second retained record can be overlaid. The overlay does not calculate a reference ratio, claim matching placement, or substitute for calibration. Repetition count, clipping, SNR, per-band coherence/relative variation, timing support and uncertainty remain visible, including unavailable values. Software fixtures are explicitly labeled.

The native checklist matches the first one-phone producer: Acoustic mapping, Prepare route, Placement ID, Export route / level-check request, Import reviewed output-level check, a comfortable selected pose, Start 3 probes, Stop and Share latest private export. The check is a real external dependency; the web UI does not certify it or play sound. Native probing pauses depth capture and must be separate from ordinary singing recordings.

The viewer verifies the report structure and imported report bytes only. The local importer verifies raw drive/microphone hashes and sample windows. A self-edited report is not certified evidence: downstream fitting must revalidate original artifacts. Browser review imports never update the anatomy model.

The external-loudspeaker observation operator and joint-fit service are missing dependencies. There is no configured runtime Astra tool service in this app. The fixed capture checklist is not an adaptive agent decision, and this delivery does not satisfy G8/G9. The current contract deliberately rejects reports claiming inclusion in a fit; a future versioned fit-result producer must provide operator/job/forecast/score lineage.

Validation: build/typecheck and lint; Chrome smoke using the DSP agent's known-filter software-fixture export tested import, duplicate handling, persistence after reload, invalid JSON rejection, chart rendering and review deletion. No human playback or private-data upload was performed.
