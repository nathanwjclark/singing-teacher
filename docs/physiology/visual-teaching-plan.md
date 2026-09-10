# Physiology-based illustrated coaching — workstream A

Approved scope addition, September 10, 2026. All VIS-TEACH tickets begin as planned. A owns the complete feature: scientific explanations, illustrations/animation, model adapters, coaching UI, audio comparison, accessibility, tests, independent review and integration. B has no new implementation, content-review or acceptance assignment. This feature-specific exception extends the existing embodied-learning plan without transferring unrelated modules or disrupting active file writers.

## Learner experience

Turn each supported suggestion into an intuitive sequence: **what to try -> what moves -> why sound may change -> hear/see the comparison -> try it -> compare the actual result**. Start with one short cue and an optional expandable demonstration in the coaching view. The visual explanation must be connected to the selected instruction and physiological hypothesis, not a decorative anatomy animation.

Provide labeled before/after illustrations, a slow scrub-able transition, arrows identifying the intended movement, and a relevant cutaway. Keep viewpoint and scale consistent; show source behavior separately from resonant-cavity changes. Let learners replay, pause or use a static comparison. Explain unfamiliar anatomy on first use. Pair each demonstration with an achievable comfortable action and what to notice; do not assume users can directly command a hidden cartilage or muscle.

When the current model supports the intervention, show its actual before/after geometry, acoustic predictions and optional synthesized sound, followed by the recorded attempt and measured differences. Where it does not, provide a clearly labeled general educational illustration. General illustrations remain useful but cannot be presented as personalized measurements or numerical predictions. State this distinction once in plain language beside the comparison; keep implementation details out of the learner flow.

## Initial demonstration library and scientific semantics

| Demonstration | What to show | Interpretation limits |
|---|---|---|
| Cricothyroid action and pitch | Relative thyroid/cricoid cartilage rotation or translation, changing vocal-fold attachment separation, elongation and tension/stiffness; contrast a schematic slower/faster vibration. | Distinguish cricothyroid motion from whole-larynx height or head tilt. Pitch depends on interacting length, stiffness, effective vibrating mass and pressure; do not teach that length alone raises pitch or that creating more cavity space makes the folds thinner. Thinning may accompany elongation, but is not an independently measured learner state. |
| Soft palate and resonance | A sagittal cutaway of the velum changing the opening between oral/pharyngeal and nasal pathways; compare cavity shape and coupling, with resonance/antiresonance effects where supported. | Raising the velum can reduce nasal coupling; it is not simply “more space means better resonance.” Results depend on vowel, source and the remaining tract. Do not equate brightness with nasality or assert a universal preferred palate position. A yawn-like cue changes multiple structures and does not isolate the palate. |
| Tongue, jaw and vowel shape | Actual supported tongue/jaw changes, resulting tract constrictions and predicted spectral-envelope/resonance changes. | Separate observed visible movement, inferred internal geometry and fixed template surfaces. Keep pitch/source conditions matched where the comparison is meant to isolate the tract. |
| Source versus filter | Vocal-fold excitation next to the tract's resonant filtering, allowing the learner to distinguish a pitch change from a timbre change. | Numeric curves and audio must come from a declared supported operator. Exaggerated slow motion and conceptual waves are labeled illustrations, not measured vibration or sound propagation. |

Cricothyroid and soft-palate demonstrations are explicit initial deliverables, even when only their educational mode is currently supportable. A audits engine capabilities before connecting personalized controls: current source research or oral-only probe operators must not be assumed to expose cartilage motion or nasal coupling. A may implement and verify an additional operator as a separately bounded task; a visual morph alone does not make that operator available.

## Owned tasks

| Ticket | A owner | Deliverable and acceptance |
|---|---|---|
| VIS-TEACH-01: explanation library | Scientific/content implementer, separate A reviewer | Versioned mechanism explanations, practical cue variants, initial demonstrations above, source citations and claim limits. Review anatomy, pitch versus resonance and comfort/stop behavior. No fabricated expert approval; external specialist validation, if sought, is arranged by A and recorded separately. |
| VIS-TEACH-02: illustrations and animation | Visual/frontend implementer | Reusable SVG/3D diagrams and deterministic rigs with before/after, scrub, pause, viewpoint labels and accessible static equivalents. Reuse existing anatomy assets when suitable, preserving attribution/licenses. Verify that highlighted parts and attachment movements agree with reviewed content. |
| VIS-TEACH-03: model-to-demonstration adapter | Scientific integration implementer | Map actual model/design IDs and supported intervention parameters to paired geometry, forecasts and available synthesis. Unsupported mechanisms return educational-only or unavailable, never fabricated personalized output. Pin parameter provenance, assumptions and source/tract controls. |
| VIS-TEACH-04: coaching orchestration and sound comparison | App/Astra integration implementer | Astra selects reviewed demonstration IDs and supported variants alongside its real cue. Deterministic validation prevents arbitrary hidden-structure commands. Connect cue -> visual -> optional predicted audio -> recording -> scored before/after -> explanation and sensation memory. Preserve forecast-before-capture identity. |
| VIS-TEACH-05: independent verification | Reviewer/tester separate from authors | Test real browser flow, model changes, unavailable operators, mismatched/stale results, audio provenance, reduced motion, keyboard controls, mobile layout and media failure. Demonstrate at least one supported personalized visual/acoustic loop and both named educational mechanisms. Record human comprehension/learning evaluation separately. |

