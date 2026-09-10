# Singing Teacher

A private, browser-based singing practice studio: your live webcam on the left, a mirrored 3D head-and-shoulders anatomical movement guide in the middle, and large, ranked visual coaching cues on the right.

## Run locally

Requires Node.js 22.12+ and npm. Chrome is recommended for the first prototype.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Camera and microphone request access automatically when the app opens. Allow access and frame your face and shoulders in even light. If the browser suspends Web Audio until a gesture, select **Enable audio**. Try an easy sustained vowel. **Stop camera** releases the webcam; the microphone has its own Stop control. **Demo** displays explicitly labeled sample measurements without requesting camera access. Switch among vowel, head/neck, body balance, and lip-shape examples. Select a coaching card to highlight its associated anatomical region.

The first camera session downloads OpenCV, MediaPipe WASM, and face/pose models, so allow time for initialization. Camera access requires localhost or HTTPS.

## How it works

- **Camera:** mirrored video with a face outline, lip landmarks, and shoulder/torso guides. Camera and microphone start independently on app open, each with a Stop control. No recording.
- **Computer vision:** OpenCV.js converts frames to grayscale, measures brightness, and calculates frame-difference motion. MediaPipe provides 478 face landmarks, 33 body landmarks, estimated world pose, a facial transform, and 52 blendshape coefficients. A dense face mesh and full pose connections appear over the camera. Face inference runs at up to roughly 11 fps; pose inference runs every other processed frame.
- **Movement map:** 165 real skeletal and muscle meshes from Z-Anatomy, derived from BodyParts3D, rendered in 3D with cartoony eyeballs and a sculpted hairstyle in muscle mode. The mirrored model follows estimated head and body movement. Jaw and neck muscle meshes deform between weighted skull, jaw, and chest attachments; chin muscles follow the jaw. This is illustrative rigging, not a physiological muscle simulation. Select a coaching card to explore its associated muscles; drag to orbit the model.
- **Coaching:** deterministic heuristics rank mouth opening during a sustained vowel, sideways head tilt, and shoulder asymmetry. Missing landmarks and poor lighting produce framing guidance. This is a prototype, with uncalibrated thresholds—not a validated teaching assessment.

The anatomical mesh is a reference body, not a scan of you: a webcam cannot see internal bones, measure muscle tension, or assess breath support. Visual coaching is not gated on the audio pane: mouth-opening prompts are conditional on practicing a vowel and may be irrelevant between phrases. The optional audio pane displays a waveform and trailing sound descriptors, not a validated assessment of singing technique. Movement measurements can be affected by camera angle and framing. The depth baseline is session-only; it compares current iris-based range to a reference frame. Absolute range assumes an average iris diameter and camera field of view, so it is approximate. Body world coordinates are model estimates relative to the hips, not distance to the camera. No session data is persisted or uploaded; external hosts receive normal asset requests for models, libraries, and fonts.

## Audio pane

The microphone starts automatically when permission and browser autoplay rules allow. Use its controls in the bottom pane to see your waveform and trailing loudness, spectral brightness, and timbre descriptors. Microphone audio is analyzed locally with Web Audio and is not recorded, uploaded, or played back. Stop the microphone when finished. Timbre is complex: spectral measurements describe aspects of the sound, not a definitive voice type or quality score. Microphone response and room noise affect them.

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
