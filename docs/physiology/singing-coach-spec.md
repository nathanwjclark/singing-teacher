# Personal Vocal Physiology and Acoustics

**Moonshot implementation specification - revision 7, September 10, 2026.**

## 1. Research objective and change of direction

Build a system that attempts to infer a person's internal vocal anatomy, dynamic articulation, and eventually vocal-fold mechanics from ordinary audiovisual observations plus actively selected vocal experiments. The resulting personal physical model must generate sound, explain multiple observations with shared anatomy, and predict the consequences of interventions. Singing coaching is the downstream application of that model.

This plan supersedes the current remote repository architecture and scope; existing code is optional reusable material. Revision 7 integrates active acoustic probing into acquisition, external-drive physics, joint inference and runtime Astra teaching, retaining embodied cues and dynamic control mapping. It retains the integrated iPhone depth work and physiological reconstruction objective.

This revision supersedes the earlier recommendation to make empirical cue personalization the main product. Failure to recover physiology is an acceptable research outcome. A cue recommendation engine is not a substitute deliverable. Scientific uncertainty determines what we test and how we interpret the result; it does not remove the moonshot from scope.

The core hypothesis is: **a physically constrained model, personalized across multiple tasks and updated through informative interventions, can recover physiologically meaningful individual parameters more accurately than passive observation or a generic anatomical prior.** The full ambition remains internal geometry and tissue mechanics. The first experiment estimates a tractable subset with an extensible physical representation, rather than asserting every internal property is identifiable immediately.

The statement that complete reconstruction is not established belongs in the research motivation. It is neither a veto nor proof of novelty. Prior work jointly estimates anatomy and articulation using VocalTractLab. In that work, validation against directly measured anatomical parameters remained future work. Our proposed contribution is active, multimodal, individual reconstruction with independent tests of anatomy and intervention prediction.[^joint-anatomy]

| Earlier plan | Revised plan |
|---|---|
| Primary output: which cue helps this singer | Primary output: executable personal physiological acoustic model with uncertainty |
| Simulator illustrates a possible explanation | Simulator generates predictions and participates in parameter inference |
| Camera optional to the central experiment | Camera is an experimental information source, tested against an audio-only condition |
| Anatomy deferred outside the hackathon | Anatomy inference is the hackathon's critical path |
| Success means better practice performance | Success means evidence of parameter recovery and prospective physical prediction |
| Coaching interface gets most engineering time | Forward physics, inverse fitting and experiment design get most engineering time |

**Working assumptions:** two human leads, each coordinating parallel Astra agents, with local development hardware and the available iPhones. Work is ordered by dependencies and acceptance evidence; no hackathon duration or delivery estimates are assumed.

## 2. What counts as progress, success and failure

Separate four levels of evidence. Publish all completed levels, including negative results, without relabeling a lower level as a higher one.

| Level | Experiment | What it establishes |
|---|---|---|
| A: recovery in simulation | Hide known parameters, generate diverse observations, infer them, and score recovery on held-out synthetic people. | Implementation correctness and identifiability within that simulator. |
| B: human prediction | Fit calibration trials, freeze a prediction, then acquire an unseen intervention recording. | Out-of-sample acoustic prediction for that person; not anatomical truth. |
| C: independent physiology | Compare hidden-state predictions with withheld, modality-appropriate measurements from that person. | Evidence for the specific anatomical or physiological variables measured. |
| D: coaching benefit | Use the inferred model to choose interventions and test retained learning on new material. | Downstream educational value; not a replacement for A-C. |

The minimum meaningful hackathon build runs A and attempts B with genuine physiology parameters, a working forward simulator, multiple candidate solutions, and a reproducible log. Attempt C during the hackathon only if suitable paired data and permission are already available. Otherwise report C as untested. A failed live fit, non-identifiable parameters, or no gain from active experiments is a valid outcome; a polished coaching demo does not repair that result.

Pre-register two primary comparisons before human evaluation: personalized shared anatomy versus fixed generic anatomy with equally flexible articulation; and active experiment selection versus a fixed protocol under the same recording and computation budgets. Also test audio-only versus audiovisual inference. A population acoustic predictor is a useful additional baseline. Do not let the personalized model win simply by giving it more per-recording free parameters.

Novelty is a research hypothesis, not a claim that no related system exists. A 2026 study predicts MRI-derived contours from a single speaker's speech; that differs from inferring unseen singers' full 3D geometry and mechanics from consumer capture. It is a useful benchmark direction, not proof of the proposed capability.[^mri-inversion]

## 3. Physical model and parameter hierarchy

Represent the person as a generative physical system, not an unconstrained voice embedding. The model should expose geometry, articulatory state, excitation and capture effects separately. All stored parameters have names, units, bounds, provenance, and an interpretation tied to the equations or simulator.

```text
Shared anatomy theta + tissue parameters phi
                 |
Task / intervention u -> dynamic articulation z(t)
                 |              |
                 +--> coupled source and tract solver --> sound
                                |                          |
                         visible surface model       room / microphone
                                |                          |
                           predicted video            predicted audio

Observed video + audio -> inverse solver -> candidate personal models
                                      -> uncertainty / model mismatch
                                      -> next discriminating experiment
```

**Shared anatomy, theta.** Parameterized oral/pharyngeal shape, palate/jaw/tongue morphology, tract lengths, lip dimensions, and nasal geometry where supported. These variables are shared across recordings of a person. They do not change merely because the vowel, microphone, or instruction changes. Soft-tissue pose belongs in dynamic articulation; long-term anatomical changes are outside the first study.

**Dynamic articulation, z(t).** Jaw position, lip aperture/protrusion, tongue configuration, larynx position and velopharyngeal aperture. These vary through a phrase under feasible motion constraints. A requested action is not an exact observation of z(t): the singer can misunderstand or compensate. Visible behavior constrains only what the camera actually observes.

**Tissue mechanics, phi, and activation.** The target includes vocal-fold geometry, effective mass, stiffness and damping, with activation and driving pressure distinguished from passive properties. A kinematic glottal waveform is an initial excitation model, not a measurement of these quantities. Add a supported self-oscillating model as an explicit mechanics experiment; do not rename pulse-shape controls as tissue stiffness.

**Capture and nuisance variables, eta.** Microphone response, gain, room, pose, timing offsets and session state. Constrain these by calibration and repeated capture. Do not let an arbitrary per-trial equalizer absorb every physiological mismatch. Uncalibrated digital amplitude is not absolute pressure or airflow.

### First parameter budget and path to full geometry

Begin with a proposed 6-10 global anatomical degrees of freedom and a small set of pose/source variables per sustained segment. Select the exact subset after examining the simulator and testing sensitivity; do not promise a specific parameter exists in an upstream API. Candidate global dimensions include supported oral/pharyngeal lengths, palate dimensions, lip width, and a nasal dimension only if independently represented. All unestimated properties remain explicit prior assumptions, not recovered anatomy.

