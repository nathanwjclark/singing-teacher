# Frozen source-family comparison

This directory compares the prescribed geometric glottis (`PS`) with VocalTractLab's native two-mass model (`XB`, `XT`, `EAA`, `DF`) at equal native synthesis budgets, on held-out vowels, pitch and pressure. Evidence source: synthetic (native generator). No recordings of people, API credentials or paid calls are used.

`protocol.json` fixes everything before the run: 2 tract options × 3 shapes per family = 12 candidates (6 per family), calibration on vowel `a` (150 Hz requested) and `u` (220 Hz requested) with 72 fit calls (36 per family, cap 96), two held-out banks (`e` and `o`, 190 Hz requested, 8,500 dPa) of 36 alternatives each (18 per family, cap 48), and four off-grid generators, two per family. The decision rule, tie margin and metrics are declared there. `protocol.json`, `run.py` and `test_protocol.py` were committed before `run.py` was first executed; the protocol's `pilot_disclosure` lists every synthesis made before that commit.

The run uses the production pipeline only: `fit_phonation`, `forecast_phonation_bank` and `score_phonation_bank`. Each candidate's F0 control is the pitch measured in the generator's calibration frame, as in the app. Held-out generator frames are synthesized only after both banks are frozen, and scoring performs no synthesis.

## Running

