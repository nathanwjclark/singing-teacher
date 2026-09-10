# Singing Teacher

A private, browser-based singing practice studio: your live webcam on the left, a mirrored 3D head-and-shoulders anatomical movement guide in the middle, and large, ranked visual coaching cues on the right.

## Run locally

Requires Node.js 22.12+ and npm. Chrome is recommended for the first prototype.

```sh
npm install
npm run build
npm run local
```

Open http://127.0.0.1:5173. The local server also handles phone pairing and explicit snapshot uploads. Use `npm run dev` for UI-only development; its server does not provide the pairing API. Camera and microphone request access automatically when the app opens. Allow access and frame your face and shoulders in even light. If the browser suspends Web Audio until a gesture, select **Enable audio**. Try an easy sustained vowel. **Stop camera** releases the webcam; the microphone has its own Stop control. **Demo** displays explicitly labeled sample measurements without requesting camera access. Switch among vowel, head/neck, body balance, and lip-shape examples. Select a coaching card to highlight its associated anatomical region.

The first camera session downloads OpenCV, MediaPipe WASM, and face/pose models, so allow time for initialization. Camera access requires localhost or HTTPS.

## How it works

- **Camera:** mirrored video with a face outline, lip landmarks, and shoulder/torso guides. Camera and microphone start independently on app open, each with a Stop control. Recording is off by default and requires **Start recording**.
- **Computer vision:** OpenCV.js converts frames to grayscale, measures brightness, and calculates frame-difference motion. MediaPipe provides 478 face landmarks, 33 body landmarks, estimated world pose, a facial transform, and 52 blendshape coefficients. A dense face mesh and full pose connections appear over the camera. Face and body inference run on every processed frame, at up to roughly 11 fps. Adaptive filtering stabilizes body landmarks and head angles, rejects isolated jumps, and follows faster movement with less smoothing. The dense face mesh supplies facial overlays; duplicate coarse body-model facial dots are omitted. Shoulder-reference changes require sustained confidence and preserve the current position.
- **Movement map:** 165 real skeletal and muscle meshes from Z-Anatomy, derived from BodyParts3D, rendered in 3D with cartoony eyeballs. The mirrored model follows estimated head and body movement. Jaw and neck muscle meshes deform between weighted skull, jaw, and chest attachments; chin muscles follow the jaw. Independent shoulder joints drive the clavicles, upper arms, and attached deltoid, trapezius, and chest muscles. Facial blendshapes animate brow raises, blinks, cheek motion, and lip expressions. This is illustrative rigging, not a physiological muscle simulation. Recent coaching cues collect into up to six selectable tiles, ordered by newest onset or recurrence. Tiles distinguish currently present cues from recent observations, and fade away over five seconds once no longer present. Select a coaching card to explore its associated muscles; drag to orbit the model.
- **Coaching:** deterministic heuristics rank mouth opening during a sustained vowel, sideways head tilt, and shoulder asymmetry. Missing landmarks and poor lighting produce framing guidance. This is a prototype, with uncalibrated thresholds—not a validated teaching assessment.

The anatomical mesh is a reference body, not a scan of you: a webcam cannot see internal bones, measure muscle tension, or assess breath support. Visual coaching is not gated on the audio pane: mouth-opening prompts are conditional on practicing a vowel and may be irrelevant between phrases. The optional audio pane displays a waveform and trailing sound descriptors, not a validated assessment of singing technique. Movement measurements can be affected by camera angle and framing. The depth baseline is session-only; it compares current iris-based range to a reference frame. Absolute range assumes an average iris diameter and camera field of view, so it is approximate. Body world coordinates are model estimates relative to the hips, not distance to the camera. Explicit phone snapshots are stored on your local server in `.local-data/captures/`; the experiment ledger stores metadata locally in the browser. Recordings stay in the tab until downloaded or replaced. External hosts receive normal asset requests for models, libraries, and fonts. No public capture server or CD is configured.

## Audio pane

The microphone starts automatically when permission and browser autoplay rules allow. Use its controls in the bottom pane to see your waveform and trailing loudness, spectral brightness, timbre descriptors, pitch, and tone periodicity. Pitch shows the nearest note and octave, Hz, and cents relative to A4 = 440 Hz. Silence and uncertain/noisy input leave gaps rather than inventing notes. Microphone audio is analyzed locally with Web Audio; recording is opt-in, and live audio is not played back. A paired phone can provide the live microphone over local WebRTC. Stop the microphone when finished. Timbre is complex: spectral measurements describe aspects of the sound, not a definitive voice type or quality score. Microphone response and room noise affect them. Automatic quiet-window calibration estimates ambient noise, SNR and clipping; it does not recover absolute microphone EQ or room response.

The desktop studio fits its camera, model, coaching, and audio history into a single laptop viewport. Smaller phone screens use a stacked layout.

## Working on features

Use a separate worktree and branch for each feature, as recorded in `AGENTS.md`. Integrate into `main`, deploy, then remove the merged worktrees and branches. Keep checks focused: a build and a relevant smoke check, followed by hands-on testing in the running app.

## Development and checks

```sh
npm run build       # TypeScript check + production build in dist/
npm run lint
npm test            # Coaching edge cases and ranking
npm run test:e2e     # Desktop demo, camera denial, mobile layout
```

