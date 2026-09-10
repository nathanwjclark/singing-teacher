# Phonation and vocal-fold closure inference

Approved scope addition: phonation belongs in both physiological inference and live coaching. This addendum extends the revision 8 research harness. All tasks below are planned, not implemented or validated by this document. Workstream A owns the entire feature, including extraction, app wiring, coaching UI and verification. This is a feature-specific exception to the usual A/B responsibility split: B has no assigned implementation, review, acquisition or acceptance task for phonation. It introduces no timing commitment and does not interrupt another writer's active file edits.

Phonation is an optional enhancement, not a release gate or prerequisite for existing capture, fitting, Astra decisions, coaching, scoring or replay. Incomplete implementation or unavailable evidence must not block the core app. The requirements below define graceful degradation and supersede any implication that PHON-01–05 must finish before the existing harness can ship.

## Optional integration and graceful degradation

- **Independent capabilities:** report measurement, source inference and coaching availability separately. Measurement-only coaching may ship before joint inference. Enable each capability only when its real implementation is connected and verified; default unfinished capabilities off. Do not require optional dependencies at core application startup.
- **Backward-compatible contracts:** phonation fields are optional in existing recordings, models and sessions. Consumers accept their absence. Distinguish disabled, unsupported, insufficient-quality, timed-out, failed and available states, with a reason and evidence timestamp. Missing data is never a zero value, healthy-closure result or substitute measurement.
- **Bounded execution:** optional extraction/inference uses bounded work, deadlines and cancellation outside the capture/render critical path. Its failure does not abort a recording, crash the app, trigger unlimited retries or consume unbounded API/native compute. Retry deliberately or on new eligible evidence; repeated failures disable the affected capability for the current session with a recoverable status.
- **Preserved baseline:** continue the existing verified modeling and coaching path when phonation is unavailable, retaining its declared fixed-source assumptions and limitations. Do not pretend the baseline has separated source behavior from anatomy. Never overwrite a valid model with a partial or failed enhanced fit; publish enhanced results atomically only after validation.
- **Honest prospective scoring:** pin capability, feature and source-model versions in each frozen forecast. If required phonation evidence disappears mid-experiment, mark that component unscorable with its reason. Score independent compatible baseline components where possible; do not silently change the committed scoring basis, impute closure or perform an unsupported update. Retain the prior model and let the learner continue with another supported task.
- **Coaching and Astra:** remove unavailable phonation actions from the supported action set. Give Astra explicit missing-data status and require it to select existing supported tasks instead. Suppress stale phonation cues immediately when their evidence expires or becomes invalid; a saved result may remain visible only as dated history. Show a small non-blocking availability message when relevant, not a modal or mandatory setup flow.
- **Recovery and reproducibility:** record feature configuration, failures and fallback choice alongside session lineage without secrets. Refresh/restart must recover the usable baseline and recorded status. Re-enabling phonation applies to a new analysis or experiment; it must not retroactively change prior predictions or scores.

A owns scientific fallback semantics, atomic model publication, forecast compatibility, capability presentation, non-blocking execution/capture integration and UI recovery. A's independent reviewer checks feature disabled, module absent, timeout/error, low-quality audio, stale result, partial capability availability and failure after prediction commit. In every case the core capture -> fit -> supported Astra action -> outcome/replay flow remains usable, and no false phonation conclusion is produced. These targeted checks are required before enabling the optional feature; they do not make its implementation a release blocker.

## Objective and interpretation

Estimate how the learner produces the glottal sound source, jointly with the vocal tract that filters it. Test whether changes in recorded sound support changes in source behavior, tract configuration, or both. A fixed-source model must not silently explain a source change as a change in anatomy.

Audio supports measurements of periodicity, harmonic structure and noise, and conditional estimates of glottal source behavior. It does not by itself confirm complete vocal-fold contact, gap location, collision pressure, tissue pathology or exact muscle activity. Breathy phonation can be intentional; the goal is the learner's desired sound and comfortable production, not maximal closure. Display acoustic measurements, inferred source parameters and unsupported anatomical claims separately.

Use wording such as “more breathy than your reference” or “the model supports a less abrupt closing pattern,” when supported. Do not label an audio-only result “your vocal folds are not closing.” Missing or unreliable evidence must yield unavailable/inconclusive feedback, not a closure score presented as fact.

## Accountable owners and deliverables

| Ticket | Accountable owner | Deliverable | Acceptance |
|---|---|---|---|
| PHON-01: measurement contract and DSP | A acoustic-measurement implementer; separate A scientific reviewer | Versioned phonation observations from original audio, with window timestamps, extractor/config version, units, quality flags and source hashes. Evaluate pitch/voicing, cepstral prominence, harmonic/noise measures and spectral tilt; retain only supported features. Any harmonic correction must identify its vocal-tract assumptions. | Same extractor handles observed and synthesized audio. Test noise, silence, clipping, high pitch and irregular signals; unsupported windows are explicit. |
| PHON-02: glottal source inference | A forward/inverse owners | Verify engine source controls and bounds; add a bounded source family or supported physical source parameters. Evaluate glottal inverse filtering as a conditional estimator. Separate shared anatomy from per-attempt phonation/articulation; preserve competing source/tract explanations. | Held-out synthesized source/tract variations traverse real fitting, with a fixed-source comparison and recorded failure cases. Unsupported controls are rejected, not simulated in explanatory text. |
| PHON-03: live coaching | A frontend/capture implementer; separate A interpretation reviewer | Show baseline-relative phonation trends and quality, goal-aware cues, before/after comparisons and retained unsuccessful attempts. Integrate actual measurements into the current coaching view. | Microphone -> canonical feature extraction -> visible feedback works; silence/low-quality signals suppress conclusions; no automatic instruction to squeeze or force closure. |
| PHON-04: active experiments and model updates | A orchestration/integration implementer, with A numerical owner | Astra receives source and tract hypotheses plus uncertainties, chooses a supported comfortable task, commits predictions before capture, and consumes the scored result to revise or retain hypotheses. | Two rounds consume newly recorded evidence, preserve model/decision lineage, and distinguish acoustic outcomes from inferred physiology. |
| PHON-05: independent validation | A evaluator independent of the implementation author | Compare audio estimates with paired reference measurements where available. Optional synchronized electroglottography (EGG) measures relative contact behavior; laryngeal imaging can assess closure patterns. | Report evidence source, agreement/error and missing reference data. EGG contact quotient is not treated as identical to airflow closed quotient. Physical validation is blocked until paired data exist; software work need not wait. |

