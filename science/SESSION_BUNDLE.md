# Linked native session transport

`science/scripts/import_session_bundle.py` consumes the exact `CaptureZip.linkedSession` wrapper: flat `session.json` plus unchanged video/depth and sound ZIPs. The source schema is `singing-collection-session-1.0.0`, with `videoDepth`/`sound` path, SHA-256 and `byteCount` descriptors, declared video-depth then sound phase order, and false simultaneity/same-pose-verification/included-in-fit flags.

```sh
science/.venv/bin/python science/scripts/import_session_bundle.py \
  /private/session.zip /private/new-session-directory
```

It verifies the entire two-level package before writing output. Every phase artifact referenced by either original manifest is verified using its exact SHA-256 and byte count. The wrapper session ID and linked depth capture ID must agree with the probe manifest; sound stop reasons must agree. Unknown/extra artifacts, malformed schemas, path traversal, backslashes, nested paths, duplicate ZIP/JSON entries, symlinks/nonregular entries, encryption and unsupported compression are rejected. Reads enforce aggregate expansion and per-input limits (default 1 GiB), entry count and compression-ratio limits. Both original phase archives and the original session manifest are retained byte-for-byte under `originals/`.

Extracted `video-depth/` and `sound/` directories are ready for the existing B importers. `handoff.json` supplies their exact command argument vectors/required arguments and records source/session/phase hashes and stop status. Commands are **not executed automatically**. Participant assignment remains an explicit importer input. Directory permissions are 0700 and files 0600; an existing output is never overwritten. Validation failures leave no destination. The original input archive is read without following a symlink.

A partial sound stop such as `user-stopped` or `route-changed` is retained with `soundCompleted=false`, not replaced by a completed/synthetic capture. The current Swift wrapper requires both phase ZIPs; absent phases are invalid for this schema, while individual manifests can retain missing samples with reasons. The individual importers remain responsible for modality formats, raw sample timing, response usability and calibration checks.

Declared phase order does not establish calibrated cross-clock timing or the same anatomical pose. Separate capture IDs stay separate evidence. This utility does no analysis, acoustic/depth fusion, anatomy fitting, calibration substitution or synthetic fallback.

14 tests pass using analytical ZIP fixtures matching the Swift wrapper and nested original schemas: complete/partial stops, byte preservation/private permissions, ordering/identity/claim mismatch, artifact hashes, unexpected files, unsafe paths, duplicate entries/JSON, symlinks, size and expansion limits. These are transport tests, not phone or physiological validation.
