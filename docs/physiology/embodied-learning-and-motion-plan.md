# Embodied learning and dynamic physiology

Revision 6 addendum. The teacher must translate intended physical/acoustic changes into familiar actions, help the singer recognize their own sensations, and test whether they can reproduce and transfer the result. Initial mapping must capture movement and achievable control as well as static anatomy. These are integrated research and teaching capabilities, not a replacement for physiological inference.

## 1. A personalized action-to-physiology model

Maintain separate, linked estimates for shared anatomy, time-varying articulation, cue-conditioned motor control, acoustic response and reported sensation. Learn how this singer executes a familiar action in a specific pitch/vowel/level/posture context. A cue is a probabilistic input, not a command that sets a simulator parameter exactly.

The model should distinguish:

- Stable geometry and hypothesized physical limits.
- The comfortable movement envelope actually observed in a task.
- The subset the singer can intentionally reach and reproduce with a particular cue.
- Coordination, transition timing, repeatability and changes with practice.
- Sensor visibility, measurement uncertainty and competing physical explanations.

An unsuccessful attempt may reflect an unfamiliar cue, coordination, occlusion or sensor failure. It does not establish an anatomical restriction. An elicited gesture may succeed before voluntary recall succeeds. Track those separately. The maximum observed displacement is not the person's true physiological maximum, and new skill need not imply changing anatomical dimensions.

## 2. Familiar actions as motor-learning cues

Use an explicit loop: goal -> supported physical hypothesis -> familiar cue -> synchronized observation plus sensation report -> comparison with prediction -> feedback -> repeat -> fade cue -> transfer into singing. Explain the purpose of the experiment; do not deceive the singer about what the model knows.

| Candidate cue family | Intended experience or experiment | Interpretation and implementation rule |
|---|---|---|
| Gentle breath with hands over comfortable side-rib/back regions | Notice expansion and release; connect perceived movement with a sustained easy sound. | Self-touch and external motion are observations, not confirmation of particular oblique activation, diaphragm position or correct support. Avoid maximal inhalation instructions. |
| Cough as a familiar abdominal sensation | User-proposed reference for locating an experienced abdominal response. | Retain as a specialist-review candidate, not an automated default exercise or repeated drill. It does not establish the muscle coordination desired in singing. |
| Duck-like quack or a small bright sound | Explore a reproducible twang-like acoustic contrast. | Candidate mnemonic, not proof of a unique narrowing or nasal configuration. Match pitch/vowel/level where feasible and measure the response. |
| Gentle cry-like or plaintive imitation | Explore an accessible quality/coordination contrast. | Do not label success as measured laryngeal or thyroid-cartilage tilt. Hidden movement remains a hypothesis unless independently measured. |
| Comfortable “ah”, a yawn-like opening, tongue extension and return | Expose visible surfaces and sample movement trajectories. | Observe comfortable attempts, not forced maximum stretch. Yawning changes multiple structures; do not assume isolation of the palate. |