The first model is an actual anatomical hypothesis even if low dimensional. Every view and result names the estimated subset. Increase model richness to a deformable 3D anatomical mesh, branched airway acoustics, and coupled mechanics as recovery tests justify doing so. More mesh vertices are not inherently more information. A tube area function alone does not determine a unique 3D cross-section; if the renderer uses circular sections or a template, record that assumption.

For mechanics, start by testing which parameter combinations are distinguishable. For example, oscillation frequency can constrain a stiffness-to-mass relationship without uniquely determining both quantities. If multiple mass/stiffness/pressure combinations explain all available observations, retain them. More recordings cannot resolve a symmetry that every experiment preserves.

Nonlinear source-filter interaction is relevant to phonation, so the long-term system must test a coupled physical model rather than equating filtered audio with complete physiology. High singing pitches also sample resonances sparsely; uncertain spectral peaks should not become exact formant targets.[^source-filter][^high-f0]

## 4. Forward simulator is the critical dependency

**Use VocalTractLab as the first integration target.** It provides an articulatory forward model and native backend. Pin a tested release or commit and speaker asset hashes. The development repository explicitly warns that it includes experimental changes. Build its tests, render a known example, and inspect parameter capabilities before writing the inverse solver.[^vtl]

The documented C interface supports speaker initialization, parameter metadata, tract-to-tube conversion, contour export, and synthesis. Use these to build a narrow adapter. Global morphology changes may require speaker configuration or deeper native integration; they are not interchangeable with frame-level tract controls. Run isolated simulator workers so mutable synthesis state is not shared between candidates.[^vtl-api]

Create a machine-readable capability manifest: parameter name, unit, anatomical versus pose versus source class, valid bounds, update method, reset requirements, and whether the parameter changes audio, visible geometry, or both. Test each supported control with perturbations. A successful API call is not proof that the control has the intended physical effect.

Nostril occlusion is a special integration gate. Changing velum aperture is not equivalent to blocking the nostril outlet. Inspect and test whether the chosen solver can represent the nasal branch and its outlet impedance. If not, implement and validate that physical boundary condition before using occlusion data in inference. Exclude unsupported trials from the model likelihood; mark them unmodeled rather than silently substituting another control.

A smaller independently implemented branched tube model is a contingency if VTL integration fails. It must conserve the intended flow/pressure relations, pass simple closed/open-boundary and resonance tests, and expose its restricted assumptions. It still attempts inverse physics; replacing it with a cue lookup table is not an acceptable fallback. Record engine substitution prominently because it changes the scientific scope.

Do not assume the native simulator is differentiable. Start with bounded sampling and derivative-free optimization. Later train a differentiable surrogate on simulator outputs for acceleration, always checking selected solutions against the original solver. A surrogate's confident prediction outside its training region is not physical evidence.

## 5. Inverse fitting and uncertainty

The ideal target is a joint posterior over anatomy, mechanics, articulation and nuisance variables conditioned on all calibration observations and intervention records. The hackathon implementation approximates it with diverse bounded candidates and explicit fit diagnostics. Optimization restarts alone do not constitute calibrated Bayesian uncertainty.

```text
For each proposed anatomy theta and mechanics setting phi:
  fit bounded articulation / source / capture variables to calibration data
  simulate the same recordings with shared theta and phi
  score acoustic fit, visible fit, motion constraints and prior plausibility
  keep diverse good explanations, including correlated parameter alternatives

Choose a new experiment using the surviving explanations
Commit predicted outcomes before acquiring its evaluated recording
Score outcome; update the model only after prospective scoring
```

Use joint acoustic and visual residuals with quality-dependent weights. Acoustic features include harmonic magnitudes, robust spectral summaries, F0 and task timing; use reliable resonance estimates where available. Compare rendered audio at multiple time/frequency resolutions rather than relying on one formant extractor. Scale losses by estimated noise and feature correlation; thousands of correlated frames do not imply thousands of independent anatomical measurements.

For image evidence, fit camera pose and scale explicitly. Without a known reference or independently calibrated geometry, metric dimensions may remain ambiguous. MediaPipe landmarks are useful relative observations, not a direct metric scan. Reprojection must use an actual mapping between model surface points and observed landmarks; missing hidden correspondences contribute no fabricated observations.[^mediapipe]

Initialize with bounded space-filling samples, then refine several distinct candidates. A first compute target is 256 global samples and 8-16 refinement starts, subject to measured runtime; record the actual budget and convergence. Fit a few stable segments first, add trajectories later. Cache immutable simulations by parameter/configuration hash. Do not silently discard candidates just because a job timed out.

Maintain separate outputs for acoustic residual, visual residual, prior penalty and constraint violation. A good total score can conceal a poor acoustic fit if the prior dominates. Repeat fitting under wider plausible priors, different starts, and altered noise assumptions. Report candidate spread as an approximation until synthetic coverage tests justify probability intervals.

Test local parameter sensitivity using finite differences and inspect nearly dependent response directions. Use profile fits to search for materially different anatomy with almost the same score. Local sensitivity is not a proof of global identifiability; explicit alternative solutions and held-out interventions are essential.

Include a model-mismatch state. If every candidate fails, broaden the physical family or revise the measurement model. Do not force a best candidate to masquerade as a successful reconstruction. A flexible learned residual may improve audio reproduction while destroying anatomical interpretability; compare fits with and without it, bound its capacity, and keep it out of the initial claim.

## 6. Active physiological experiments

Astra's job is to identify competing physical explanations and propose the next safe, feasible experiment. Numerical simulation supplies predicted observables and disagreement. The planner chooses from validated actions rather than inventing numerical anatomy or treating verbal instructions as perfectly executed motor commands.

The principled objective is expected information gained about shared anatomy/mechanics, marginalized over uncertain articulation and capture, minus participant effort and execution cost. In the prototype, use noise-normalized predictive disagreement among candidate models as a heuristic and label it accordingly. Large disagreement caused solely by uncertain task execution is not useful anatomical information.

| Candidate experiment | Intended constraint | Main ambiguity / control |
|---|---|---|
| Matched vowels at comfortable pitches | Different shapes must share one underlying anatomy. | Tongue and source may both change; use visible motion and repeats. |
| Visible change in lip opening or rounding | Constrain the downstream opening and test predicted spectral changes. | Jaw and tongue can compensate; record actual visible movement. |
| A gentle pitch change on the same vowel | Sample the response at different harmonics. | Tract configuration may change with pitch; do not assume it is constant. |
| Teacher-reviewed nasal contrast or brief occlusion task | Probe coupling or a modeled outlet boundary. | Outlet occlusion is not velum closure; sound and behavior may both change. |
| Normal-view front/profile capture | Constrain visible surface morphology and movement. | Camera calibration and scale are uncertain; hidden geometry remains inferred. |

