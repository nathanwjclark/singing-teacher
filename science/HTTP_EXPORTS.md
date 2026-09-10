# Verified native geometry over HTTP

Authenticated `GET /jobs/<32-hex-job-id>/exports` returns:

```json
{"job_id":"...","files":{"tract0.obj":{"base64":"...","byteLength":123,"sha256":"..."}}}
```

The `files` object contains exactly `tract0.obj`, `tract0.mtl`, `tract.svg`, `geometry.json` and `manifest.json`. These are the completed forward export's files; it does not expose raw microphone/depth media or caller-selected paths. Existing bearer-token, host and origin restrictions apply unchanged.

The endpoint first calls `JobService.result` to verify completion, model freshness and the full artifact manifest. It then verifies the manifest digest again, opens only fixed allowlisted files without following file symlinks, checks their hashes/byte lengths and returns base64. Raw exports are capped at 16 MiB total. Unknown jobs return 404; incomplete/cancelled or integrity-failed jobs return 409. Query strings and path selection are rejected. Non-forward jobs cannot export geometry through this route.

Clients must decode base64 and verify byte length/hash before writing private files. Original exported geometry is a model hypothesis, not a measured anatomical scan.

Two actual HTTP tests pass: native forward-job export matches its verified files byte-for-byte, tampering fails, and unknown/cancelled/path-bearing requests are rejected.
