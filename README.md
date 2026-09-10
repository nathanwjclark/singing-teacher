# Singing Teacher

A private, browser-based singing practice studio: your live webcam on the left, an animated anatomical movement guide in the middle, and large, ranked visual coaching cues on the right.

## Run locally

Requires Node.js 22.12+ and npm. Chrome is recommended for the first prototype.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Select **Start camera**, allow webcam access, and frame your face and shoulders in even light. Try an easy sustained vowel. **End session** releases the webcam. **Explore a demo** displays explicitly labeled sample measurements without requesting camera access.

The first camera session downloads OpenCV, MediaPipe WASM, and face/pose models, so allow time for initialization. Camera access requires localhost or HTTPS.

## How it works

- **Camera:** mirrored video with a face outline, lip landmarks, and shoulder/torso guides. No audio capture or recording.
- **Computer vision:** OpenCV.js converts frames to grayscale, measures brightness, and calculates frame-difference motion. MediaPipe Face Landmarker and Pose Landmarker estimate external facial and body landmarks. Face inference runs at up to roughly 11 fps; pose inference runs every other processed frame.
- **Movement map:** an SVG skull, jaw, neck muscles, clavicles, shoulder muscles, and ribs follows estimated head tilt, jaw opening, and shoulder alignment. The highest-priority cue highlights the relevant area.
- **Coaching:** deterministic heuristics rank mouth opening during a sustained vowel, sideways head tilt, and shoulder asymmetry. Missing landmarks and poor lighting produce framing guidance. This is a prototype, with uncalibrated thresholds—not a validated teaching assessment.

The anatomy is illustrative: a webcam cannot see internal bones, measure muscle tension, or assess breath support. The app does not listen for singing, pitch, or vocal quality, so mouth-opening prompts are conditional on practicing a vowel and may be irrelevant between phrases. Movement measurements can be affected by camera angle and framing. No session data is persisted or uploaded; external hosts receive normal asset requests for models, libraries, and fonts.

## Development and checks

```sh
npm run build       # TypeScript check + production build in dist/
npm run lint
npm test            # Coaching edge cases and ranking
npm run test:e2e     # Desktop demo, camera denial, mobile layout
```

Browser tests use locally installed Google Chrome. In a CI environment, run `npx playwright install chrome` first. The ordinary browser tests do not require a webcam or model downloads. Real camera and face detection should also be checked manually before a release.

Deploy `dist/` to a static HTTPS host after `npm run build`. No backend, API keys, or environment variables are needed.

## Structure

- `src/App.tsx`: studio layout, session controls, demo state.
- `src/components/CameraPanel.tsx`: camera lifecycle, drawing, status handling.
- `src/lib/vision.ts`: OpenCV and MediaPipe runtime, measurements.
- `src/components/AnatomyPanel.tsx`: animated anatomical reference.
- `src/lib/coaching.ts`: prioritized visual practice prompts.
- `src/components/CoachingPanel.tsx`: large ranked suggestions.

## References

- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)
- [OpenCV browser video processing](https://docs.opencv.org/4.13.0/js_video_display.html)
