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

## Concrete implementation review

Scope was narrowed per user steering to functional hackathon integration and
obvious credential/path mistakes; no additional production-hardening work is
required by this review.

Read complete session `e737c99`, HTTP `67c75e8`, singing import `c703205`, bundle
`728cdc8`, and root proxy/launcher implementations. The session persists job intent
before submission, recovers stable-key jobs, serializes state transitions, checks
versions, and prevents a stopped update from publishing a model. Missing/failed
scientific results and subjective sensations remain distinct. Snapshot pruning is
explicitly finite search support rather than posterior certainty.

HTTP uses the existing job allowlist and actual isolated native worker. Session
calls are serialized; proxy routes map to concrete handlers. The launcher shares
an ephemeral secret only through child environment, not status/browser output.
No additional transport blocker was found. Root owns its real proxy/launcher
integration tests, which are more relevant than adding redundant hardening tests.

Bundle import preserves original archive/phase bytes and hash identity, rejects
unsupported transport shapes, and leaves sequential/unverified-pose flags false.
Its next commands target existing individual importers; unpacking is not marked
analysis or fitting. Independently ran all 14 bundle tests: passed in 0.04 seconds.

### P1: singing import emitted a non-runnable session command

The initial importer emitted `ingest_calibration` without required `command_id`.
It also emitted session commands for normal 48/96 kHz full-length native segments,
while SessionController accepted only the 44.1 kHz quarter-second profile. These
commands would fail immediately despite fit eligibility. Both owners/root were
notified to supply command identity and align session ingestion with the existing
fitter's supported canonical windows/rates, or explicitly report unavailable
session ingestion. No hidden resampling or manufactured quarter-second source
record is appropriate.

### P2: importer budget exceeded the downstream fitter's accepted domain

The importer accepted `max_synthesis_calls` up to 4096, while the emitted direct
`fit_pcm` request only accepts up to 640. A budget above 640 could be emitted as
fit-ready and rejected before execution. Owner was asked to use the actual
consumer limit rather than a neighboring search API limit.

## No-stubs, wiring and minimality audit

No TODO, FIXME, placeholder, dummy, fake or stub logic was found by targeted scan
of the six new production modules. Session search/design/update dispatch calls
the actual existing scientific operations; transport does not simulate job
completion. Singing import reuses real native decoding and canonical extraction.
ZIP import does not silently run a simulated analysis. No new dependency was
introduced for the controller, transport, proxy or bundle parser. SQLite session
state is separate from the already-owned job ledger, with stable job identities
connecting them. Remaining session import mismatches above are functional wiring
issues and must be resolved before final acceptance.

Independent integrated HTTP verification: **5 tests passed in 3.93 seconds**,
covering actual native operations and session transport. No further transport
changes are requested by this review. The proxy keeps `engineAvailable=false`
while separately advertising configured transport and an authenticated health
route, so configuration alone is not mislabeled engine readiness.
