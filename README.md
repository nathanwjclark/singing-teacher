# TractStar

A private singing-research prototype combining live movement and audio views, native vocal-tract fitting, prospective acoustic experiments, and an Astra coach. The app runs capture preparation, fitting, experiment selection, scoring and personal sensation memory; inferred internal anatomy remains an unvalidated research hypothesis.

## Run locally

Requires Node.js 22.12+ and npm. Complete the one-time [scientific Python and native-engine setup](science/README.md#setup) first. Chrome is recommended for the prototype. This is developer installation; learners do not run backend commands between recordings.

```sh
npm install
npm run build
npm run science:local
```

Open http://127.0.0.1:5173. The launcher starts the local app and persistent scientific worker together. `SINGING_PYTHON` can select an existing scientific Python environment; otherwise it uses `science/.venv/bin/python`. For same-Wi-Fi phone capture, complete [trusted local HTTPS setup](docs/implementation/LOCAL-PHONE.md), then use `npm run science:private` to start both services with phone HTTPS. Use `npm run dev` for UI-only development; it does not provide the backend APIs. Camera and microphone request access automatically when the app opens. Allow access and frame your face and shoulders in even light. If the browser suspends Web Audio until a gesture, select **Enable audio**. Try an easy sustained vowel. **Stop camera** releases the webcam; the microphone has its own Stop control. **Demo** displays explicitly labeled sample measurements without requesting camera access. Switch among vowel, head/neck, body balance, and lip-shape examples. Select a coaching card to highlight its associated anatomical region.

The first camera session downloads MediaPipe WASM and face/pose models, so allow time for initialization. Camera access requires localhost or HTTPS.

## How it works

- **Camera:** mirrored video with a face outline, lip landmarks, and shoulder/torso guides. Camera and microphone start independently on app open, each with a Stop control. Recording is off by default and requires **Start recording**.
- **Computer vision:** MediaPipe provides 478 face landmarks, 33 body landmarks, estimated world pose, a facial transform, and 52 blendshape coefficients. A dense face mesh and full pose connections appear over the camera. Face and body inference run on every processed frame, at up to roughly 11 fps. Adaptive filtering stabilizes body landmarks and head angles, rejects isolated jumps, and follows faster movement with less smoothing. The dense face mesh supplies facial overlays; duplicate coarse body-model facial dots are omitted. Shoulder-reference changes require sustained confidence and preserve the current position.
- **Movement map:** 165 real skeletal and muscle meshes from Z-Anatomy, derived from BodyParts3D, rendered in 3D with cartoony eyeballs. The mirrored model follows estimated head and body movement. Jaw and neck muscle meshes deform between weighted skull, jaw, and chest attachments; chin muscles follow the jaw. Independent shoulder joints drive the clavicles, upper arms, and attached deltoid, trapezius, and chest muscles. Facial blendshapes animate brow raises, blinks, cheek motion, and lip expressions. This is illustrative rigging, not a physiological muscle simulation. Recent coaching cues collect into up to six selectable tiles, ordered by newest onset or recurrence. Tiles distinguish currently present cues from recent observations, and fade away over five seconds once no longer present. Select a coaching card to explore its associated muscles; drag to orbit the model.
- **Visual movement cues:** deterministic heuristics rank mouth opening during a sustained vowel, sideways head tilt, and shoulder asymmetry. Missing landmarks and poor lighting produce framing guidance. This is a prototype, with uncalibrated thresholds—not a validated teaching assessment.

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

`npm run preview -- --host 127.0.0.1` serves only the frontend. The connected scientific app requires its local Node server and Python/native worker; a static `dist/` deployment does not provide those features. Live Astra additionally requires `OPENAI_API_KEY` in the server environment or private `.env`, with finite call limits. Never put that key in browser code or commit it. Numerical fitting remains available without a paid model call. See [Astra integration and verified execution](docs/implementation/ASTRA-INTEGRATION.md).

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

## Connected recording and experiment flow

Use **Pull iPhone** after saving an ordinary voice capture in the native iPhone app. Confirm the recorded vowel and choose **Fit and show model changes**. For a later recording, choose **Score frozen prediction** and follow the committed instruction. Preparation, numerical jobs, polling and result publication happen automatically. The Experiments page contains Astra decisions, scientific details, subjective personal cue memory and optional probe controls. See the [app voice flow](science/APP_VOICE_FLOW.md) and [current implementation status](docs/implementation/current-status.md).

**Connect phone / QR** provides the separate browser bootstrap and microphone flow. Browser snapshots do not expose raw TrueDepth/LiDAR or internal musculature. Native ordinary voice, linked sessions and calibrated acoustic probes have distinct import requirements; a probe recording is not silently treated as voice calibration.

Fitted/reference geometry is hash-verified before display. Outcome updates retain model lineage and may change candidate support without reconstructing the displayed geometry. The original calibration surface remains labeled historical when the active model advances. Failed and unsupported results remain visible rather than being presented as successful recovery.

## Visible tongue tracking

The current optional tongue path uses a private neural model with visible-tip, visibility and depth outputs, loaded locally through ONNX Runtime Web with verified model bytes. It supersedes the selected-patch and color trackers. Missing private weights or weak/hidden detections remain unavailable; the repository does not include participant training data. Front and side views use the same estimated pose. Tongue Lab retains inspection and manual comparison tools. See [neural tongue tracking](docs/implementation/NEURAL-TONGUE.md) for model setup, coordinate assumptions and evaluation limits.

Visible tongue estimates do not reveal hidden tongue shape, internal muscle activation, or precise anatomy. Optional phonation acoustics likewise do not diagnose vocal-fold closure. Source-model integration is currently in progress; see [optional phonation status](docs/implementation/PHONATION-STATUS.md) and the [current status](docs/implementation/current-status.md) before enabling research features.