## Evidence and rendering contract

Extend existing cue/design records additively. A owns new modules and minimal app/server wiring, using one writer per shared file and isolated worktrees. The contract includes demonstration ID/version, delivered cue, mechanism, evidence mode, sources/license, actual model/design/attempt IDs where applicable, baseline/target parameters, fitted/fixed/unsupported roles, geometry/forecast/audio hashes, units, quality and missing-data reasons. Existing recordings and cues without these fields continue to work.

Three visible evidence modes are required:

- **General explanation:** reviewed anatomy/mechanism illustration, not the learner's measured anatomy. No arbitrary numerical improvement or personalized simulated voice.
- **Your model's prediction:** actual current candidate geometry and a supported intervention, including alternatives/uncertainty where material. It is a hypothesis, not a scan of hidden tissue or proof of achievable movement.
- **Your recorded result:** actual attempt and compatible measured differences. Audio can support an acoustic change without confirming the illustrated hidden movement occurred.

Compare like quantities: a tract transfer/resonance curve is not a microphone spectrum. Use the same feature extractor for predicted and observed descriptors. Declare controlled pitch, vowel and level assumptions, and disclose when they differ. Audio A/B playback is explicit, never autoplay; any loudness normalization is disclosed and never alters stored measurements or loudness outcomes. Simulated audio is identified as model synthesis, not the user's future voice.

Before an attempt, use the frozen forecast for visuals and predictions. Afterward, show observed discrepancies without rewriting that forecast. Scrubbing a hypothetical illustration does not update anatomy, mark a gesture successful or issue a new experiment; a new target requires a new supported committed design. Historical geometry/recordings remain dated and model-bound when the session advances.

## Integration and graceful degradation

1. A designs the reviewed educational mechanisms and a small reusable visual component in parallel with auditing actual model capabilities. No new capture hardware is required for educational delivery.
2. Connect one already supported model intervention end to end before expanding the library. Separately deliver the cricothyroid and palate educational views without inventing support in the personalized engine.
3. Place demonstrations beside the current coaching suggestion; use a concise practical cue, mechanism explanation, expected observation and attempt comparison. Connect supported outcomes to existing sensations and repeat/recall workflows rather than creating another session ledger.
4. Load optional heavy visual/audio assets on demand. Missing assets, unsupported source/nasal models, rendering errors or synthesis timeouts retain the text cue and existing capture/coaching path. Offer static illustration or text when animation is unavailable; never substitute an unrelated animation as a personalized result.
5. Independently gate educational visuals, personalized geometry, numerical acoustic comparison and synthesis. An unavailable advanced mode does not block the app or core release. Record each mode's implementation status and evidence; general educational delivery alone is not completion of personalized model-driven teaching.

Human evaluation asks whether the learner understands the suggested change and can try/reproduce it, retaining failed attempts and effort reports. Software acceptance does not require a positive learning effect, but no learning-efficacy or internal-motion validation claim is made without suitable evidence. Avoid forceful throat manipulation or instructions to push through discomfort; illustrations explain coordination rather than inviting manual adjustment of cartilage.

## Scientific references

- [Biomechanical model of laryngeal pitch and glottal-width control](https://pubmed.ncbi.nlm.nih.gov/8969481/)
- [Cricothyroid joint anatomy and vocal-fold elongation](https://pubmed.ncbi.nlm.nih.gov/20971613/): mechanism evidence; surgical findings are not a singing exercise prescription.
- [UNSW voice acoustics](https://www.phys.unsw.edu.au/jw/voice.html): source/filter distinction and oral/nasal coupling.
- [Existing embodied learning plan](embodied-learning-and-motion-plan.md)
- [Optional phonation plan](phonation-and-closure-plan.md)
