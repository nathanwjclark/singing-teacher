# Session harness independent review

Baseline `40843a7`; scope is the durable scientific session, authenticated local
transport, verified native singing/session-bundle import and Node proxy wiring.
No numerical recovery experiment is repeated for this integration review.

## Existing local server constraints

`server/local.mjs` serves desktop and optional phone/LAN listeners through the
same handler. Its host allowlist includes LAN addresses and local hostname;
pairing bearer checks apply only to pairing routes. Its browser-origin check
applies only to POST and compares host, not the full origin. These constraints
must not be mistaken for authorization over new private scientific endpoints.

New proxy acceptance: explicit desktop capability on reads and writes; safe
loopback-only upstream; no arbitrary host/path forwarding; bounded JSON and
response bodies/timeouts; no upstream bearer token in public status or frontend
assets. Engine availability must reflect actual authenticated health, not merely
configured environment variables. Browser cross-origin mutations must be rejected
before state changes. Phone pairing is not authority to operate arbitrary local
research sessions or access private files.

## Checks sent to implementation owners

- Session transitions use durable revision checks and advance only after verified
  successful job results. Concurrent stop/update cannot publish a stale model.
  Changed requests cannot reuse an idempotency key. Pending/failed/cancelled
  attempts survive restart; subjective feedback is stored outside numerical fit.
- HTTP transport binds loopback, validates Host, authorizes every private request,
  bounds input, rejects cross-origin browser writes and avoids exposing arbitrary
  filesystem access or executable/configuration overrides.
- Native singing import retains source bytes, exact interval and clock provenance;
  pose is explicit, probe-containing audio is not singing data, and selection does
  not silently discard unsuccessful measurements or manufacture independence.
- ZIP import rejects traversal, absolute paths, symlinks, duplicate normalized
  names and excessive expansion/count. Extraction is private and fresh. Wrapper
  metadata cannot overwrite original evidence identity. Missing modalities remain
  explicit rather than replaced by synthetic artifacts.

Implementation findings, no-stubs/wiring/minimality audit and independent test
results will follow the concrete owner revisions.
