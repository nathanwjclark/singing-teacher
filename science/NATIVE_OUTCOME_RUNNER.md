# Resume a native outcome into the existing app session

```sh
SCIENCE_URL=http://127.0.0.1:8766 SCIENCE_TOKEN=<private-token> \
PYTHONPATH=science/src python science/scripts/run_native_outcome.py \
  --run SAVED_APP_RUN --source LATER_NATIVE_CAPTURE \
  --output PRIVATE_RESUMABLE_OUTCOME_DIRECTORY --config OUTCOME_CONFIG_JSON
```

The runner requires the existing authenticated loopback HTTP scientific owner. It never creates a replacement local session. The app run's `summary.json` supplies `sessionId` and default `designId`; current authoritative session state supplies the committed experiment, prospective target, frozen sample profile and version. The configuration requires:

```json
{"pose":"a","segment_index":0,"evidence_kind":"human-observation","participant_id":"local-participant","recording_kind":"ordinary-singing","contains_external_excitation":false}
```

Pose is explicitly declared, not assumed executed. Optional `design_id`, `experiment_id`, `observation_id` and `frame_start_sample` are checked against the committed design. Configuration and original native artifact bytes are bound to the output. The runner exports fresh state, computes all hashes and command IDs, and invokes `import_singing_outcome.ts`; users need not edit session JSON or generate hashes. The importer remains responsible for exact source cropping, native capture chronology, quality, immutable design bindings and supported rate. Observations are not resampled.

Outputs are private0700/0600. `inputs.json` freezes source/configuration identity; `session-before.json`, `import-config.json` and `import-N/` retain preparation; `prepared.json` freezes the exact submit command. `job.json`, `job-status.json`, `result.json`, versioned collect commands, `replay.json`, `summary.json` and `completed.json` retain execution and checksums. Existing files are immutable and atomically created. Restart with the **same arguments/output**. A stopped import preparation creates a new importer attempt directory while retaining earlier partial artifacts. An uncertain accepted submission retries its exact durable command ID. Successful workers still require authoritative session collection; a user-stopped outcome is reported as `stopped_without_model_update`, with `modelUpdated:false`, even if its worker completed. Version races during collection preserve old attempts and retry a new versioned collect command. No new update command is invented.

Completed restarts recheck all frozen artifacts and original source bytes. Changed inputs or corrupted results are rejected. A timeout is resumable; it does not launch a second update. The runner holds a nonblocking filesystem lock against concurrent execution of the same output. Separate outputs targeting a busy/stale session are rejected by that session's version and outstanding-job rules.

`summary.json` reports `status`, `sessionId`, `runId`, job/design/observation IDs when applicable, authoritative `modelId`, `modelUpdated`, `scientificStatus`, evidence source and `anatomyValidated:false`. Invalid capture returns `status:"ineligible"` and reasons without submission; scientific mismatch can still be a successfully executed research update. Credentials are read only from the environment and are not written to artifacts.

## Verification

```sh
PYTHONPATH=science/src python -m pytest science/tests/test_native_outcome_runner.py -q
```

Tests use actual authenticated HTTP, a sealed native48kHz design and a later original native PCM bundle. They execute import, worker update, collection and replay, with restart after interrupted preparation, lost accepted submit response, saved result before collection, and user stop after worker completion. They verify only one update job, model/evidence changes when applied, unchanged model when stopped, private permissions and corrupted-artifact rejection. All evidence is generated software evidence; human-device effectiveness is not claimed.

Final regression: **5 actual HTTP tests passed**, including a concurrent valid sensation event that causes a real stale-version collect response. The runner retains both versioned collect attempts and applies exactly one update. Summary fields `scores`, `missingReason`, `retainedHypotheses` and `previousHypotheses` expose exact numerical result values/counts; stopped outcomes have empty scores and null retained count because the worker result was not applied.