These examples form a reviewable research library, not a prescription. Clinical voice guidance describes yawn-sigh as a facilitating technique; this does not validate every proposed mnemonic or its anatomical explanation. Twang research reports acoustic/source differences but does not establish that a duck imitation uniquely identifies a hidden anatomical action. Sources and evidence levels belong to each cue. [ASHA voice guidance](https://www.asha.org/practice-portal/clinical-topics/voice-disorders/), [Sundberg and Thalén, What is Twang?](https://pubmed.ncbi.nlm.nih.gov/20083379/).

A singing teacher/voice specialist reviews the initial library and permissible variants. Keep coughing review-only, use comfortable attempts, and stop locally on pain, dizziness, strain or worsening voice. Do not encourage throat manipulation or put equipment inside the mouth. Vocal care guidance supports avoiding excessive vocal demands; this application does not diagnose respiratory or voice disorders. [NIDCD voice care](https://www.nidcd.nih.gov/health/taking-care-your-voice).

Astra selects and explains reviewed cues, adapts wording within their allowed variants, and asks what the learner felt. If the attempt fails, consider another cue, easier context or rest; do not merely repeat a technical anatomical instruction or demand more effort. New physical maneuvers need library review before runtime use.

## 3. Dynamic mapping with synchronized capture

Use repeated neutral -> comfortable gesture -> return trajectories. Begin with ordinary vowel changes, lip/jaw movement and comfortable tongue exposure. Add reviewed yawn-like and other contrasts where useful. Preserve task start/end, cue delivery, actual onset, returns, unsuccessful attempts, synchronization error and per-frame visibility.

CAP-01/02 records audio/RGB/depth throughout each trial. GEO-01/MOT-01 registers rigid head pose separately from articulation and estimates only supported visible trajectories. Do not rigidly fuse different tongue or palate poses into one static surface. The mouth can expose different surfaces across gestures, but hidden surfaces are not measured merely because a filled mesh looks complete.

For visible palate motion, track a repeatable visible region in a declared coordinate frame with confidence/occlusion flags. If a region cannot be identified consistently or depth is missing, do not output a millimeter range. Audio may constrain competing velopharyngeal-motion hypotheses, but does not make the inferred path a direct scan. Report observed excursion, repeat variability, cue dependence and confidence separately from hypothesized anatomical limits.

Breathing observations use a separate explicitly consented external torso view if needed; a face/mouth scan does not measure rib or abdominal motion. Separate views retain their own poses and trial identities. Self-reported back/side sensations do not require a torso video and remain useful as subjective feedback. The initial engine may not model respiratory mechanics: retain these observations and unsupported status without inventing muscle parameters.

## 4. Shared contracts and learning loop

Extend KIT-01 with the following versioned records. B owns schemas; A reviews physical semantics.

- CueDefinition: ID/version, wording and allowed variants, familiar action, intended hypothesis, supported engine variables, expected observables, evidence/source, review status, context, effort/rest/stop rules and alternatives.
- CueAttempt: cue/version, delivered wording, goal, model/prediction IDs, context, timestamps, repetition, capture references and execution deviations.
- SensationReport: learner's words and optional body-region selection, ease/effort, discomfort, confidence and whether the feeling is recognizable; explicitly subjective provenance.
- MotionObservation: trajectories, coordinate frame, visibility/quality, cue alignment, observed envelope and measurement uncertainty.
- ControlProfile: cue-conditioned reachable states, repeatability, transition timing, context dependence, learning history and competing explanations; distinct from anatomical parameters.
- TransferEvaluation: repeat without the full mnemonic, then use in a vowel/phrase or later session; acoustic error, supported movement agreement, effort and retention results.

A's motor model learns a distribution over executed articulation given cue, context and control history. PRED-01 marginalizes over that distribution for prospective forecasts. Post-capture measured movement can support a separately labeled conditional acoustic prediction; never rewrite a prospective forecast with outcomes. Update control, anatomy and subjective memory through separate evidence paths. A sensation report must not directly overwrite inferred anatomy.

B's teacher interface shows one actionable cue, an optional demonstration, what to notice, the learner's own remembered sensation, and predicted/observed differences. Display measured movement distinctly from hypothesized hidden motion. Let learners compare successful repetitions and save a personal mnemonic. Fade assistance and test transfer; immediate imitation alone is not learned control.

## 5. Ownership, dependencies and acceptance

| Ticket | Lead / exclusive owner | Acceptance evidence |
|---|---|---|
| CUE-01 reviewed cue library and teacher flow | B; experiment/cues/, apps/web/coach/, tests/cues/ | Versioned reviewed examples, alternatives and stop behavior; a learner can report sensation, replay an attempt and retrieve their own mnemonic. |
| MOT-01 dynamic control model | A; science/control/, tests/science/control/ | Known synthetic trajectories/control variation recover within declared limits; distinguish uncertainty, occlusion and unsuccessful execution from anatomy restriction. |
| MOT-02 dynamic measured capture/fusion | B capture; A geometry/inverse via existing owners | Repeated real gesture/return trial replays with alignment and visibility; actual visible trajectory affects fitting; hidden/missing geometry stays labeled. |
| LEARN-01 recall, transfer and retention evaluation | B independent evaluator; evaluation/learning/ | Compare cue variants against a reviewed fixed-cue baseline; freeze scoring/context; include failed trials and cue-free recall plus phrase transfer. Later-session retention is a separate result. |

CUE-01 library/contracts and synthetic MOT-01 design can start alongside foundation work. Executable MOT-01 depends on PHY-01 and trajectory contracts. MOT-02 depends on CAP-02, GEO-01 and the inverse interface. Teacher flow begins with genuine artifacts; integrated cue selection depends on PRED-01 and ACT-01. LEARN-01 protocol can be prepared early, but its claims require actual learner evidence.

Add acceptance gates G6 dynamic mapping and G7 embodied transfer. G6 demonstrates repeated observed motion, contextual control estimates and explicit missing-data uncertainty. G7 demonstrates one goal -> hypothesis -> reviewed cue -> measured attempt -> sensation -> repeat -> cue-free/phrase transfer cycle, scored independently. An unsuccessful trial still produces a valid research record, but does not pass a learning-improvement claim. Compare cue-aware versus cue-agnostic execution forecasts and learned versus fixed cue selection; physiological accuracy still needs independent anatomical evidence.

Implement these prototype loops now, alongside reconstruction. Population coaching efficacy and detailed muscle/tissue explanations remain later validation work. The unique aim is to learn both the person's physical sound-producing system and how they can intentionally control it, then connect that understanding to sensations and skills they can use.