This table defines research candidates, not a self-administered exercise prescription. Use comfortable ordinary phonation and a reviewed protocol with a consenting adult. An occlusion task enters the study only after teacher/voice-specialist review and verification of the solver boundary condition. Do not ask participants to insert devices into their mouths, force high notes, or continue through pain or worsening voice. Stop works locally.[^nidcd]

The nasal branch is scientifically motivated: singing studies have combined airflow, imaging and acoustic modeling, and recent speech inversion research uses nasalance information. Neither establishes that a single phone recording measures the connection's exact shape. We will test whether repeated interventions reduce the relevant ambiguity.[^nasal-study][^nasality-inversion]

### The intervention execution problem

Define two different prediction tasks. A **prospective task prediction** integrates over how the person may execute a cue, using only information available before recording. A **conditional acoustic prediction** may use measured post-intervention visible movement but must freeze anatomy and exclude that trial's acoustic features from fitting. Report them separately. Fitting the held-out sound's articulators to that same sound is reconstruction, not prospective prediction.

Every action record includes an intended manipulation, permissible variation, expected visible compliance, task/pitch/level context, repetitions, rest/stop rules and a predicted observable distribution. Use matched repeat trials and counterbalanced order where feasible. Manual protocol notes can report deviations. Acquire independent baseline repeats to estimate noise before declaring a small spectral change informative.

### Embodied cues and dynamic mapping

The teacher must translate physical hypotheses into familiar actions that a singer can discover, feel, recall and transfer into singing. Examples include a reviewed duck-like sound for a twang-like contrast, a gentle plaintive imitation, noticing comfortable side-rib/back movement, and ordinary vowel/yawn-like/tongue gestures during mapping. These are candidate ways to elicit behavior, not commands that guarantee a specific hidden movement. Yawn-sigh has a clinical facilitating role; neither that precedent nor acoustic twang findings validates every mnemonic or a one-to-one anatomical interpretation.[^embodied-asha][^twang]

The complete [embodied learning and motion addendum](embodied-learning-and-motion-plan.md), also included in the PDF, defines cue review, learner sensation reports, dynamic capture, motor-control inference and transfer testing. Coughing is retained as a specialist-review candidate rather than an automated exercise; comfortable attempts replace forced maximal inhalation or tongue extension. Self-touch does not verify individual muscle activation, and a cry-like sound does not prove measured laryngeal tilt.[^nidcd]

Extend the physical hierarchy with a separate cue-conditioned control profile: observed comfortable envelope, repeatability, timing, context and voluntary recall. Stable anatomy, current articulation, learned control and subjective sensations remain distinct. Never infer an anatomical limit from one failed cue. PRED-01 integrates uncertainty about cue execution; actual measured movement belongs only in separately labeled conditional predictions after capture.

During mapping, record neutral-to-gesture-to-return trajectories with synchronized RGB/depth/audio, head-pose registration and per-frame visibility. Visible soft-palate motion can be estimated only when consistently observed and calibrated; missing depth is not a zero excursion. Report observed movement rather than claiming full physiological range. Multiple moving poses must not be fused as a rigid static cavity. Hidden movement remains an inference target with explicit uncertainty.

Add CUE-01 (B: reviewed cue library and embodied teaching), MOT-01 (A: motor-control model), MOT-02 (B capture/A fusion: dynamic mapping) and LEARN-01 (B: independent recall/transfer evaluation). These extend the prototype now. Later coaching-efficacy studies remain separate from demonstrating a working teaching loop. Acceptance adds G6 repeated dynamic mapping and G7 a measured goal -> cue -> sensation -> recall -> phrase-transfer cycle; synthetic runs cannot establish human learning.

### Active acoustic probing in the app

The [active acoustic probing plan](active-acoustic-probing-plan.md) is part of initial implementation and the PDF. Add a native Acoustic mapping flow that plays a known level-bounded signal from a phone outside the mouth, records its response, associates visible pose/calibration and uses supported response measurements in joint anatomy fitting. One phone is the first end-to-end path; a second external receiver near the nose is optional and requires clock/leakage modeling. No phone or speaker is inserted into the mouth or nose.

External broadband probing at the lips is an established resonance-measurement technique, but phone implementation and anatomical reconstruction remain unvalidated. Acoustic reflectometry's area-distance estimates are model-dependent, and nasal branching complicates interpretation.[^active-probe][^active-reflectometry][^active-nasal]

A owns the external-drive acoustic operator and joint inverse/service integration; B owns native playback/capture, response extraction, public contracts, independent scoring and runtime Astra/UI. This is distinct from the existing glottis-to-mouth transfer function and singing PCM feature extractor. Preserve exact drive/received bytes, device/placement calibration, timing uncertainty, response masks and nuisance parameters. Measurements progress from captured to response-usable to included-in-fit with explicit reasons. Unsupported channels never fabricate topology.

PROBE-01 through PROBE-06 have module owners, prerequisites and delivery checks in the addendum. G8 requires real probe data influencing the shared model through a supported operator; G9 requires Astra selecting a supported probe/gesture, committing its forecast and adapting after scoring. Build these capabilities directly with normal acceptance checks; no separate exploratory project is a prerequisite. One-phone integration proceeds independently of two-phone nasal capability.

## 7. Learning a population prior from video and other data

The proposed population model learns relationships among physical parameters, visible articulation and sound, then initializes individual inference. Train it explicitly; merely placing examples in Astra's context does not update a persistent model's weights. Astra can help specify features, critique failure cases and propose experiments, while dedicated audio/vision models and the physics solver provide observations and numerical inference.

**Synthetic physics data first.** Sample multiple plausible anatomical templates, articulation trajectories, source settings and capture conditions. Store exact generating parameters, solver version and parameter coverage. This provides labeled inverse problems immediately. It also imports the simulator's biases; success on the same generator only verifies that model family.

**Instrumented audiovisual data next.** Seek paired audio and modality-specific MRI, ultrasound, EMA or other measured articulation with compatible reuse permissions. Use each measurement only for the variables it can validate. Ordinary speech differs from singing, and data acquired in a scanner may differ from natural performance. Do not assert that a convenient dataset contains singing, 3D anatomy, tissue mechanics and aligned face video unless verified.

**Permitted singer videos as weak supervision.** Prioritize synchronized, unprocessed solo demonstrations, especially repeated changes within one singer. Extract lip aperture/rounding, head pose, visible jaw motion, timing and acoustic features. Audiovisual inversion research supports the usefulness of facial movement; this does not prove external nose dimensions identify internal nasal geometry.[^av-inversion]

