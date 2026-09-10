# REP-01 — evidence export and local replay audit

Started from KIT-01 commit `51215a6` in `feature/rep01-reproducibility`.

`ReproducibilityPanel` accepts `records?: ContractRecord[]` and `trials?: TrialSummary[]` (structurally compatible with ACT-01 ExperimentTrial). Pass the complete retained ledger, including failed/cancelled trials. Forecast, commit, observation and evaluation records embedded in trials are included automatically. Duplicate IDs with conflicting content fail export instead of silently overwriting evidence. The panel only exports on click.

The versioned evidence manifest contains records, all trial histories/retry links, producer versions, declared solver budgets and a canonical SHA-256 digest. Unknown source commit, random seeds, actual solver calls and parallelism remain null. Media is not embedded. Keep separately downloaded recording files at their declared relative paths beside `evidence.json`.

Run from the repository, on Node 22.18+:

```sh
node --experimental-strip-types scripts/replay-experiment.ts /path/to/evidence.json evidence-report
```

Outputs `evidence-report.json` and `evidence-report.md`. Exit code 0 means valid metadata and referenced media, 1 means invalid evidence, and 2 means incomplete evidence. Missing separate files or external/blob URLs are distinguished from hash mismatches. Relative paths cannot traverse outside the manifest directory, including through symlinks. The audit validates KIT records, prediction digests and prospective evaluation ordering; retains unsuccessful attempts and reports their reasons.

This is an integrity replay, **not** re-execution of acoustic extraction, evaluation, fitting or synthesis. It does not produce fake scientific scores or claim benchmark reproduction. Lead A's executable engine, pinned configuration, genuine generated audio/geometry and seeds are still required for a scientific replay. Exporting a hash does not authenticate source data or prove commitment timing to a third party. EVAL-01 remains the score implementation; reported scores are retained, not independently recomputed here.

Focused checks:

```sh
node --experimental-strip-types --test scripts/replay-experiment.test.ts
npm run build
npm run lint
```

Two smoke tests cover failure retention, missing engine evidence, manifest tampering, artifact tampering, missing media, parent traversal and symlink escape. Build and lint passed. No CI/CD or package changes.