Browser tests use locally installed Google Chrome. In a CI environment, run `npx playwright install chrome` first. The ordinary browser tests do not require a webcam or model downloads. Real camera and face detection should also be checked manually before a release.

Preview the production build locally with `npm run preview -- --host 127.0.0.1`. Deploy `dist/` to a static HTTPS host after `npm run build`. No backend, API keys, or environment variables are needed.

## Structure

- `src/App.tsx`: studio layout, session controls, demo state.
- `src/components/CameraPanel.tsx`: camera lifecycle, drawing, status handling.
- `src/lib/vision.ts`: OpenCV and MediaPipe runtime, measurements.
- `src/components/AnatomyPanel.tsx`: interactive anatomical 3D viewer.
- `src/lib/coaching.ts`: prioritized visual practice prompts.
- `src/components/CoachingPanel.tsx`: large ranked suggestions.

## Anatomical assets

The bundled upper-body mesh subset comes from Z-Anatomy. Source revisions, credits, licenses, and the conversion method are in [the asset attribution](public/models/ATTRIBUTION.md). These reference meshes are animated from estimated external landmarks; they are not a scan of your own anatomy.

## References

- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)
- [OpenCV browser video processing](https://docs.opencv.org/4.13.0/js_video_display.html)

### Tongue reference and visible tracking

The Tongue layer is an original, simplified 3D surface attached to the jaw. Pink outlines show experimental color segmentation of visible tissue. To animate it, click **Track tip**, then click the visible tongue tip near its edge in the mirrored camera view. A local texture tracker follows that selected point; the crosshair and model use the same position for upward/downward and sideways motion. **Recenter tongue** sets the current point as neutral. Selection supplies the anatomical label: the tracker does not automatically identify the tip. Flat texture, occlusion, or large changes in appearance can lose tracking; select the tip again when prompted. Region-only detection does not animate the model. The model returns to rest after tracking is lost. The Tongue demo uses synthetic motion.

This is not a trained tongue detector: lighting, lipstick, gums, and food can cause errors. It cannot determine hidden tongue shape, muscle activity, depth, or contact with the palate. No tongue-based coaching judgments are generated. The existing [MediaPipe facial blendshape output](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/face_landmarker/Blendshapes) is separate from this experimental visible-tissue estimate. Processing stays in the browser.

## Lead B workspace

**Connect phone / QR** opens the guided face/profile/mouth/tongue bootstrap flow, with video demonstrations, CV overlay and review/retake before sending snapshots. Phone microphone mode is separate. Trusted phone-reachable HTTPS is required; see [local phone setup](docs/implementation/LOCAL-PHONE.md). Browser snapshots do not provide raw TrueDepth/LiDAR or measured internal musculature.

**Start recording / Stop** records only on request, with replay and recording/manifest downloads. The application extracts canonical acoustic windows from the saved recording bytes. The **Experiments** tab contains observation and failure histories, validated record imports, prospective trial controls, independent scoring setup, modality comparisons, depth readiness and reproducibility export. Forecasts must be supplied by a real scientific engine; no fit or prediction is fabricated when that producer is missing.

**Default / Mapped** anatomy keeps the live reference separate from imported fitted engine geometry. Mapped geometry requires a validated candidate record and a local self-contained geometry artifact whose digest matches the record.

Implementation and pending device/scientific acceptance are recorded in the [eleven-ticket board](docs/implementation/task-board.md). The [dataset shortlist](docs/research/articulatory-datasets.md) distinguishes articulator motion from muscle activation and singing-quality labels. Evidence exports can be checked with `node --experimental-strip-types scripts/replay-experiment.ts evidence.json evidence-report`; this is an integrity/reproducibility audit, not an execution of the absent physiology engine.

### Tongue observation lab

Open **Tongue lab · inspect & capture** under the camera. The enlarged mirrored mouth crop shows the tracked point and tissue outline. Click the visible tip to initialize the current patch tracker. Its state, rejection reason, match similarity, and ambiguity margin are shown separately; similarity is not a calibrated probability. Color segmentation no longer suppresses a valid selected point track.

Choose a motion (up/down/left/right/out/retract or a still/head-motion control), then explicitly **Start capture** and **Stop capture**. Capture collects four mouth images per second, up to 80 images total, with no audio. Nothing is saved by default. **Review captured frames** lets you click the true visible tip or mark it hidden/unidentifiable. Pink is the prediction and green is the human label. The lab reports detection coverage on labeled visible frames, mean position error in the 480×384 crop, and predictions on labeled hidden frames. Export downloads JSON containing raw JPEG crops, crop transforms, labels, tracker diagnostics, and predictions. Coordinates are normalized and unmirrored. Data stays in memory until exported and is discarded when the lab closes.

This is the measurement and annotation stage, not a trained tongue landmark detector. The current patch tracker still needs manual initialization and can lose tracking. Before replacing it, compare candidate tongue-specific detectors and temporal trackers on labeled real captures, including upward motion, occlusion, head movement, and varying lighting. Use held-out recordings for evaluation. A future constrained rig should fit projected tip and contour observations with separate lateral/elevation/protrusion/curl controls; monocular depth and hidden tongue shape must remain identified as inferred. No automatic anatomical reacquisition or new 3D fitting is claimed by this increment.