Static facial proportions are candidate features, not assumed anatomical truth. Test their incremental benefit beyond dynamic landmarks and audio. Hold out singers, channels and sessions; identity, language, style, microphone and processing can otherwise masquerade as anatomical relationships. Audio/video mismatch, dubbing, accompaniment and enhancement require quality flags. Source separation artifacts are additional uncertainty, not clean physiological evidence.

Internet video alone supplies no ground-truth hidden anatomy. A network trained only for audiovisual reconstruction can learn useful associations without discovering correct internal structure. Anchor it with physical constraints and independent measurements, and compare to audio-only and shuffled/static-feature controls. Never treat Astra-generated anatomical labels as independent ground truth.

For the first implementation, skip large-scale internet collection and training. Use a generic physics prior, generate a bounded synthetic bank, and run live individual fitting. This keeps personal anatomy inference central. Population training is the next acceleration/generalization phase, with a manifest documenting permission, model/data terms and permitted redistribution for every asset.

## 8. Application architecture and Astra tools

```text
Native iPhone RGB / depth / audio capture + web display
          |
          v
Timestamped evidence bundle + consent + task execution record
          |
          v
Python analysis -> inverse solver -> isolated VTL native workers
                         |                    |
                         v                    v
                  candidate model store <- simulation cache
                         |
                         v
               numerical experiment evaluator
                         |
                         v
               Astra hypothesis / action planner
                         |
                 validated experiment proposal
                         |
           committed prediction -> next capture -> evaluation
```

Use AudioWorklet for bounded capture and a Worker for analysis; server fitting is asynchronous. Preserve original capture settings and timestamps, disable enhancement where supported, detect clipping/noise/dropouts, and recalibrate after device changes. Local pitch/quality feedback remains useful instrumentation, not the primary result. A few stable vowel segments are enough to exercise the inference pipeline; a full lesson UI is unnecessary.[^audio-worklet][^capture]

Expose typed tools: `inspect_evidence`, `fit_person_model`, `compare_candidate_models`, `simulate_experiment`, `rank_experiments`, `commit_prediction`, and `explain_result`. Each response includes evidence IDs, model version, numerical diagnostics, units and invalidity reasons. The host validates proposals and runs the actual software. Astra cannot overwrite measurements or promote uncertainty labels by narration.

The currently documented Astra API accepts text and images rather than native audio/video. Give it structured measurements, selected frames and plots, while specialized tools analyze audio and sequences. This is a real integration constraint, not a change in the moonshot. Benchmark the full system against fixed and simpler planners to test whether Astra improves experiment efficiency; exclusivity is not assumed.[^astra]

Prototype stack: native Swift iPhone capture companion plus React/TypeScript/Vite display client; Python analysis and inverse service; native simulator adapter; SQLite plus local artifact files for a supervised single-user experiment. Production adds authenticated Postgres, explicit media retention, isolated job queues and object storage. No API key in the client. Log solver and model versions, seeds, action budgets and failures so another team can reproduce the inference.

Proposed performance budgets: local capture feedback under 150 ms p95 on the chosen device; first inverse update within 30-120 seconds for short segments on measured hardware; next-trial planning after numerical results. These are targets to benchmark, not guarantees. Cache and background refinement can improve interaction. Do not put a full anatomical optimization inside the audio callback or promise real-time tissue reconstruction.

### Integrated iPhone capture and depth workstream

**Acquisition owner: Person B. Scientific fusion owner: Person A. Repository integration owner: Person B.** B owns microphone, RGB and depth together, including timestamps, calibration, quality, native deployment and export. A owns the joint observation model, depth projection, visibility masking and how these measurements constrain anatomy. Both review the interface and acceptance results. This is part of the main build, not an unassigned future extension.

Available devices are an iPhone 13 Pro Max and iPhone 15 Pro; both provide front TrueDepth and rear LiDAR. Start by testing the 15 Pro front TrueDepth and microphone together, then compare the other device and rear mode on the same targets. Capture format availability is checked at runtime. Use a Mac for compute/display. Do not assume front and rear depth can run concurrently.[^iphone-depth]

B builds a native Swift capture companion. Use supported AVFoundation video/depth/audio outputs and time-matched delivery, preserve source timestamps and verify alignment. If an ARKit capture mode is used, explicitly align its timestamps to audio. A web camera feed is not a substitute for the depth and calibration payload. The first integration uses a short recorded bundle; network streaming follows after correctness.[^depth-sync]

Define a versioned ObservationBundle together before independent implementation: trial and prediction IDs, audio samples/timestamps, RGB frames/timestamps, depth samples with their own timestamps, depth/disparity representation and units, intrinsics and alignment transforms, capture settings, confidence/validity, dropped frames, filtering flags and artifact hashes. Files may be separate, but share a manifest and timebase. Network arrival time is not capture time. A consumes all modalities jointly, not unrelated summaries.

Depth directly constrains only visible surfaces. Benchmark known-size and cavity-like bench objects before close-range human capture. Measure bias, repeatability, missing samples and alignment error. Test visible face/mouth surfaces without assuming that a rendered face mesh measures the oral interior. Hidden nasal/throat structures remain physiological inference targets. Do not fill depth holes and call them measured anatomy; preserve less-filtered data where supported.[^depth-filter]

### Depth milestones and acceptance ownership

| Ticket | Owner | Acceptance evidence |
|---|---|---|
| CAP-01 | B; A reviews schema | App deployed to a phone; actual available formats logged; short RGB/depth/audio capture or precise blocker recorded. |
| CAP-02 | B | Exported bundle replays with timestamps, calibration, missing-data flags and measured synchronization error; bench-target quality report. |
| FUSE-01 | A; B supplies bundle and test | One real bundle enters the inverse pipeline; audio, RGB and valid depth influence the fit; missing depth is handled explicitly. |
| DEPTH-01 | A numerical forecasts; B execution/evaluation | Prediction frozen before acquisition, followed by scoring and then update; repeat capture uses the same contract. |
| DEPTH-02 | B runs evaluator; A reviews fits | Audio-only, audio+RGB and audio+RGB+depth compared under equal budgets; effect on prediction/recovery reported, including null results. |

At each capture and integration gate, both people run the shared artifact through their side of the interface. Exchange exact commit, command, contract version, tests and blockers. If native deployment fails, B assigns a bounded diagnosis task and maintains synchronized browser RGB/audio as the working capture path. Depth stays explicitly unfinished; it is not silently replaced with landmark depth. A continues synthetic inverse-physics work while B resolves capture. Reduce visual polish before dropping these integration checkpoints.

Person B's additional native work is offset by keeping the interface minimal. Person A takes numerical calibration checks and depth residual implementation. Simultaneous two-phone capture is an extension after one-phone synchronization works, because it adds clock drift and spatial registration. Static scans and dynamic singing remain distinct observations, not one rigid reconstruction.

## 9. Data contracts, visualizations and reliability

