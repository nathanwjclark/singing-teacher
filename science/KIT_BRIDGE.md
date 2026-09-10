# Lead A scientific outputs into public KIT

The bridge uses Lead B's published contract validator, native-forward importer,
canonical PCM extractor, immutable prediction-commit primitives and independent
evaluator. It does not create another public schema or alter B-owned code.

```sh
SINGING_PYTHON=science/.venv/bin/python node --experimental-strip-types science/scripts/replay_kit_science.ts science/artifacts/kit-science-replay
SINGING_PYTHON=science/.venv/bin/python node --experimental-strip-types --test science/scripts/kit_science.test.ts
```

Run from the repository root with a certified native build. Use a new output path.
The Python executable may be absolute when sharing an existing scientific runtime.
Node 23.9 was used for verification.

## Adapter boundary

`kit_science.ts` exports:

- `readLocalJob(python, jobRoot, jobId)`: reads SQLite in read-only mode, preserving
  idempotency identity, original request bytes, current model binding and timestamps.
  Completed results require matching request, manifest and every artifact digest.
  Reading cannot start or cancel scheduler jobs.
- `jobRecord(job)`: maps local succeeded to KIT completed, retains failed/cancelled
  states, and marks a superseded session model blocked. Full native error/context
  remains in the adjacent `local-fit-job.json` because KIT v1 has no error-text field.
- `importNativeForward(root, source, capabilities, output)`: runs B's existing importer
  to validate native artifacts, convert its OBJ to metre-valued glTF, and extract
  canonical PCM windows. No duplicate WAV decoder or feature implementation exists.
- `candidateFromJointFit(job, native, expectedModelId)`: currently accepts genuine
  `fit_joint` results only. It rejects failed, stale, mismatched provenance or geometry
  outputs. Parameters in the declared anatomy search bounds are labeled inferred;
  remaining template geometry is fixed. Search bounds are not physiological limits.
  Solver configuration binds the exact local request hash. Dynamic articulation is
  not falsely exposed as stable anatomy.
- `forecastFromPcm(candidate, native, options)`: takes the first canonical PCM window
  and binds its prediction to the fitted candidate and source evidence. Only pitch,
  centroid, flatness and PCM dBFS are included. Direct tract-transfer dB is never
  reinterpreted as dBFS. Missing canonical features remain explicitly missing and
  cause independent evaluation to exclude an incomplete score.

The imported handoff objects and local job snapshots are intended to flow directly
between these adapters. Their model evidence is synthetic and their uncertainty is
not calibrated. They are not signed external assertions or proof of physical anatomy.

## Actual replay

The runner first executes A's existing real native joint-fit replay and verifies its
job artifacts. It exports the fitted geometry with fixed declared source/pose controls,
then uses B's importer/extractor to make a PCM forecast. A KIT commit is saved before
starting the target synthesis from the calibration generator's separate anatomy.
The target WAV is fresh and has a separately declared duration. B's evaluator scores
its canonical window without fitting or altering either model.

The fit uses 40 residual calls / 80 spectrum calls at the default integration budget.
The KIT forecast budget counts **one subsequent forward-synthesis call**. These are
separate stages and are reported separately; spectrum calls are not relabeled solver
calls. No matched baseline or comparative improvement is claimed.

The live experiment ledger deliberately requires human-held-out forecasts. Offline
synthetic replay therefore uses its same public `createPredictionCommit` and
`verifyPredictionCommit` primitives directly. It does not forge human provenance to
enter the live capture flow.

Output records include a public `job.json`, fitted `candidate.json` with relative glTF
reference, `commit.json`, a generation-start receipt, actual observation and audio
measurement, independent evaluation, and retained lineage-failure/missing-audio
evaluations. Original A request/result metadata and native exports accompany them.

The verified replay produces nonzero PCM errors because the small-budget fitted
geometry differs from generation truth. Those errors demonstrate a working adapter
and independent scoring path, not anatomical accuracy, human G4/G6/G7 evidence or
learning efficacy. Foreground camera/depth synchronization and metric motion claims
are outside this synthetic PCM bridge.