From the repository root:

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest evaluation/wave3/source/test_protocol.py -q
PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/source/run.py --output /tmp/singing-wave3-source-1
```

The output directory must be new. It receives full fit, bank and score artifacts. `results/` receives one compact record per generator (every candidate's calibration score and pitch-excluded score in all three comparison families, requested and simulated F0 and the extractor's reason for every unavailable descriptor; every held-out alternative's status, reason, scores and prediction descriptor reasons; bank hashes and coverage) and `report.json` with the paired case metrics, the decision and the provenance of the code that ran.

## Results (revision 1)

Scientific outcome: **inconclusive** under the frozen decision rule. Evidence source: synthetic. The committed results come from executing `run.py` at original commit `d3a1d28` (see "Commit provenance") on a clean checkout: 374 of the 592 allowed native calls, about 2 minutes. Neither family reached 6 wins under both scores. The geometric glottis won 4 of 8 cases under the primary score and 6 of 8 under the pitch-excluded score; the two-mass model won 1 and 0. Read these counts only together with the main limitation below.

### Main limitation: the frozen F0 rule favours the geometric glottis

`candidate_f0_rule` gives every candidate the pitch measured in the generator's calibration frame as its `F0` control. That is right for the geometric glottis, whose `F0` is the output pitch, but for the two-mass model `F0` sets tension, not pitch. Even the true two-mass shape therefore cannot reproduce its generator's pitch. For two-mass-1 the generator was asked for 150/220 Hz and produced 147.0/214.3 Hz; the nearest grid candidate `t0-two_mass-0`, given 147.0/214.3 Hz, produced 146.0/220.3 Hz, while geometric candidates matched within 0.05 Hz. So on a two-mass generator `t0-geometric-0` won calibration on the primary score (0.055 against 0.120), while the pitch-excluded score preferred two-mass (`t0-two_mass-1` 0.024 against `t0-geometric-0` 0.074). The rule was frozen before the run, so this is not a post-hoc choice, but it biases the primary score against the two-mass family in every case. Together with the generator imbalance (4 of the 6 evaluable cases come from geometric generators; on the one evaluable two-mass generator the primary score gives a tie and a geometric win by 0.055, and the pitch-excluded score two geometric wins, one because the two-mass selection had no usable prediction), the win counts do not show which family predicts held-out audio better.

Design input for revision 2, to be frozen before any new target is synthesized: give two-mass candidates an F0 (tension) axis within the budget, or set every candidate's `F0` to the generator's requested task pitch instead of the measured pitch; use a calibration condition that both tract options can score (`u` at 220 Hz with gain 2 fell below the analysis floor on tract 1); use more than one evaluable two-mass generator; and count failures under both scores (see "Failure counting").

| Generator | Vowel | Selected (geometric / two-mass) | Geometric | Two-mass | Two-mass − geometric | Winner | Pitch-excluded geometric | Pitch-excluded two-mass | Winner | True-family rank | Nearest-grid rank | Unscorable alternatives (geometric / two-mass, of 6) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| geometric-1 | e | t0-geometric-0 / t0-two_mass-0 | 0.000 | 0.195 | +0.195 | geometric | 0.000 | unscorable | geometric | 1 | 2 | 3 / 4 |
| geometric-1 | o | t0-geometric-0 / t0-two_mass-0 | 0.025 | 0.393 | +0.368 | geometric | 0.033 | 0.299 | geometric | 1 | 1 | 3 / 3 |
| geometric-2 | e | t0-geometric-0 / t0-two_mass-0 | 0.002 | 0.212 | +0.210 | geometric | 0.003 | 0.054 | geometric | 1 | – | 3 / 4 |
| geometric-2 | o | t0-geometric-0 / t0-two_mass-0 | 0.332 | 0.086 | −0.246 | two-mass | 0.442 | 0.850 | geometric | 2 | – | 3 / 3 |
| two-mass-1 | e | t0-geometric-0 / t0-two_mass-0 | 0.068 | 0.033 | −0.035 | tie | 0.036 | unscorable | geometric | 1 | 1 | 3 / 4 |
| two-mass-1 | o | t0-geometric-0 / t0-two_mass-0 | 0.126 | 0.180 | +0.055 | geometric | 0.160 | 0.586 | geometric | 3 | 3 | 3 / 3 |
| two-mass-2 | e | – / – | unscorable | unscorable | – | none | unscorable | unscorable | none | – | – | 6 / 6 |
| two-mass-2 | o | – / – | unscorable | unscorable | – | none | unscorable | unscorable | none | – | – | 6 / 6 |

Discrepancies are the held-out score of each family's calibration-selected joint candidate against the same frame (lower is better; tie margin 0.05). Under the pitch-excluded score the two-mass selection is `t0-two_mass-1` (`XB=XT=.015`, `EAA=.005`) for geometric-1 and two-mass-1 and `t0-two_mass-2` for geometric-2. `t0-two_mass-1` has no usable prediction for vowel `e` (fewer than four harmonics within 40 dB of the strongest), so 2 of the 6 evaluable pitch-excluded two-mass selections are unscorable. Every primary selection was scorable.

Calibration did not recover source shape. The geometric selection is `t0-geometric-0` (PS −0.2) for all three evaluable generators, including geometric-2 at PS +0.13, for which PS +0.2 had the worst geometric calibration score (0.037 against 0.018). A held-out discrepancy near zero (geometric-1, `e`) therefore does not show that the generating shape was found; at this support the four descriptors separate source shapes weakly.

Failures and missing evidence, all counted and none replaced. Each reason below is the extractor's own reason, kept per descriptor in `results/<generator>.json` (`descriptor_reasons`, `prediction_descriptor_reasons`, `observation_descriptor_reasons`):

- **Tract option 1 was unscorable for both families.** Every `t1` candidate's `u` calibration prediction, joint and fixed-source, was "Signal below declared -60 dBFS analysis floor" at gain 2 (36 predictions). Those 6 of 12 candidates (3 per family) left calibration unscorable and were frozen as unavailable in every bank, so the comparison ran on tract option 0 only. Declared nearest-grid candidates on tract 1 (geometric-2, two-mass-2) have no rank.
- **two-mass-2 had no fit.** Its own `u` calibration frame had no harmonic slope ("Fewer than four harmonic amplitudes within 40 dB of strongest harmonic"), so `fit_phonation` returned `insufficient-quality` without synthesis, no bank was frozen and no held-out frame was made. Both families take a failure for both of its cases (2 failures each).
- **F0 mismatch.** Over every synthesized calibration prediction and bank alternative in all three comparison families (162 per family with a measured pitch; 18 per family synthesized without one; 36 per family never synthesized because their candidate was unscorable at calibration), geometric simulated pitch differs from the requested F0 by 0.04 Hz in absolute value on average (range −0.09 to +0.10 Hz). Two-mass differs by −8.7 Hz on average, 11.0 Hz in absolute value, range −60.3 to +14.5 Hz. The largest misses are on the long tract (`t1-two_mass-1` at vowel `a`: 86.7-93.5 Hz simulated for 147-150 Hz requested), so two-mass pitch depends on the tract as well as the shape.

What this does not show: with the F0 rule above, one usable tract, three shapes per family and one evaluable two-mass generator, the data support neither a positive nor a negative conclusion about the two-mass family, and nothing here concerns human singing.

### Failure counting

The protocol counts an unscorable selected candidate as a failure under every score. The committed `report.json` was produced by a `decide()` that counted failures from the primary score only: geometric 2, two-mass 2. Counted under both scores, the pitch-excluded failures are geometric 2 and two-mass 4, because the two unscorable pitch-excluded two-mass selections appear only as geometric wins in the stored decision. The outcome stays inconclusive either way. `run.py` now counts failures under both scores for future runs; `report.json` is not rewritten, and `test_protocol.py` checks both counts against the stored cases.

### Execution history

The first execution stopped before any held-out frame existed because of a harness identity bug (fixed in original commit `a622381`); its one completed fit was not read. The second, complete execution at `a622381` gave exactly the case metrics and decision above with 376 calls. Review then found that its compact records lacked the extractor's failure reasons, so the harness was changed to keep them (original commit `d3a1d28`, which also stops synthesizing held-out frames when no bank exists) and the comparison was executed a third time. Native synthesis and extraction are deterministic here: every case metric and the decision matched the second execution exactly. `protocol.json` never changed. `test_protocol.py` gained its results-consistency test after the second execution.

### Commit provenance

`report.json` and the text above name the commits where the protocol was frozen and the comparison ran. Those commits are not ancestors of this branch: the branch was later rebased twice onto `claude/wave3-probe`. The originals are preserved under two tags that are pushed alongside this branch: `wave3-source-run-original` (the original chain, `2591001` to `5359e8d`, including the executed commits `a622381` and `d3a1d28`) and `wave3-source-before-restack` (the same work after the first rebase). Each original maps to a commit on this branch, named by subject, whose `evaluation/wave3/source/` tree and source-adapter files are byte-identical. Tree and blob ids do not change when a branch is rebased, so check with `git rev-parse <commit>:<path>`. The rest of `science/src/` differs because the base branch changed other modules.

| Original commit (tag) | Role | Commit on this branch (subject) | Identical `evaluation/wave3/source/` tree | Identical `phonation.py` blob |
|---|---|---|---|---|
| `2591001` (`wave3-source-run-original`) | Protocol, harness and integrity tests frozen before any run | "Freeze the equal-budget source-family comparison before running it" | `a5b20be6d55736ab5b65c29b7550bbc18a8d469f` | `511d85544f6fef5463f098c516a270e3e463e5ed` |
| `a622381` (`wave3-source-run-original`) | Harness identity fix; the second execution ran here | "Bind calibration frames to their trial ids in the source comparison harness" | `48ad0a653452d05f9ba4dfbdc20e8c88864725b3` | `511d85544f6fef5463f098c516a270e3e463e5ed` |
| `e578181` (`wave3-source-run-original`) | Second-execution results | "Record the source-family comparison: inconclusive, leaning geometric" | `0476020f505cf7278fc8b7b97fc690658e4bb51d` | `511d85544f6fef5463f098c516a270e3e463e5ed` |
| `d3a1d28` (`wave3-source-run-original`) | Harness keeping failure reasons; the committed results ran here (`report.json` provenance) | "Keep failure reasons and all comparison families in the comparison records" | `fd5e6e88e4a3a67fe3932b40f181d3a8b67034a3` | `9e63e3675537644040ad4013c1ab9974ec6e3615` |
| `5359e8d` (`wave3-source-run-original`) | Committed results and report | "Replace comparison records with the re-execution that keeps failure reasons" | `72a1af23c22291dcd788bc69ed2f67c8337ad1e8` | `9e63e3675537644040ad4013c1ab9974ec6e3615` |

At all five, `engine.py` is blob `760be92941fe75b2f7431bace8284350a8b1b5fc`, `pcm_inverse.py` is `bc5e4727367e3bff00d76902016373d50ba20ae0` and `science/scripts/phonation_bridge.ts` is `193a6b1b8ddab417fafee2458197c98ceb45e9a8`, identical on the matching branch commits. The ordering evidence is in the original commit and run times: `2591001` was committed at 04:41:03 UTC and the complete second execution started at 04:43:06 UTC; `d3a1d28` was committed at 05:05:29 UTC and the third execution started at 05:05:34 UTC (`report.json` `started_at`). The subject "inconclusive, leaning geometric" predates the F0-rule finding; the "Replace comparison records…" commit and this README supersede its framing.

## Code changes since the run

`report.json` pins the SHA-256 of the adapter, its dependencies and every extractor file the run used. `test_protocol.py` fails unless each file that now differs has a row here with both the recorded and the current hash (first 12 hex digits), so a later edit to a listed file also needs a new row. The results were not re-executed after these changes.

| File | SHA-256 recorded with the run | Current SHA-256 | Change and effect on this run |
|---|---|---|---|
| `src/contracts/probes.ts` | `2c9001d74f1e` | `825b09b37dab` | Changed on `claude/wave3-probe`, the base branch. Hashed because every contract file is in the extractor signature; the phonation descriptor code (`src/phonation/measure.ts`, `src/lib/audio.ts`, `src/phonation/types.ts`) is unchanged. |
| `science/src/singing_physics/engine.py` | `180e1d6c1779` | `d2801d1b0177` | The speaker file is read once at start-up and every native load, including the certified one, uses those verified bytes through a private temporary copy; stale copies from killed processes are removed on start. The loaded bytes are the same as in the run, and native tests assert bit-identical synthesis after restoration. |
| `science/src/singing_physics/phonation.py` | `58ed517ccc63` | `d0f42d19e23d` | `source_capability` uses the engine's verified speaker bytes. `forecast_phonation_bank` rejects banks whose alternatives were fitted with different reference gains or whose declared gain differs from the fitted one, and does not commit a mixed-family bank that a deadline left partly covered. The run used gain 2 for every fit and bank and had no deadline or cancellation, so none of these rules applies to it. |
| `science/src/singing_physics/pcm_inverse.py` | `2e0a3fb5a1ed` | `93feea60494d` | Changed on `claude/wave3-spectral`, which follows this branch in the PR stack. `fit_pcm` takes an explicit scoring objective (coarse, the objective this comparison used, stays the default), candidates that differ only in gain share one synthesized waveform with identical scores, and the extraction bridge reports its own hash. None of these changes the coarse discrepancy of a given frame. `claude/wave3-motion` then moved the per-feature scale rule into `feature_scale` without changing behaviour. |

## Reading the results

Both the primary score and the pitch-excluded score are reported. Two-mass `F0` is a tension control, so its simulated pitch can miss the requested pitch; the pitch-excluded score removes that direct term, but periodicity, flatness and harmonic slope still depend on the pitch actually produced. An unscorable selected candidate counts as a failure for its family, never as a skipped case.

Generated native results do not establish anatomical uniqueness, tissue parameters, vocal-fold contact, calibrated probability or anything about human singing.
