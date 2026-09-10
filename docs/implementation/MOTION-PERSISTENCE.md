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
