# Outcome continuation review

Scope: no-body local outcome route, resumable original-capture submission runner
and live-client cancellation. This review targets functional retry/state errors.

## Concrete runner findings

1. A worker may succeed before the user stops its session attempt. The controller
   correctly records `stopped_without_model_update`, but the initial runner read
   worker status and reported successful scientific update even though the model
   was never published. Final reporting must use the authoritative session job/
   design disposition and distinguish completed numerical work from model update.
2. `collect-command.json` initially froze one expected session version. A valid
   concurrent sensation/version change before collection could reject that command,
   and every retry would repeat the same permanently stale version. Retry must
   reconcile authoritative state and create a new immutable collection attempt
   only if the prior command was unaccepted and the job remains pending. Accepted
   idempotency identities must never be rebound.

Both findings were sent to the runner owner for bounded fixes and regressions.

## Reviewed paths and verification

Root's server shares one active job slot between initial fitting and outcomes,
reuses outcome identity for the same fixed configuration/source manifest, and
persists completion before releasing the slot. No blocking route issue was found.
The runner seals source/configuration identity before submission, preserves failed
preparation directories, reuses exact commands after lost replies, and verifies
completed local artifacts before returning cached completion.

Cancellation `d8a45f2` tracks only this pipeline's session and forward intents.
A lost forward submission reply is recovered with its stable key; remote jobs are
cancelled/collected and interrupted results retain recovery evidence. Independently
ran actual SIGTERM-client and lost-forward-reply cleanup tests: **2 passed in
4.16 seconds**. No additional cancellation blocker was found.

No stubs or fake job completion were found. The runner reuses the existing HTTP
backend, exact native importer and SessionController; cancellation reuses JobService
rather than introducing a parallel job registry. Root owns combined route tests.
Final runner acceptance follows verification of the two disposition/retry fixes.

## Fix verification

Runner `3936403` fixes both findings. Completion now uses the collected session
job disposition and result; a worker that finished before a stop is retained as
numerical evidence but reports `stopped_without_model_update`, no scientific
update status and `modelUpdated=false`. Collection reads current state and writes
separate `collect-vVERSION.json` attempts, retrying only explicit stale-version
responses. Previously accepted identities are not mutated.

Independently ran the four actual HTTP/native runner tests: **4 passed in 14.07
seconds**. They cover a lost accepted submission reply, interrupted preparation,
interruption after saving worker success, stopped-before-publication disposition,
completed replay, exactly one update job and changed-artifact rejection. A targeted
concurrent stale-collection regression was requested to cover the second fix's
specific retry branch.

The added `stale_collect` regression creates a prior recorded attempt and injects
valid subjective feedback before collection, forcing the actual HTTP stale-version
response. The runner retries collection and retains one update job. Independently
ran this new case: **1 passed in 4.64 seconds**. Combined with the earlier four-case
run, all five runner scenarios have passed independently. No remaining functional
blocker was found in the reviewed continuation and cancellation paths.