| Record | Required content |
|---|---|
| EvidenceBundle | Participant/session IDs; consent scope; device/settings; timestamps; raw-asset hashes; features and units; quality/missingness; camera calibration; task execution; synchronized depth and its validity/calibration metadata. |
| ParameterManifest | Physical meaning; units/bounds; global versus dynamic role; simulator mapping; measured/inferred/fixed status; supported manipulation. |
| PersonModelVersion | Parent version; all fit evidence IDs; global candidate parameters; dynamic states; nuisance fit; residuals; priors; solver/config hashes; uncertainty method and mismatch flag. |
| ExperimentSpec | Intended intervention; feasibility/review status; target context; allowed variation; expected compliance observations; stop rules; selection rationale. |
| PredictionCommit | Immutable model/evidence IDs; action; predicted observables and uncertainty; scoring rule; time; evaluation mode; hash committed before capture. |
| EvaluationRecord | Actual execution; prediction ID; eligible observations; per-metric errors; exclusions; baseline comparison; no post-outcome edits to prediction. |

Implement a state machine: calibration -> fit -> proposed -> committed -> capture -> score -> update. Recording before commitment is unpredicted data and cannot enter prospective scoring. Missing or poorly executed trials remain counted with reasons; they are not silently dropped from the denominator. Reject stale results after stop, consent changes or model revision. Cancel or quarantine pending jobs; retries must be idempotent.

Display an actual parameterized anatomical hypothesis, rendered from the same configuration used for acoustic simulation. Offer a sagittal view, 3D geometry where available, predicted versus observed spectra, and a comparison of competing configurations. Color distinguish visible measurements, inferred geometry and fixed prior assumptions. If two internal shapes explain the data, show both instead of smoothing them into one unsupported scan.

Let the user select a parameter and hear/see a simulated perturbation while keeping its hypothesis status clear. If the renderer only uses an area-function mesh, say how cross-sectional shape was assumed. Never produce an independently generated anatomical illustration and imply it is the fitted solver geometry.

Raw media stays local by default in the hackathon. Obtain separate consent for server transfer, retention and research reuse when needed. Treat inferred physiology as sensitive personal data. Revoke access and delete raw and derived artifacts together when requested; account for queued jobs and backups in production. Images, lyrics and retrieved materials are untrusted data, not instructions to the planner.

## 10. Open-source components and licensing

This project will be open source. Select components primarily for scientific suitability, accuracy and integration effort; GPL and AGPL components are eligible. Recommend AGPL-3.0 for original networked application code if hosted modifications should remain available to users, or GPL-3.0 if redistribution reciprocity is sufficient. Finalize the exact license identifier and notices at implementation kickoff. Model weights, datasets, inherited source and visual/audio assets need separate provenance records.[^gnu]

GPLv3 and AGPLv3 explicitly permit combinations under their Section 13 provisions while preserving the licenses of the respective parts; the AGPL network-source requirements apply to the combination. Apache-2.0 is compatible with GPLv3. This does not permit relabeling all third-party code or removing separate data/model restrictions. Open-source licenses allow commercial use; a noncommercial restriction is a different category.[^gnu]

| Component | Role | License / recommendation |
|---|---|---|
| Pitchy | Browser F0 and clarity; clean monophonic baseline/fallback. | Actual LICENSE is 0BSD. Start here; benchmark on intended singing and devices.[^pitchy] |
| librosa | Python phrase DSP, spectral features, alignment and evaluation. | ISC. Use outside the real-time render callback.[^librosa] |
| SwiftF0 | Compact ONNX pitch estimator; browser/WASM candidate. | MIT repository and bundled model. Promising author benchmarks; verify receptive field and streaming behavior.[^swiftf0] |
| torchcrepe / CREPE | Independent pitch benchmark and optional phrase corroboration. | MIT code; track converted checkpoint provenance. Silence and sequence-decoding behavior need care.[^torchcrepe] |
| MediaPipe Face Landmarker | Optional visible lip/jaw/head observations. | Apache-2.0 code and reviewed bundle cards. Relative face depth and blendshapes are not hidden anatomy or calibrated joint angles.[^mediapipe] |
| Pink Trombone / modular fork | Small forward-simulation reference or UI comparison; not a substitute for the fitted physical model. | MIT. The modular fork uses AudioWorklet; verify Safari and preserve inherited notices.[^pink] |
| Three.js | Renderer for fitted geometry and alternative anatomical hypotheses. | MIT; imported anatomical assets require their own rights. Use simulator-derived geometry; 2D contours can precede a 3D export.[^three] |
| WORLD / pyworld | Offline acoustic analysis/resynthesis research. | BSD-style core / MIT wrapper. Spectral envelope does not uniquely identify anatomy.[^world] |
| Basic Pitch | Later reference transcription / note events. | Apache-2.0. Not the continuous low-latency cents/vibrato signal.[^basicpitch] |
| VocalTractLab | Primary hackathon forward engine for physiology inference. | GPL-3.0 is eligible for this open-source project. Pin engine/assets and validate the parameter adapter; integration is now on the initial critical path.[^vtl] |
| Praat / Parselmouth | Reference phonetic analysis and potentially production phrase analysis. | GPL variants are eligible. Select according to singing-metric validity, runtime and reproducibility rather than a proprietary-license concern.[^praat] |
| VocalTrax | Promising JAX inverse-acoustics prototype. | MIT top level, but inherited upstream code has unresolved licensing. Do not adopt into product until provenance is resolved.[^vocaltrax] |

SwiftF0 reports a 16 ms output hop and a compact model. Those are not demonstrated microphone-to-feedback latency. Conduct a bake-off against Pitchy and torchcrepe, select one production estimator and one fallback, and avoid running all models continuously on every phone.[^swiftf0]

VocalTrax explicitly credits substantial inherited code from vocal-tract-grad, whose repository lacked a license grant in the inspected root and relevant headers. That is a concrete unresolved provenance issue, not a finding of infringement. Obtain clarification or independently implement published equations using licensed components.[^vocaltrax]

Essentia's AGPL code is an eligible option for the open-source project; add it if its broader DSP functionality beats the smaller initial stack. Its pretrained models have separate noncommercial/no-derivatives terms. openSMILE's research license restricts commercial/product use and is not made unrestricted by open-sourcing this app. Obtain applicable permissions or avoid restricted assets. GPL and AGPL permit commercial use subject to their obligations.[^restricted]

VocalSet's publisher metadata specifies CC BY 4.0 and provides singing-technique material suitable for acoustic testing. It contains no measured individual anatomy or coaching outcomes. GTSinger offers richer technique/multilingual material but carries CC BY-NC-SA 4.0 and additional agreement text; do not assume permission for commercial use.[^datasets]

The distinctive training/evaluation corpus must be collected with consent: calibrated observations, assigned intervention, actual execution, prior model and committed prediction, plus independent physiology where available. Split by singer/session/song as appropriate; adjacent frames or clips from the same recording must not leak across evaluation boundaries. Dataset reuse permission does not remove all performer-consent or downstream-purpose questions.


