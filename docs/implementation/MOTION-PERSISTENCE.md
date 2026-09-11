# Durable motion evidence

The local server can retain the current MotionCapturePanel export and its exact
companion recording. This connects real evidence to durable review and replay;
it does not pass 2D estimates into calibrated physical or dynamic fitting.

Register alongside the other private routes, before the server's API fallback:

```js
import {createMotionRoutes} from './motion.mjs';
const handleMotion = createMotionRoutes({dataRoot,json});
// Inside the existing request handler:
if (await handleMotion(req,res,url)) return;
```

POST `/api/motion/import` accepts browser FormData with exactly two file parts:
`record` (original motion JSON, at most 4 MiB) and `media` (companion WebM/MP4,
at most 64 MiB). Reuse the original imported JSON file bytes when available.
The route uses the existing `validateLearningRecord`, then checks companion
SHA-256, byte length and the observation's provenance binding. It does not decode
or certify the media contents, hardware origin or tracking accuracy.

Success returns `{capture,reused}`. The receipt contains `id`, `observationId`,
`attemptId`, `recordSha256`, `mediaSha256`, `mediaByteLength`, `mimeType`,
`sampleCount`, `timingGaps`, `unsuccessfulMarkers`, `syncUncertaintyMs`, `missing`,
`status:"retained-byte-verified"`, `includedInPhysicalFit:false` and an explicit
interpretation. The original JSON is unchanged: missing points, gaps, unsuccessful
markers and unknown synchronization remain exactly as recorded.

GET `/api/motion/status` returns `{busy,capture,record}`, with both capture and
record null before the first import. GET `/api/motion/record?id=ID` and
`/api/motion/media?id=ID` download the original bytes after checking their hashes.
Original filenames cannot become filesystem paths or response-header values.

Files live in `.local-data/motion-captures/ID/` (or the configured data root),
with mode 0700 folders and 0600 files. The ID hashes both original JSON and media
digests. Repeating the same upload verifies and reuses the immutable files. An
atomic latest pointer preserves the previous capture if validation/import fails.
Interrupted uploads are retried from the app; no backend configuration is needed.
The endpoints require this Mac's localhost page, consistent with private capture
processing elsewhere in the app.

`node --test server/motion.test.mjs` passes an actual HTTP roundtrip: save,
duplicate upload, server restart, status restoration, exact original downloads,
unknown timing/missing landmarks/failed marker preservation, altered media and
malformed schema rejection, upload bound, private permissions and origin checks.
Test media is explicitly synthetic opaque data; this verifies byte persistence,
not video codec decoding. Real browser MediaRecorder testing remains separate.

## Optional conditional audio analysis

POST `/api/motion/analyze` takes `{requestId,captureId,pose,
containsExternalExcitation:false}`; pose is an explicitly declared vowel
`a/e/i/o/u`. The capture ID binds the exact original JSON and companion bytes.
The server pins the current scientific model before launching the bounded
`science/scripts/app_motion.py` runner; a changed entry model is rejected.
This operation does not update the baseline anatomy or session state.

GET `/api/motion/analysis?captureId=ID` returns `status`, `analysisId`, `error`,
`result`, `resultCurrent`, `currentModelId`, the current `analysisPolicy` (read from
the Python analysis `VERSION`) and decoder `availability`.
Statuses are `not-run`, `running`, `succeeded`, `failed`, or `interrupted`.
After a baseline change, a retained result has `resultCurrent:false` and remains
historical evidence. It must not be presented as a current-model estimate.
A stored result whose `analysisPolicy` differs from the current one has another
shape; the app names its version and asks for a new analysis instead of rendering
its time course. A request with the same ID is reused only for the current version.

FFmpeg/ffprobe are optional existing executables (`SINGING_FFMPEG` and
`SINGING_FFPROBE` can select paths). Missing decoding capability reports an
unavailable analysis while saving and replay remain usable. No install is
performed automatically. The runner reads at most 30 seconds and analyzes up to
120 disjoint quarter-second windows on an evenly spaced grid, with at most 108
native synthesis requests declared before any synthesis
([temporal comparisons](../../science/MOTION_PATH.md)).
The outer process group is terminated after four minutes; interrupted native
computation can be retried in the app because it has no model mutation.

Candidate articulation is conditional on a declared vowel, source assumptions
and the top three anatomy hypotheses in the frozen baseline snapshot's rank order; excluded support and
invalid windows remain explicit. The original 2D points never enter the physical
objective. Audio offsets and inferred states are not synchronized measured video
motion: audiovisual uncertainty remains unknown. The output cannot establish
actual JA, unique physiology or learned motor control.
