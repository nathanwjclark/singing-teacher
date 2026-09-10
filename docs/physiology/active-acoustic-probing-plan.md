# Active acoustic probing: integrated app capability

Revision 8. Active acoustic probing is an initial product workstream, alongside singing audio, RGB, depth and embodied cues. It is not gated behind completion of a separate research project. Build a real capture-to-inference path with acceptance checks inside delivery. The plan does not claim phone-based cavity reconstruction already works.

The [research-harness finish plan](research-harness-finish-plan.md) governs completion and the three-hour window. A coarse external-drive model with poor predictions can satisfy implementation acceptance when real probe data traverses it correctly. Capture-only probing does not complete the connection. Positive reconstruction accuracy or added modality benefit is not required.

## Product behavior and scope

Add an Acoustic mapping step to onboarding and the experiment flow. The app plays a known short probe from an external speaker, records the response, associates it with visible pose and a reviewed cue, and adds usable measurements to the personalized physical model. Show measured response changes, candidate-model predictions and whether a recording influenced the fit. Never present an echo as a directly scanned hidden surface.

The initial supported path is one iPhone using native simultaneous playback/recording near the lips. A Mac controls the session/displays results. A second iPhone is an optional receiver near the nose or another external position; neither phone goes inside the mouth or nostril. One-phone operation remains useful when the second device is absent. Near-nose response is a mixed-path observation, not proof that sound traveled internally.

Start with quiet, comfortable held gestures separated from singing: baseline placement, neutral/open-mouth pose, reviewed vowel-like pose, return to baseline, and repeats. No forced breath hold, maximal tongue extension or nasal blockage is required. Interleave probe trials and singing trials so probe energy cannot contaminate ordinary pitch/coaching feedback. Simultaneous probing during singing is a later supported mode requiring source separation and validation.

Flow: route/placement check -> opt-in recording -> level-limited preview -> reference and repeated pose capture -> signal-quality report -> physical fit/update -> next cue/probe suggestion. Capture begins before playback and includes a trailing interval. Stop immediately cancels playback and recording locally, including on interruption or route change. Private raw recordings follow existing consent/deletion/export rules.

## Acquisition and calibration (B)

Use a native audio engine with a supported full-duplex route. Request measurement-oriented audio processing and record the actual route/session configuration. Do not assume echo cancellation, gain control or hardware processing is absent merely because a mode was requested. If the combined audio/RGB/depth configuration is unsupported, report which measurements are absent; retain a standalone audio trial rather than mislabel asynchronous video as synchronized.

Use an audible, band-limited logarithmic sweep initially, with a recorded seed/configuration and smooth onset/offset. Save the exact digital excitation PCM and hash, actual output sample rate, output gain and playback schedule. B and A define the initial tested band/duration/level configuration in a versioned protocol. Defaults must be explicit in the implementation; never label an unmeasured phone route as calibrated. Exclude ultrasonic/high-level probing and automatic volume escalation. A digital volume setting is not an acoustic exposure measurement: human playback needs a device/placement output-level check and a reviewed bounded protocol.

Retain original microphone PCM, channel/ASBD metadata, sample indices, host/sample timestamps, buffer discontinuities, clipping, interruptions, input/output latency reports and session settings. Use native sample/host mappings plus recorded synchronization markers to estimate playback-to-recording timing and drift; report uncertainty. Network arrival and button-press times do not establish acoustic time of flight.

Calibration has separate records:

- Device/route response and usable band: known reference measurements, repeat noise and evidence of playback processing/nonlinearity.
- Placement reference: external source/microphone positions, orientation, visible mouth aperture, distance estimate and its provenance/uncertainty; repeat after repositioning.
- Same-placement pose reference and returns: measure relative changes without treating a closed-mouth baseline as a universal free-field calibration.
- Physical output-level check: device/route/placement/protocol and calibrated instrument used, with limits enforced by the app.

Changing route, volume, position, sample rate or processing invalidates the relevant calibration. Ambient silence estimates noise, not a speaker/microphone transfer response. A known digital waveform is not a calibrated incident acoustic pressure or volume velocity.

For two phones, the source phone also records a local reference. The second phone retains its own clock and receives distinguishable markers to estimate offset/drift. A marker received over an unknown acoustic path cannot independently establish anatomical propagation delay. Until cross-device timing is characterized, omit absolute phase/range claims and use only appropriately supported response magnitudes/relative changes. Record both near-mouth and near-nose channels and model the external leakage path; the nose microphone alone cannot identify the internal path.