## 11. Parallel-agent implementation responsibilities

Two human leads coordinate bounded Astra agents through dependency gates, without fixed hackathon timing. A owns scientific interpretation and numerical acceptance; B owns the experimental system, independent evaluation and repository integration queue. The companion [parallel-agent execution plan](two-person-execution-plan.md) defines exclusive module ownership, dispatch rules, acceptance experiments and human checklists. Its complete text is also included as the execution appendix in the PDF.

Start with KIT-01: a runnable contract kit defining observations, model candidates, forecasts, immutable prediction commits, evaluation records, units, coordinate frames and evidence provenance. Publish schemas and validation commands first; add a genuine synthesized audio/geometry pair and actual synchronized phone capture as their producers become available. The engine capability manifest evolves from verified support. No production consumer uses fabricated fitted anatomy.

| Agent lane | Human lead | Deliverable / dependency |
|---|---|---|
| KIT-01 / INT-01 contracts and integration | B | Versioned artifacts, validation, replay and cross-service checks; minimum shared decisions first. |
| PHY-01 forward physics | A | Pinned engine, parameter capabilities and real audio/geometry export. |
| CAP-01/02 native acquisition | B | Synchronized phone audio/RGB/depth, calibration and measured quality; bundle schema first. |
| AUD-01 acoustic measurements | B; A reviews | Canonical extractor shared by simulated and observed signals; feature definitions first. |
| GEO-01 visual/depth measurements | A | Calibrated visible-surface constraints, uncertainty and missing data; bundle coordinates first. |
| INV-01 / FUSE-01 inverse inference | A | Shared anatomy, dynamic articulation, diverse candidates and multimodal fit; engine and measurements first. |
| SVC-01 scientific jobs | A | Artifact/job lifecycle, cancellation, retries and model version checks; contracts first. |
| EVAL-01 / DEPTH-02 / REP-01 evaluation | B | Hidden scoring truth, baselines, modality comparisons and reproducibility; frozen scoring protocol first. |
| PRED-01 numerical forecasts | A | Supported interventions and numerical disagreement; engine capabilities and candidate models first. |
| ACT-01 / DEPTH-01 orchestration | B | Validated action, frozen prediction, capture, score, then update; forecast/capture/evaluation contracts first. |
| VIS-01 model visualization | B | Actual engine geometry and alternatives; genuine geometry export first. |

Activate roughly six foundation tasks initially: contracts, engine, native capture, acoustic measurement definition, evaluation design and visual/depth feasibility. Start each independent portion once its inputs exist. After genuine artifacts arrive, activate inverse fitting, job service, visualization and executable benchmarks. Then connect numerical forecasts and orchestration into the prospective loop and run modality comparisons. These are dependency waves, not group-wide barriers: synthetic recovery continues while phone capture is unresolved, and capture continues while inference is incomplete.

B integrates reviewed commits in dependency order and maintains a passing cross-service path. Each implementation agent has an isolated worktree, bounded task, exclusive owned files, starting commit, input contract and acceptance experiment. Assign one writer per shared schema/dependency file. A signs off scientific changes; a separate reviewer checks evidence. Every handoff includes actual test results, exact replay commands, provenance and blockers. Do not start new tasks merely to occupy agents or let agents expand their own scope.

Integration evidence gates are G0 contract skeleton; G1 genuine artifact exchange; G2 hidden synthetic inference and actual geometry rendering; G3 real multimodal fitting; G4 prediction committed before capture and scored before update; G5 reproduced benchmarks and modality results. G2 can precede phone capture; synthetic G4 does not satisfy a human-data gate. Task status is proposed, ready, running, review, integrated or blocked, with an explicit missing dependency and owner.

Use additional agents for bounded identifiability, anatomy/articulation separation, microphone compensation, model-mismatch, depth-value and leakage investigations. Algorithm alternatives share an interface and predeclared development benchmark/compute budget; select on development cases and evaluate the selected method on fresh held-out cases. Keep scoring truth outside inference and planning inputs. Agent agreement is not empirical evidence. Schedule simulator/device resources and isolate stateful engine workers when thread safety is unproven.

The demo should show: initial candidate anatomies, why a specific new experiment distinguishes them, the sound/spectrum predicted before recording, the observed result, and how the candidates change. Follow with recovery plots on hidden synthetic subjects. If a compatible independently measured case exists, present that as a separate anatomy validation panel.

Fallbacks preserve the research question. A replayed prerecorded run is labeled as replay. A synthetic-only run is labeled as synthetic. A low-dimensional solver states its variables. No ground-truth synthetic anatomy enters the inverse algorithm, Astra context, or selection logic. No prerecorded success is presented as a live reconstruction.

### Implementation tickets and acceptance criteria

1. **PHY-01 forward engine:** reproducible build; unit-aware adapter; reset tests; supported boundary conditions; known configuration yields deterministic audio/geometry.
2. **INV-01 shared anatomy:** fit several tasks jointly; parameter domains enforced; multiple starts; synthetic truth withheld; fixed-anatomy baseline using equal dynamic flexibility.
3. **OBS-01 capture (B):** includes CAP-01 and CAP-02 native RGB/depth/audio capture; synchronized timestamps, calibration/quality, permission loss and local stop. **FUSE-01 (A)** consumes the bundle; **DEPTH-01/02 (joint)** test prospective use and incremental value, as specified in section 8.
4. **ACT-01 experiment planning:** numerical forecasts for available actions; compliance uncertainty; fixed-protocol baseline; Astra rationale references actual candidate evidence.
5. **EVAL-01 prospective record:** immutable prediction precedes capture; scoring precedes update; no target leakage; all failures/attempts retained in summary.
6. **VIS-01 anatomy display:** geometry derived from fitted engine; alternative candidates visible; fixed versus estimated parameters clear; predicted/observed differences readable.
7. **REP-01 reproducibility:** one command reproduces synthetic benchmark and recorded fit from a permitted manifest; versions, seeds and budgets included.

## 12. Validation that can disprove our model

For simulation, hold out entire anatomical instances and intervention sequences, not adjacent frames. Measure parameter error normalized to each physical range, recovery of identifiable parameter combinations, predictive error, and interval coverage where intervals are claimed. Include noisy capture and mismatched models: altered wall losses, room response, or a richer generating model than the inverse solver. Same-simulator recovery is vulnerable to an inverse crime and cannot establish real anatomy.

For live experiments, lock feature/scoring definitions before outcomes. Evaluate task predictions without refitting on the held-out sound. Report recording quality, attempt count, exclusions, runtime and comparison budgets. Compare intervention effects relative to repeated-baseline variability, not just whether a generated voice sounds similar. Very small hackathon samples are case studies, not population efficacy evidence.

