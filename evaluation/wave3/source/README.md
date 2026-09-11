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

Scientific outcome: **inconclusive** under the frozen decision rule. Evidence source: synthetic. The committed results come from executing `run.py` at commit `d3a1d28` on a clean checkout: 374 of the 592 allowed native calls, about 2 minutes. Neither family reached 6 wins under both scores. The geometric glottis won 4 of 8 cases under the primary score and 6 of 8 under the pitch-excluded score; the two-mass model won 1 and 0. These counts are not balanced evidence: 4 of the 6 evaluable cases come from geometric generators, where geometric candidates reproduce the requested pitch almost exactly, and only one two-mass generator was evaluable. On that generator the primary score gives one tie and one geometric win by 0.055, just past the 0.05 margin; the pitch-excluded score gives two geometric wins, one because the two-mass selection had no usable prediction.

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

What this shows: at this finite support the native two-mass family did not predict unseen vowels, pitch and pressure better than the prescribed geometric glottis, including on audio from its own family, and its F0 control misses the requested pitch by up to 60 Hz. What it does not show: with one tract, three shapes per family and one evaluable two-mass generator, the data cannot support a negative conclusion, and nothing here concerns human singing. The `u`/220 Hz calibration trial at gain 2 removed half of the tract support; a later revision should be frozen with a calibration condition that both tracts can score, before any new target is synthesized.

Execution history: the first execution stopped before any held-out frame existed because of a harness identity bug (fixed in `a622381`); its one completed fit was not read. The second, complete execution at `a622381` gave exactly the case metrics and decision above with 376 calls. Review then found that its compact records lacked the extractor's failure reasons, so the harness was changed to keep them (`d3a1d28`, which also stops synthesizing held-out frames when no bank exists) and the comparison was executed a third time. Native synthesis and extraction are deterministic here: every case metric and the decision matched the second execution exactly. `protocol.json` never changed. `test_protocol.py` gained its results-consistency test after the second execution.

## Reading the results

Both the primary score and the pitch-excluded score are reported. Two-mass `F0` is a tension control, so its simulated pitch can miss the requested pitch; the pitch-excluded score removes that direct term, but periodicity, flatness and harmonic slope still depend on the pitch actually produced. An unscorable selected candidate counts as a failure for its family, never as a skipped case.

Generated native results do not establish anatomical uniqueness, tissue parameters, vocal-fold contact, calibrated probability or anything about human singing.
