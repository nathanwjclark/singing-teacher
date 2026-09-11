# Private loopback scientific HTTP transport

Run from a checkout with a certified native build and installed scientific package:

```sh
export SINGING_SCIENCE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
PYTHONPATH=.:science/src science/.venv/bin/python -m singing_physics.http_service --root science/artifacts/http-jobs --port 8766
```

The token stays in the local process environment. Startup output contains only host,
port and readiness. Configure the trusted desktop proxy with the same token; never
send it to browser JavaScript or a phone. The server binds only `127.0.0.1`, accepts
only its exact `127.0.0.1:PORT` Host header and rejects every browser Origin header.
The trusted server-side proxy must also enforce its own desktop-only boundary.

Every route requires `Authorization: Bearer TOKEN`, including health and capabilities.
Tokens must contain at least 32 nonwhitespace ASCII characters. Comparison is constant
time. There are no CORS permissions, token query parameters or unauthenticated routes.

| Method | Path | Body / result |
|---|---|---|
| GET | `/health` | Readiness and private transport version |
| GET | `/capabilities` | Real native capabilities read in an isolated startup child |
| POST | `/jobs` | `{request, idempotency_key}` → HTTP 202 with durable job status |
| GET | `/jobs/:id` | Current job status |
| GET | `/jobs/:id/result` | Integrity-checked completed result; HTTP 409 otherwise |
| POST | `/jobs/:id/cancel` | `{}` → whether cancellation occurred |
| POST | `/models` | `{session_id, model_id}` → register current model |

The job request is the existing `JobService` request; its explicit parameter whitelist
remains authoritative. Neither HTTP nor JSON can set filesystem roots, output paths,
Python/Node executables or arbitrary code. Job identifiers are 32 lowercase hex
characters. URLs with queries, percent encoding, fragments or absolute authorities
are rejected. This is an internal A transport, not a replacement for B's public KIT
artifact schemas.

POST requests require JSON objects, one Content-Length and application/json. The
maximum body is 2,000,000 bytes, configurable only downward at startup. Duplicate JSON
keys, nonfinite constants, transfer encoding and incomplete bodies are rejected.
Connections have a ten-second socket timeout; responses close the connection and
include no-store and nosniff headers. Routine request logging is disabled because
routes may identify private research records.

Errors use JSON: 400 malformed requests, 401 missing/invalid token, 403 Host/Origin
rejection, 404 absent route/job, 409 stale model or unavailable/conflicting result,
413 excessive body and 503 local I/O failure. Failed numerical jobs remain durable
failed records and are not converted into successful results.

HTTP handler threads never open a native Engine. Startup capabilities use a spawned
child with a timeout; numerical jobs use JobService's isolated worker processes.
Server teardown closes the job scheduler and cancels unfinished work according to
its existing lifecycle rules.

Verification: `PYTHONPATH=.:science/src science/.venv/bin/python -m pytest
science/tests/test_http_service.py -q` exercises actual HTTP/native synthesis,
capabilities, authentication, Host/Origin restrictions, size/schema/path rejection,
idempotency, stale models, cancellation and immutable result retrieval.

Session routes use the existing `SessionController` and its versioned commands:

- `GET /sessions/:id` returns `execute({action: "state"})`.
- `GET /sessions/:id/replay` returns its integrity-checked event history and, for format 2 events, the state nodes they name (`science/SESSION.md`, Ledger format).
- `POST /sessions/:id/commands` passes the JSON command to `execute`.

Session IDs contain only letters, digits, underscores and hyphens (1–160 characters).
They never become arbitrary filesystem paths. All sessions share the controller's
private database under the startup job root. Controller commands are serialized by
this process; its SQLite transactions preserve durable ordering. Mutation commands
require exact action fields, `command_id` and `expected_version`; stale versions
return HTTP 409. Controller reads may resume previously persisted job submission
intent as part of its recovery semantics. Numerical operations remain worker jobs.