For anatomical validation, use withheld modality-specific measurements, registered into a declared coordinate system. Static MRI may constrain geometry in the imaged pose; dynamic imaging constrains observed trajectories. EMA covers tracked points, not complete volume. EGG provides contact-related information, not a direct stiffness or mass measurement. Instrumental assessment must be conducted through appropriate research/clinical partners.[^asha-imaging][^egg]

Separate training data, subject calibration data and scoring-only measurements. If an image of the target's internal tract initializes their reconstruction, label that MRI-assisted personalization; it does not validate phone-only inference. For mechanics, first establish recoverability in controlled physical or synthetic systems with known material parameters, then seek suitable independent human evidence. Geometry agreement alone does not prove tissue mechanics.

Predeclare parameter-specific tolerances according to measurement resolution and intended use once a reference dataset is selected; do not invent a universal millimeter threshold before knowing the reference. Compare anatomical error against a generic template and plausible-prior baseline, including uncertainty. A posterior that confidently excludes the reference is worse than an appropriately broad one.

| Failure pattern | Interpretation / next experiment |
|---|---|
| Great audio fit, wrong reference geometry | Acoustic fitting succeeded; physiological reconstruction failed. Test alternatives and stronger measurements. |
| Anatomy changes across vowels or microphones | Global/dynamic/capture separation failed; audit model freedom and calibration. |
| Active actions add no information | Selection may target noise or redundant observations; compare repeat noise and parameter sensitivity. |
| Predictions fail under new interventions | Overfitting or missing physics; inspect execution uncertainty and solver boundaries. |
| Face features help only on familiar singers | Possible identity/capture confounding; enforce singer/source holdouts. |
| Candidate spread collapses without accuracy | False confidence from likelihood/prior/model mismatch; test coverage and alternate model families. |

## 13. Research-to-production roadmap

**Reproducible inverse-physics baseline.** Stabilize the supported anatomical subset, synthetic benchmarks, inference diagnostics and experiment state machine. Benchmark engine runtime and test several consenting cases under a reviewed protocol. Gate: repeatable fitting and honest mismatch detection, not a predetermined positive result.

**Active multimodal inference.** Add a validated nasal boundary model if missing, more visible constraints, richer global morphology and a simulation surrogate where useful. Compare active, fixed, audio-only and audiovisual conditions at equal budgets. Gate: reproducible predictive improvement and reduced error/ambiguity in known-parameter settings.

**Independent anatomy study.** Secure partners and modality-compatible data, define anatomical targets and reference registration, and evaluate unseen people. Instrument access, permissions and data quality are prerequisites. Gate: parameter-specific reference agreement beyond generic templates; no promise this will succeed.

**Following phase, mechanics and fuller 3D inference.** Add self-oscillating source/tissue models, coupled dynamics and more expressive geometry. Run identifiability and mismatch tests before attributing fitted constants to physical tissues. Gate: independent evidence for each new physical interpretation, not just lower acoustic error.

**Broader coaching validation after the prototype embodied loop.** Use simulated interventions to guide comfortable practice, then evaluate learning, retention and usability. The production roadmap adds identity/access controls, deletion, device reliability, specialist-reviewed exercises, monitoring and model drift handling. A scientifically inconclusive model may remain a valuable open-source research tool without being advertised as an accurate personal physiological coach.

## 14. Decisions, remaining unknowns and deliverables

The first dispatch establishes KIT-01 and launches the independent foundation tasks in section 11, including cue-library/protocol design and synthetic motor-control design from the embodied addendum. PHY-01 and the synthetic recovery harness form the scientific critical path while native capture, measurement validation and evaluation design progress alongside them. Pin the engine and supported parameter subset, generate hidden test anatomies, and attempt reconstruction from simulated audiovisual tasks. This tests the coherence of the inverse loop while the experimental instrument is being validated.

Critical unknowns are supported nasal outlet control, global morphology integration, runtime per candidate, correspondence between external and internal geometry, robustness to source/capture compensation, and recoverability of mechanics. Each has an explicit experiment or integration gate above. Lack of certainty is expected; hidden substitution of a simpler product is not.

Deliver an open-source research repository with the forward adapter, inverse solver, experiment planner, capture client, actual model visualization, reproducible benchmarks, provenance manifests and a results report. Publish code and appropriately permitted synthetic/sample assets; real participant data requires explicit release permission. This specification and its PDF are design artifacts only. No recovery accuracy, speed or anatomical validity is claimed as achieved.

The intended breakthrough is **recovering an individual's physical voice-generating system through conversation-guided experiments**. The standard for the hackathon is a genuine attempt that could fail in an informative way. The standard for eventually claiming reconstruction is independent evidence that the inferred physiology corresponds to the person.


