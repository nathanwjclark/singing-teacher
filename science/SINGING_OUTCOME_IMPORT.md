# Native singing outcome → committed session update

`importSingingOutcome(rawDirectory, freshOutputDirectory, configPath)` reads an original native singing bundle, reuses `importNativePcm` and emits an executable `submit_outcome` command with the actual selected PCM. It does not submit automatically. A separate receipt retains original source intervals, hashes, sample clocks and limitations.

```sh
node --experimental-strip-types science/scripts/import_singing_outcome.ts RAW_CAPTURE NEW_PRIVATE_OUTPUT CONFIG_JSON
```

Configuration kind is `singing_outcome_import_configuration`, schema_version `0.1.0`. Required fields are `command_id`, `expected_version`, `participant_id`, `session_id`, `design_id`, `experiment_id`, `observation_id`, `artifact_id`, `pose`, `segment_index`, `frame_start_sample`, `source_manifest_sha256`, `recording_kind:"ordinary-singing"`, `contains_external_excitation:false`, and `evidence_kind` (`human-observation` or `development-fixture`). `session_state_artifact:{path,sha256,byteCount}` names an exact exported session state JSON (either state object or `{state:...}`) beside the configuration. Paths must be simple local filenames.

The bound session state must contain a committed design with matching version, target observation, selected experiment and pose. The importer derives the sample rate, crop and frame size from that design's frozen profile. It never substitutes a rate or resamples observed PCM. Current supported profiles are canonical44100/48000/96000Hz. Selection refers to a continuous native segment; gaps stay separate. If the native recording lacks the required frame or has a different rate, the command is null with an explicit reason. Clipped or otherwise invalid canonical frames are retained and excluded.

`observed_at` is copied **exactly from native manifest `created_at`**, which the native producer records as capture start. It must follow the design commitment and precede import time. This does not infer the selected sample's UTC from an uncalibrated sample clock. The source sample clock and offset remain in the receipt. UTC authenticity and physical device authenticity are not established by artifact hashes. If a device's timestamp precision cannot establish strict post-commit chronology, re-record after commitment; no timestamp is fabricated to make the gate pass.

Original manifest/media and derived PCM bytes are verified; configuration and session export hashes are retained. The output directory is fresh0700 and files0600. The emitted frame SHA256 is compared against prior evidence, and prospective IDs must be disjoint. Existing controller checks remain authoritative when executing the command, including stale versions, current model/design, time, source reuse and frozen extractor identity.

`singing-outcome-command.json` contains command IDs and parameters including actual frame samples, explicit frozen rate/start/size and native capture time. `singing-outcome-receipt.json` retains source bindings and whether submission is eligible; `submitted:false` remains until an external caller actually executes it. `native-pcm/` preserves the verified source-to-derived mapping. Configuration bytes are copied privately.

Development fixtures retain that receipt label and map to the existing update API's synthetic `engine-generated` source kind. Human recordings remain `human-observation`. There is no claim of measured execution controls, anatomical validation or synchronized camera geometry.

## Verification

```sh
OUTCOME_PYTHON=/path/to/science/.venv/bin/python PYTHONPATH=science/src \
node --experimental-strip-types --test science/scripts/import_singing_outcome.test.ts
```

The regression seals a real native design through `SessionController`/`JobService`, generates a subsequent original native PCM bundle, imports its exact frame, submits the emitted command and runs the actual native update. It checks a new model/evidence lineage and replay, plus wrong pose and pre-commit capture rejection. No prerecorded favorable outcome or hand-built update PCM bypass is used. Scientific evidence is synthetic and conditional; passing verifies connected execution, not human recovery.