## Signal processing and immutable records (B; A reviews)

Add a dedicated probe-response extractor alongside the existing canonical singing-audio extractor. These are different quantities; pitch/RMS/centroid alone cannot represent the external probe response.

For suitable repeated records, estimate the complex recorded-to-digital-drive response H(f)=S_yx(f)/(S_xx(f)+epsilon), with explicit normalization, regularization, windowing and units. Also retain an impulse-response estimate, valid frequency mask, repeat variability, SNR, saturation/processing flags, and timing uncertainty. Statistical coherence/variance requires repeated segments or ensemble estimates; do not report confidence from a single trivially coherent FFT ratio. Do not remove the near-mouth direct path by an arbitrary time gate: it can overlap the desired response.

Preserve raw data and derived provenance so A can re-estimate responses. Until instrument calibration supports more, label H as recorded PCM per digital excitation, not acoustic impedance, calibrated reflection coefficient or airway area. Relative/reference ratios retain denominator reliability and placement uncertainty. Phase is used only on verified timing support. Correlated frequency bins require covariance or documented band aggregation; FFT bin count is not independent evidence count.

Extend public KIT through its B-owned versioning process; do not silently change KIT 1.0.0 semantics or create an A-owned replacement. Retain ordinary ObservationBundle artifact references and add explicit records:

| Record | Required additions |
|---|---|
| ProbeDefinition | Exact excitation hash/configuration, signal band, duration/envelope, route, gain, allowed poses and protocol/level limits. |
| ProbeCalibration | Reference artifacts, device/route/placement IDs, measured usable band/noise, level check, clock mappings and uncertainty, validity conditions. |
| ProbeAttempt | Trial/cue/prediction/model IDs, exact drive and received-media hashes, per-device clocks, pose/visibility, calibration IDs, actual execution and failure reasons. |
| AcousticProbeMeasurement | Response frequencies/complex components or unavailable reasons, units/normalization, masks, uncertainty, timing support, extractor version/configuration and all source hashes. |
| ProbeForecast | Frozen anatomy/control state, external excitation/operator version, predicted supported channels, nuisance assumptions, calibration lineage and compute budget. |

Large arrays stay in hashed private artifacts. Ingestion verifies original drive/received bytes and matching windows before fitting; scalar records alone cannot certify origin. Distinguish software fixtures, physical reference objects and human recordings in machine-readable provenance. Retry is idempotent; changed calibration creates a new identity.

## Forward physics and inverse use (A)

The existing glottis-to-mouth transfer function is not the response to an external loudspeaker at the lips. Do not reuse it under a different name. Implement an explicit external-drive observation operator sharing the same anatomy and per-trial articulation as existing singing inference.

Begin with the supported one-dimensional tube-area geometry exported by the engine. Implement or expose a tested transmission-line/scattering model with declared propagation losses, lip radiation, glottal termination and source/load boundary conditions. Predict input impedance or reflection under the declared coupling, then map that result through the instrument/placement model into recorded response. A free external speaker is not a sealed wave tube; include its radiation/direct-path coupling rather than applying a sealed-tube formula unchanged. Export supported frequencies, assumptions and geometry-basis provenance.

Fit anatomy jointly across vocal and probing observations. Each probe pose has its own articulation, boundary state and alignment uncertainty. Device gain/response, direct leakage, room response and placement enter as bounded nuisance parameters with calibration priors/shared structure. An unrestricted per-frequency nuisance filter could explain everything and erase anatomical information; constrain it, diagnose confounding and compare with a nuisance-only/fixed-anatomy baseline.

The combined objective adds a calibrated/masked probe-response discrepancy to the existing audio and visible-geometry terms. Keep weights/noise models explicit. Use repeat-derived uncertainty where available; otherwise label a heuristic score, not a posterior likelihood. Retain competing candidates. Duplicate/overlapping evidence cannot gain weight by being imported through multiple modalities.

Nasal transmission requires an explicitly branched model with a velopharyngeal junction and oral/nasal outlets, plus external leakage. Audit actual engine geometry/boundaries and implement supported branches; never infer complete sinus topology from the existing unbranched mouth response. Two-phone collection is integrated now; a channel with no supported observation operator is stored and shown as not yet used by fitting. This is an explicit implementation dependency, not fabricated anatomical evidence.

Use three result states: captured; response usable; included in fit. Each has a reason, operator version and quality record. A fit may reject one band/channel while using another. Unsupported or corrupted data does not affect anatomy. Returning every trial as unsupported does not satisfy the feature's end-to-end acceptance.