[^joint-anatomy]: Sun, Huang and Wu. Unsupervised Acoustic-to-Articulatory Inversion with Variable Vocal Tract Anatomy. Interspeech 2022; measured-anatomy validation identified as future work. https://www.isca-archive.org/interspeech_2022/sun22b_interspeech.pdf
[^mri-inversion]: Azzouz et al. Acoustic-to-articulatory inversion preprint, March 30, 2026. Full text and dataset limitations. https://arxiv.org/html/2603.28723v1
[^source-filter]: Titze. Nonlinear source-filter coupling in phonation, 2008. https://pmc.ncbi.nlm.nih.gov/articles/PMC2811547/
[^high-f0]: Bresch and Narayanan. Real-time MRI study of resonance tuning in soprano singing, 2010. https://pmc.ncbi.nlm.nih.gov/articles/PMC2997814/
[^vtl]: TU Dresden. VocalTractLab development backend and GPL-3.0 LICENSE, inspected September 10, 2026. https://github.com/TUD-STKS/VocalTractLabBackend-dev ; https://github.com/TUD-STKS/VocalTractLabBackend-dev/blob/main/LICENSE
[^vtl-api]: TU Dresden. VocalTractLab C API header. Parameter metadata, tract conversion and synthesis interfaces; inspected September 10, 2026. https://raw.githubusercontent.com/TUD-STKS/VocalTractLabBackend-dev/main/include/VocalTractLabApi/VocalTractLabApi.h
[^mediapipe]: Google. MediaPipe Face Landmarker web guide, Apache-2.0 source and bundle model cards, inspected September 10, 2026. https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js ; https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE ; https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
[^nidcd]: National Institute on Deafness and Other Communication Disorders. “Taking Care of Your Voice.” Updated June 11, 2025. https://www.nidcd.nih.gov/health/taking-care-your-voice
[^nasal-study]: Gramming, Nord, Sundberg and Elliot. Does the nose resonate during singing? KTH STL-QPSR 34(4), 1993. https://www.speech.kth.se/qpsr/1993/1993_34_4_035-042.pdf
[^nasality-inversion]: Tabatabaee et al. Enhancing Acoustic-to-Articulatory Speech Inversion by Incorporating Nasality. Interspeech 2025. https://arxiv.org/abs/2506.09231
[^av-inversion]: Engwall. Audiovisual-to-articulatory inversion. Speech Communication 51, 2009, pages 195-209. https://www.csc.kth.se/~hedvig/publications/specom_09.pdf
[^audio-worklet]: Mozilla Developer Network. “AudioWorklet.” Official browser API reference, accessed September 10, 2026. https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
[^capture]: Mozilla Developer Network. “MediaDevices: getUserMedia() method” and capture constraints. Accessed September 10, 2026. https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
[^astra]: OpenAI. “GPT-6 Astra Model.” Modalities, tools and pricing, accessed September 10, 2026. https://developers.openai.com/api/docs/models/gpt-6-astra
[^gnu]: Free Software Foundation. GNU license guidance and GPLv3/AGPLv3 Section 13, accessed September 10, 2026. https://www.gnu.org/licenses/why-affero-gpl.html ; https://www.gnu.org/licenses/quick-guide-gplv3.html ; https://www.gnu.org/licenses/license-list.html#apache2 ; https://www.gnu.org/licenses/gpl-3.0.html#section13 ; https://www.gnu.org/licenses/agpl-3.0.html#section13
[^pitchy]: Ian Prime. Pitchy repository and actual BSD-0-Clause LICENSE, inspected September 10, 2026. https://github.com/ianprime0509/pitchy ; https://github.com/ianprime0509/pitchy/blob/main/LICENSE
[^librosa]: librosa project. Repository and ISC LICENSE, inspected September 10, 2026. https://github.com/librosa/librosa ; https://github.com/librosa/librosa/blob/main/LICENSE.md
[^swiftf0]: SwiftF0 project. Repository, MIT LICENSE, bundled ONNX model and 2025 paper, inspected September 10, 2026. https://github.com/lars76/swift-f0 ; https://github.com/lars76/swift-f0/blob/main/LICENSE ; https://arxiv.org/abs/2508.18440
[^torchcrepe]: Morrison et al. torchcrepe and CREPE repositories, MIT licenses and checkpoint provenance, inspected September 10, 2026. https://github.com/maxrmorrison/torchcrepe ; https://github.com/maxrmorrison/torchcrepe/blob/master/LICENSE ; https://github.com/marl/crepe/blob/master/LICENSE
[^pink]: Thapen et al. Pink Trombone source mirror and modular AudioWorklet fork, MIT LICENSE files, inspected September 10, 2026. https://github.com/evykassirer/pink-trombone ; https://github.com/evykassirer/pink-trombone/blob/master/LICENSE ; https://github.com/yonatanrozin/Modular-Pink-Trombone ; https://github.com/yonatanrozin/Modular-Pink-Trombone/blob/main/LICENSE
[^three]: Three.js project. MIT LICENSE, inspected September 10, 2026. https://github.com/mrdoob/three.js/blob/dev/LICENSE
[^world]: WORLD / pyworld projects. Core BSD-style license and MIT wrapper, inspected September 10, 2026. https://github.com/mmorise/World/blob/master/LICENSE.txt ; https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder/blob/master/LICENSE
[^basicpitch]: Spotify. Basic Pitch repository and Apache-2.0 LICENSE, inspected September 10, 2026. https://github.com/spotify/basic-pitch ; https://github.com/spotify/basic-pitch/blob/main/LICENSE
[^praat]: Praat / Parselmouth projects. GPL license evidence, inspected September 10, 2026. https://github.com/YannickJadoul/Parselmouth/blob/master/LICENSE ; https://github.com/praat/praat/blob/master/fon/Sound.cpp
[^vocaltrax]: PapayaResearch. VocalTrax README / MIT LICENSE and credited vocal-tract-grad upstream, inspected September 10, 2026. https://github.com/PapayaResearch/vocaltrax ; https://github.com/PapayaResearch/vocaltrax/blob/main/LICENSE ; https://github.com/davidmarttila/vocal-tract-grad ; https://github.com/davidmarttila/vocal-tract-grad/blob/main/physical_tract.py
[^restricted]: audEERING openSMILE Research License; Essentia licensing information, inspected September 10, 2026. https://github.com/audeering/opensmile/blob/master/LICENSE ; https://essentia.upf.edu/licensing_information.html
[^datasets]: Wilkins et al. VocalSet 1.2, publisher record and CC BY 4.0 metadata; GTSinger dataset license, inspected September 10, 2026. https://zenodo.org/records/1442513 ; https://zenodo.org/api/records/1442513 ; https://github.com/AaronZ345/GTSinger/blob/main/dataset_license.md
[^asha-imaging]: American Speech-Language-Hearing Association. “Vocal Tract Visualization and Imaging.” Accessed September 10, 2026. https://www.asha.org/practice-portal/clinical-topics/voice-disorders/vocal-tract-visualization-and-imaging/
[^egg]: Herbst. “Electroglottography - An Update.” Published online March 11, 2019; journal issue July 2020. https://pubmed.ncbi.nlm.nih.gov/30871855/

[^iphone-depth]: Apple. iPhone 13 Pro Max and iPhone 15 Pro technical specifications. Accessed September 10, 2026. https://support.apple.com/en-us/111870 ; https://support.apple.com/en-us/111829
[^depth-sync]: Apple. AVCaptureDataOutputSynchronizer and front TrueDepth capture timestamps. Accessed September 10, 2026. https://developer.apple.com/documentation/avfoundation/avcapturedataoutputsynchronizer ; https://developer.apple.com/documentation/arkit/arframe/captureddepthdata
[^depth-filter]: Apple. Discover advancements in iOS camera capture: Depth, focus, and multitasking. WWDC22; depth filtering guidance. https://developer.apple.com/videos/play/wwdc2022/110429/

[^embodied-asha]: American Speech-Language-Hearing Association. Voice Disorders; yawn-sigh and facilitating approaches. Accessed September 10, 2026. https://www.asha.org/practice-portal/clinical-topics/voice-disorders/
[^twang]: Sundberg and Thalén. What is Twang? Journal of Voice, 2010. Single-performer acoustic/source study. https://pubmed.ncbi.nlm.nih.gov/20083379/

[^active-probe]: UNSW Music Acoustics. Vocal tract resonances from broadband excitation; calibrated external source/microphone and visual feedback. https://www.phys.unsw.edu.au/jw/broadband.html
[^active-reflectometry]: Acoustic reflectometry for airway measurement. Principles, limitations and previous work. https://pubmed.ncbi.nlm.nih.gov/1855359/
[^active-nasal]: Acoustic rhinometry in healthy humans: accuracy of area estimates and ability to quantify certain anatomic structures in the nasal cavity. https://pubmed.ncbi.nlm.nih.gov/18217510/
