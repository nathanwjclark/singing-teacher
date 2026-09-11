# Frozen independent wave-three evaluation

This directory compares the production coarse objective (`canonical-coarse-v1`) with the multi-resolution spectral objective (`multires-log-spectrum-v1`) on **the same native PCM predictions and observation frames**. Both objectives therefore use the same native synthesis budget. Generated truth anatomy is absent from the candidate grid. Evidence source: synthetic (native generator); no recordings of people or API credentials are used.

## Revisions

- **Revision 1** (`protocol.json`, frozen before the spectral code was reviewed): four anatomy/source candidates, calibration vowels a and i, held-out vowel e, eight stress cases, 21 native calls. It was executed once by `run.py` from harness commit `b442c1e` on `codex/wave3-eval`; this branch carries the identical file in the commit "Add bounded prospective native corpus comparison harness". Its results are in `results/first-*.json` and stay unchanged.
- **Revision 2** (`protocol-2.json`, committed before it was run): responds to review of revision 1's method. Per-vowel gains come from a declared rule over the frozen prediction bank, so no candidate prediction clips by construction; candidates within a declared margin of 0.1 standardized RMS count as tied; the prediction bank is checked for level jumps between neighbouring anatomies before any target exists; both objectives are scored by the production `fit_pcm` per-trial scorer (`score_prediction`, `candidate_discrepancy`); a near-duplicate case tests ambiguity; there are three held-out vowels (e, o, u). Targets are new, so no revision-1 observation is reused, and nothing was tuned on revision-1 held-out scores. Its decision rule is fixed in the protocol.

  The revision-2 report predates two later harness additions and does not have them: a hash of every scoring module (`scorer_implementation_pin`, which covers `pcm_inverse.py`) and the commit plus dirty-worktree flag of the executing checkout. Runs from this harness now write both to `source-state.json` and the report.

## Commit provenance

The result files name the commits where the work was originally frozen and run. Those commits are not ancestors of this branch: the work was carried over by cherry-pick and later rebased. The originals are preserved under refs that are pushed alongside this branch: the lane branches `codex/wave3-eval` and `codex/wave3-spectral`, and the tag `wave3-spectral-before-rebase-cb0e6e7` for the revision-2 execution commit. Each original maps to a commit on this branch, named by subject, whose relevant Git tree or file object is identical. Tree and blob hashes do not change when a branch is rebased, so check with `git rev-parse <commit>:<path>`.

| Original commit (ref) | Role | Commit on this branch (subject) | Identical object |
|---|---|---|---|
| `761f8ef` (`codex/wave3-eval`) | Revision-1 protocol frozen | "Freeze independent wave-three scientific stress protocol" | `evaluation/` tree `1f48ddabbb84f87acf898bf826d3a6f9ca38a9b6` |
| `b442c1e` (`codex/wave3-eval`) | Revision-1 harness | "Add bounded prospective native corpus comparison harness" | `evaluation/` tree `860ac3554644bdd198408ccd2714dc9904204975` |
| `8c68f60` (`codex/wave3-spectral`); revision 1 ran at its duplicate `38a3e45` (`codex/wave3-eval`) | Spectral module | "Add versioned multi-resolution spectral fitting and prospective scoring" | `science/src/` tree `527de1c468a42106d72ada532595b2ccfcc306a8` (same for all three) |
| `57907c0` (`codex/wave3-eval`) | Revision-1 results | "Record first independent spectral stress results without outcome tuning" | `evaluation/wave3/results/` tree `382546795a23933efc1877aa59f6171550bc9a64` |
| `9c951b0` (tag `wave3-spectral-before-rebase-cb0e6e7`) | Revision-2 protocol and harness, committed before its only run; the run executed at this commit | "Freeze independent evaluation revision 2 before running it" | `evaluation/` tree `c792ad2dca541b50dbcc45285cb5b654b0873273` and `science/src/` tree `982a83a558975674594b8777ee90ff41ab7c7328` |

The ordering evidence (protocol committed before results) is in the original commits' dates: `9c951b0` was committed at 03:59:34 UTC and the revision-2 prediction bank was written at 03:59:43 UTC. The re-created commits on this branch have later commit dates because of the cherry-pick and rebase.

## Design inputs for a future revision 3

Revision 2's result has little power, for two reasons that a third revision should address before it is frozen and run:

- All five misses per objective are vowel-e pairs where calibration kept anatomy 0, whose e prediction is below the −60 dBFS canonical gate. Those pairs count as evaluable misses, so the comparison reduces to a choice between two anatomies. Revision 3 should count a pair as unscorable when any calibration-retained candidate's held-out prediction is unscorable, and report it with the unscorable pairs.
- One absolute tie margin (0.1 standardized RMS) is applied to both objectives, whose numerical scales are not comparable. Revision 3 should declare a margin per objective, derived before the run (for example from repeated-noise calibration frames), not from held-out scores.

## Running revision 2

From the repository root:

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest evaluation/wave3/test_protocol.py -q
PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/run.py --output /tmp/singing-wave3-independent-2
```

The output directory must be new. The hard limit is 40 native calls: 5 bank members × 5 vowels, then 3 truth groups × 5 vowels. The prediction bank (with gains and level checks) is written first. Calibration rankings are written before any held-out truth frame is synthesized. The report retains every candidate's held-out score per vowel, the calibration retained set, the held-out retained set (scoring only), regret, level differences, failures and extraction counts. Raw PCM files, SHA-256 hashes, native control receipts and the objective policy are written next to them.

## Reading the results

Compare hits, regret, coverage and ambiguity within each objective. The two objectives use different numerical scales, so a smaller spectral number than a coarse number is not an improvement claim. Per-resolution centering and bounded level/tilt profiling trade sensitivity against nuisance invariance; fitted nuisance values are diagnostics, not measurements of capture response or source physiology. The coloration case applies a causal low-pass with initial rest to the finite frame, so it includes that boundary transient.

Generated native success does not validate anatomical uniqueness, physical microphone calibration, posterior coverage, human vocal-fold contact or learning efficacy. See `docs/physiology/wave3-review.md` for the review criteria and recorded findings.