## Runtime Astra and teaching integration

Astra receives the current candidate models, measured probe summaries, calibration/quality state and numerical forecasts. It selects among supported pose/probe protocols based on expected discrimination and learner burden, translates the pose into an approved familiar cue, and explains predicted versus observed response changes. Deterministic code generates waveforms, enforces output limits and computes acoustic predictions; Astra cannot invent a frequency response or override quality checks.

Extend the existing experiment state machine with probe actions. Freeze model/calibration/protocol/forecast before held-out capture; score before model update. Acquisition used to tune calibration is not subsequently relabeled held-out. Adapt the next probe only after results are retained. Ask for one gesture at a time and record sensation as subjective feedback, separately from measured resonance.

Expose a response comparison panel, confidence/quality explanations, whether probing narrowed candidate ambiguity, and inferred hidden structures labeled as hypotheses. Ordinary singing coaching resumes after probe playback stops. The initial demo must show a real Astra tool-mediated decision and subsequent adaptation, not only prewritten prompts.

## Integrated delivery and ownership

New files below are proposed scopes; coordinate shared-file edits through existing owners. No agents are dispatched by this document.

| Ticket | Lead / scope | Deliverable and acceptance |
|---|---|---|
| PROBE-01 capture | B; apps/ios probe module, existing capture owner integrates session | Actual level-bounded drive+record, exact source/raw output, local stop, route invalidation, repeat and optional second-device records. |
| PROBE-02 records/DSP | B; src/contracts owner; observations/acoustics and importer owner | Versioned validation, verified media, response estimator, repeat uncertainty, delay/processing detection; known-filter fixtures and real capture replay. |
| PROBE-03 external-drive physics | A; science acoustic-probe module, engine owner integrates capability | Correct external excitation boundary, shared tube geometry, reference analytical cases and direct-path model; nasal operator capability explicit. |
| PROBE-04 inverse/service | A; existing inverse/job owners | Joint fitting consumes actual usable probe evidence; nuisance baseline, invalid-channel rejection, immutable job artifacts and declared model limits. |
| PROBE-05 Astra/UI | B; existing orchestration/teacher/viewer owners | Mapping flow, runtime Astra tool use, immutable forecast and measured response feedback; ordinary recording remains usable. |
| PROBE-06 independent integration checks | B evaluator; A numerical review | End-to-end recorded response reaches fit; repeatability/placement controls and with/without-probe comparison under equal budgets; null results retained. |

Parallelize capture, records/DSP and forward physics after a minimal contract/operator agreement. UI scaffolding uses genuine producer responses as soon as available. Inverse integration follows extractor and operator readiness; it need not wait for two-phone or nasal support. Keep device access coordinated with existing CAP/MOT work and reuse one capture session rather than competing audio owners. Redirect available interface-polish capacity into acquisition/DSP; do not interrupt the current A/B publication and verified-media handoff.

G8 acceptance: a real external probe is recorded, its lineage/calibration is validated, supported response data enters the same anatomical fit as existing evidence, and the resulting prediction is displayed and independently scored. G9 acceptance: runtime Astra selects a supported next pose/probe, commits prediction before recording and responds to the result. Single-phone G8/G9 do not establish two-phone nasal reconstruction. Feature implementation can pass while the measured accuracy benefit is null; report those outcomes separately.

This is app development with built-in correctness checks. It does not require an upfront standalone anatomy-recovery study. It does require real playback/capture and a valid observation operator before claiming that acoustic probing contributes to reconstruction.

## Research basis and limits

External broadband excitation at the lips has been used to measure vocal-tract resonances and provide singing feedback. The published research system uses purpose-built source/microphone coupling and calibration; its performance is not automatically transferable to a bare phone. [UNSW method and resources](https://www.phys.unsw.edu.au/jw/broadband.html).

Acoustic reflectometry estimates an area-distance function under model assumptions. Nasal CT comparisons show that branching/resonances limit posterior area and sinus inference. These motivate direct response fitting and explicit alternative geometries. [Reflectometry principles](https://pubmed.ncbi.nlm.nih.gov/1855359/), [nasal accuracy study](https://pubmed.ncbi.nlm.nih.gov/18217510/).

Apple's measurement mode minimizes system-supplied processing; actual hardware route behavior still needs measurement. [Apple measurement mode](https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/measurement). Published research software/assets require a license check before reuse; the implementation plan does not import them or assume permission.
