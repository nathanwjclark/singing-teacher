# Independent motion-audio review

Scope: original retained motion-media audio → decoding → bounded conditional native PCM comparison. This is an audio-only analysis. Visual synchronization remains unknown; 2D landmarks do not enter the objective. No calibrated human motion evidence is required to verify this software path.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | A window could be labeled scored when every predicted candidate was unscorable. | The runner now requires a scorable joint candidate; otherwise it retains the window and candidate failures as insufficient quality. Actual silence retains unavailable windows with zero synthesis. |
| P1 | Decoder subprocess sessions could escape outer cancellation; server restart could lose the only deadline. | Decoder processes share the runner group. The CLI has its own 230-second hard watchdog and parent-loss termination; the server also terminates the group. An independent actual CLI parent-loss test confirmed that both runner and hung decoder stop. |
| P1 | Reused request IDs could return results for a changed vowel/model declaration. | The server rejects mismatched declarations. A remaining UI correction must key retries by baseline model as well as capture/vowel, so a valid new-model retry does not repeatedly submit the rejected old ID. |
| P2 | Source defaults and provenance were insufficiently explicit. | Receipts retain original source kind, native source controls, fixed pressure/ramp, observed pitch assumption, implementation hashes and native provenance. Synthetic evidence is not labeled human. |

The baseline is read, not updated. Expected model and capture identity are checked; historical results are distinguished from results for the current model. All three declared audio slots remain visible, including silence, excluded short/overlapping slots and failed predictions. The hard aggregate counter limits synthesis to 108 calls, with at most three ledger-order anatomy hypotheses explicitly identified as a subset.

## Evidence

- **Reviewer-run:** `science/tests/test_app_motion.py`, expanded regression at `2819b75`: **2 passed in 14.98 seconds**. Includes actual native audio encoded as WebM, real decoding/canonical extraction/native fitting, three scored windows and 36 calls, unchanged baseline, silence with zero calls, all-candidates-unscorable suppression, and decoder timeout/reaping. Multiple cases live inside the lifecycle test; this is not a claim of two cases only or a larger test count.
- **Reviewer-run:** existing HTTP motion persistence test: **1 passed**, preserving exact original media/JSON across restart.
- **Reviewer-run:** actual CLI parent-loss probe with a deliberately hung decoder: **passed**. Only session HTTP setup was injected to reach decoding. The real CLI watchdog terminated both processes after their launcher exited. Temporary artifacts/processes were cleaned up. Two initial attempts failed because of test-harness setup (stdin multiprocessing and a shebang containing spaces); neither was a product failure.
- **Integration owner supplied:** actual app runtime test at `1dc9e28`, integrated as `c11f9a7`: **passed in 64.22 seconds**. Voiced WebM produced 72 calls, two scored windows and one duration-excluded slot; complete baseline state and original summary hash stayed unchanged. Silent MP4 produced insufficient quality with zero calls; audio-absent media produced unavailable with zero calls; missing decoder returned 503; restart/idempotent recovery passed.

Final browser and UI baseline-aware retry verification are pending at this report revision. Approval requires that correction; there are no remaining numerical/process findings from this review awaiting a code fix.

## No-stubs, wiring and minimality

No `TODO`, `FIXME`, `placeholder`, `dummy`, `fake` or `stub` matches were found in the reviewed runner, server routes and motion panel production paths. Test-only injected failures exercise real failure handling. Observed PCM comes from the retained original media; synthesized audio is used only for predictions. There is no fabricated transfer response in place of recorded audio.

The UI calls the analysis route, which verifies the saved capture and launches the numerical runner. The runner reuses the existing canonical PCM extractor and native fitter. Decoder absence and quality failure preserve replay, downloads and baseline modeling. No new competing microphone stream or second fitting implementation is introduced.

This is a finite, approximately stationary vowel comparison with explicit source/control assumptions. It does not recover continuous articulation, synchronized audiovisual motion, internal tissue dynamics, vocal-fold contact or unique anatomy. Independent window rankings are not a shared dynamic trajectory or proof of physiological change. Missing human reference data remains a research limitation, not an artificial software-release blocker.
