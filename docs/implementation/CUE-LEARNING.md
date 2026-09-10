# Reviewed cues and independent learning evaluation

The Teaching & learning panel implements CUE-01/LEARN-01's browser workflow. Mount `CoachLearningPanel` with the active `videoStream` and `audioStream`; it owns an explicit recording controller and never records on open. It captures available streams locally. Media is persisted in IndexedDB; protocols, attempts and personal mnemonics are persisted in localStorage. Export metadata and download recordings for a portable backup. Browser storage is not archival storage.

## Usable loop

1. A real teacher/voice specialist reviews both displayed wordings for this learner. Enter their identity, role and review reference. No example ships with fabricated specialist approval; this local attestation is not credential verification.
2. Freeze target pitch, tolerance, vowel/level/posture context, single-note phrase, retention delay and exact cue wording. The digest covers this snapshot; creating another protocol preserves the old snapshot and attempts.
3. Compare fixed baseline and variant, recording each explicitly. Stop, describe sensations/effort/confidence, save a personal mnemonic and retain unsuccessful trials. Replay/download each recording; discomfort stops are retained and fail the trial.
4. Repeat each arm without its mnemonic, transfer to the declared phrase **on the same note**, then revisit after the frozen delay in a new page session for retention. Assistance and replay are hidden in these stages; selected stage persists across reload. This checks a narrowly defined pitch task, not arbitrary melodic phrase tracking.
5. Export all protocols, attempts, subjective reports and independent numerical scores. Earlier protocols remain in `protocolHistory` and can be re-evaluated from their saved attempts.

The independent evaluator does not consume an optimizer's success flag. It verifies the frozen digest, post-freeze capture, correct wording/context, actual recording references, voiced coverage and temporal prerequisites. It computes median absolute pitch error in cents against the frozen target. Failed and excluded attempts stay in comparison denominators. Retention is scored separately, after the latest earlier practice for that arm and at least the frozen delay; a new session is also required. Recorded PCM is decoded locally and sampled every 100 ms with the canonical pitch detector. References and pitches are producer-derived evidence, not externally authenticated measurements; the recording hash permits audit against downloaded media.

Sensations are explicitly subjective. They never overwrite anatomy. Movement agreement is `null`, not inferred from pitch. Local replay records use `singing-teacher/learning/1`. Export also includes `kit.records`, validated with the revision-6 `validateLearningRecord`: fixed/variant CueDefinitions, CueAttempts, actual verbal SensationReports and independently scored TransferEvaluations. All historical protocols are adapted, with omissions explicitly listed. Absent verbal reports are not invented; their optional ratings remain in local data. Model/prediction IDs and movement agreement remain null, supported engine variables remain empty, and no MotionObservation or ControlProfile is fabricated. Fitting and control-forecast adaptation remains a producer boundary. Interrupted in-progress or unfinalized attempts recover as retained failures after reload; no unreported sensation is exported as learner evidence.

## Acceptance evidence and remaining gates

- Build/type check and lint.
- Four focused tests cover review requirement, protocol tampering, missing/unvoiced/context-invalid evidence, failed-attempt denominator, cue-free assistance exclusion and delayed separate-session retention.
- Chrome smoke used a synthetic 220 Hz microphone stream through **actual MediaRecorder**, decode, independent scoring, persistence, replay and cue-free masking. Synthetic reviewer identity is fixture data only and was never added to the library.
- **Human acceptance remains open:** real specialist approval of the exact wordings, followed by actual learner prompted/recall/transfer and later retention recordings. No G7 learning-improvement claim is made from fixtures.
- **Scientific integration remains open:** supported movement-agreement scoring and cue selection from genuine prospective engine/control forecasts. Hidden muscle interpretations are not filled in to make the panel appear complete.

## Sources

Candidate wording is an experimental library requiring review, not a treatment prescription. ASHA describes voice facilitating techniques and the need for skilled assessment; it does not validate these precise mnemonics: https://www.asha.org/practice-portal/clinical-topics/voice-disorders/ . General comfortable-use/rest constraints are informed by NIDCD vocal care: https://www.nidcd.nih.gov/health/taking-care-your-voice . Cough maneuvers remain review-only and cannot be selected as drills.
