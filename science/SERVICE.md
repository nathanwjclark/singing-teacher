# Local scientific job service

`singing_physics.service.JobService(root, max_workers=1, timeout_s=180)` runs real
native scientific jobs in isolated spawned processes. This is an executable local
Python service interface; B's KIT-01 wire schemas and HTTP adapter are separate
integration inputs. It does not expose a public unauthenticated network server.

Use a context manager. `submit(request, idempotency_key=...)` returns an immutable
job ID; `status`, `wait`, `result`, `cancel` and `replay` operate on that ID. An
identical retry returns the same job. Reusing a key with changed input is rejected.
Explicit replay uses a new key and new artifact directory, preserving the old run.

Requests contain `operation` and `parameters`. Supported operations:

- `forward`: Engine.export parameters, excluding its output path.
- `fit_transfer`: observation document, starts, seed, total spectrum budget.
- `fit_joint`: observation document, anatomy/articulation bounds, starts, seed,
  and per-model budget. See JOINT_INFERENCE.md for its synthetic evidence profile.
- `predict`: canonical frozen snapshot JSON, expected digest and predict arguments.
- `fit_dynamic`: timestamped attempt document plus the joint fitting bounds/budget.
- `fit_control`: retained attempts, anatomy model ID and profile freeze time.
- `control_predict`: canonical anatomy/control profile JSON, both expected hashes,
  cue/version/context/mode and a native call cap.
- `condition_prediction`: a frozen prospective artifact plus separately timestamped
  post-capture execution evidence. It produces a new conditional artifact and job.

Optional `session_id` and `model_id` must occur together. Register the current
model using `register_model`. Stale requests are rejected; model changes during
computation prevent successful publication. Reading a completed result after its
session advances also fails with `stale_model`, preserving its historical artifact
without making it eligible for the current session. Prediction snapshot model IDs
must match their job model IDs. Control-profile jobs must also name that anatomy
model; inferred control observations retain their upstream model binding. B owns model registration authorization and the
prospective evidence ledger.

SQLite holds requests, hashes, status and model bindings. Exclusive scheduler
ownership prevents two processes scheduling the same directory. Each child owns
one native engine; up to two concurrent workers are supported. Cancellation is
committed before terminating a child, and late output cannot become successful.
Parent-enforced deadlines and a child parent-liveness/deadline watchdog bound
orphaned compute. Restart marks interrupted jobs failed; it does not silently
retry or delete their evidence. Closing cancels unfinished jobs.

Artifacts are service-owned paths under `artifacts/<job-id>/`. The service writes
results and a hash manifest only after computation, then atomically commits
success. Reads verify the manifest and every artifact hash. Partial output from a
failed/cancelled worker is retained but cannot be retrieved as a successful result.
The local directory is a trusted workspace; hashes detect subsequent modification,
not a malicious writer who can also rewrite the database. Large media must remain
in B's artifact store; inline requests are capped at 2 MB.

Run `PYTHONPATH=.:science/src python -m pytest science/tests/test_service.py -q`
from the repository root with the installed scientific environment. Tests execute
real synthesis, deterministic replay, concurrent workers, failure, cancellation,
model invalidation, integrity checks, timeout, close and reopen paths.
