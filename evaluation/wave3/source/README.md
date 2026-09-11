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

The output directory must be new. It receives full fit, bank and score artifacts. `results/` receives one compact record per generator (every candidate's calibration score, pitch-excluded score, requested and simulated F0 and failure reasons; every held-out alternative's status, reason and scores; bank hashes and coverage) and `report.json` with the paired case metrics, the decision and the provenance of the code that ran.

## Reading the results

Both the primary score and the pitch-excluded score are reported. Two-mass `F0` is a tension control, so its simulated pitch can miss the requested pitch; the pitch-excluded score removes that direct term, but periodicity, flatness and harmonic slope still depend on the pitch actually produced. An unscorable selected candidate counts as a failure for its family, never as a skipped case.

Generated native results do not establish anatomical uniqueness, tissue parameters, vocal-fold contact, calibrated probability or anything about human singing.