A owns implementation, tests, documentation, integration fixes and release-ready delivery for PHON-01–05. Review independence means a different reviewer/evaluator within A, not a dependency on B. Existing general-purpose modules remain shared infrastructure; this feature assignment does not transfer ownership of unrelated B work.

### Contained implementation boundary

- Build additive phonation modules under A's ownership: the canonical phonation extractor, optional scientific adapter, bounded runtime integration, standalone coaching component and targeted tests. Reuse existing audio streams, original-media artifacts and session interfaces; do not create a second competing microphone owner or require a new iPhone capture format.
- A owns the minimal app/server registration and backward-compatible contract additions needed to connect those modules. Reuse existing extractors for existing descriptors and add one shared phonation extractor for observed and synthesized signals. Avoid changes to unrelated capture or coaching behavior.
- Before editing a shared file, A checks the current remote and records the integration touchpoint in its PR. Use isolated feature worktrees, one writer per file and small wiring patches. If another writer is actively changing that file, finish and test the additive modules first, then integrate against the landed version; do not overwrite their work or assign them a phonation task. The disabled baseline remains runnable throughout.
- Existing browser microphone access or already supported recordings are sufficient inputs for software implementation. New device acquisition, EGG, imaging and teacher/reference-data access are optional evidence upgrades, not B deliverables or software-release prerequisites. A records unavailable human/reference evidence honestly and owns any later arrangements.
- A prepares and verifies the complete feature PR and resolves its integration issues. Follow the repository's normal merge/release procedure, but do not introduce a phonation-specific B sign-off, review queue or implementation dependency.

## Shared observation and inference contract

Within this feature's A ownership, extend existing versioned contracts additively and preserve existing consumers rather than creating an unrelated analysis pipeline. Include:

- Observation/session/attempt IDs, original media hashes and synchronized window bounds.
- Measured descriptors and units; null plus reason when unavailable; processing/AGC/noise-suppression metadata where known.
- Vowel, pitch and level context; requested task versus measured execution. Do not interpret uncalibrated microphone level as absolute vocal loudness.
- Source-model family/version, parameter units/bounds, fitted versus fixed parameters and model IDs.
- Separate source and tract alternatives, fit discrepancies and uncertainty/identifiability limitations. Do not invent confidence percentages without calibration.
- Frozen predicted descriptors, later observed descriptors and score/update provenance.
- Optional reference measurement type, synchronization uncertainty and artifact IDs; absence never becomes an inferred reference label.

Initial tasks use repeated comfortable sustained vowels, matching pitch, microphone position and recording conditions as closely as practical. Establish each person's within-session variability before presenting small changes as meaningful. Additional phonation tasks require a supported engine action and reviewed cue; a named technique alone is not a known physiological intervention.

## Integration order and completion

1. A freezes feature definitions, source capabilities and the contract. Its measurement implementer develops extraction/quality handling while its scientific implementer develops source/tract inference using synthesized evidence.
2. A's frontend implementer connects measurement-only coaching with clear interpretation limits. Its scientific implementer connects supported source parameters to actual calibration fitting and prospective forecasts.
3. A's integration owner joins both in the existing Astra -> committed prediction -> recording -> score -> model update/replay loop. Cache or stream bounded numerical features; do not require a paid model call for every audio frame.
4. A's independent evaluator verifies the app flow and numerical/source semantics. Record implementation status, evidence source and scientific outcome independently. Full phonation integration is complete only when actual measurements reach both coaching and the fitter; independently verified partial capabilities may be enabled and labeled as such. The core harness can ship with all phonation capabilities disabled or unavailable.
5. A adds paired EGG/imaging validation when data are available. Do not mark exact closure detection validated from synthetic success or perceptual labels alone.

This work extends AUD-01, PHY-01, INV-01/FUSE-01, PRED-01, CUE-01 and ACT-01; it is not a separate unconnected demo. Unsupported physical claims remain explicit research questions.

## Scientific basis

- [ASHA instrumental assessment protocol](https://pubs.asha.org/doi/10.1044/2018_AJSLP-17-0009): complementary acoustic, aerodynamic and imaging assessments.
- [Comparison of inverse filtering methods for glottal closing characteristics](https://pubmed.ncbi.nlm.nih.gov/16478660/): conditional voice-source estimation from recorded speech.
- [Contact quotient versus closed quotient in singers](https://pubmed.ncbi.nlm.nih.gov/25510160/): contact and airflow-derived closed quotients must not be conflated.
- [Electroglottography update](https://pubmed.ncbi.nlm.nih.gov/30871855/): interpretation limits of contact-related measurements.
