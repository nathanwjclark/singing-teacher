# Current Lead A integration status

Lead B's contracts, canonical PCM extractor, native acquisition/import and
independent scoring are received through main `55ff619`. New consumers are in
[PCM_INVERSE.md](PCM_INVERSE.md), [KIT_BRIDGE.md](KIT_BRIDGE.md),
[NATIVE_GEOMETRY.md](NATIVE_GEOMETRY.md), [DEPTH_RECTIFICATION.md](DEPTH_RECTIFICATION.md)
and [FROZEN_CONTROL.md](FROZEN_CONTROL.md).

Native forwards now start in the same 13-parameter reconstructed geometry basis
used for fitted candidates. Previously detailed default JD3 geometry differed
from reapplying its reported parameters (~1.24 dB in one /a/ comparison).
New provenance includes `geometry_basis`; older snapshots lacking it must be
regenerated, never silently relabeled. The native binary is unchanged.

The initial foundation results below are retained as historical evidence. The
parallel expansion is now implemented and reviewed in PR #3:

| Module | Executable evidence |
|---|---|
| Forward | Certified native binary; repeatable audio/SVG/tube/OBJ export and lip markers |
| Geometry/fusion | Calibrated points -> source-defined lip measurement -> synchronized joint likelihood |
| Inference | Shared anatomy/per-trial articulation; global/local budget; fair baseline; applied controls |
| Forecast | Content-addressed frozen candidates -> actual native transfer predictions |
| Service | Real spawned jobs, idempotency, replay, stale-model rejection, cancellation and watchdog |
| Cross-module replay | Native observations -> fitting job -> frozen model -> prediction job -> identical bytes |
| Motion/control | Head-registered trajectories -> dynamic fit -> model-bound empirical control profile |
| Control-aware replay | Prospective native mixture -> later synthetic measurement -> separate conditional forecast |

The final assembled revision 6 suite passed **132 tests** with `-W error`
(152.39 seconds), and a fresh native build passed all **21 C++ tests**. The native anatomy patch also passed the 21-test
AddressSanitizer suite during the foundation milestone; subsequent changes are
Python integrations around the same native source. Duplicate geometry and held-out relabeling regressions are included. Revision 6
dynamic motion/control extensions are included in that final suite. The standalone
revision 6 replay also completed: nine frames, three independent control attempts,
a prospective artifact, a later synthetic observation and a separate conditional
artifact with unchanged prospective replay bytes.

See [JOINT_INFERENCE.md](JOINT_INFERENCE.md) for improved but still ambiguous joint
recovery and [MISMATCH.md](MISMATCH.md) for all three fixed-budget perturbation
attempts. Low fitting error does not establish correct anatomy. Measured-audio
comparisons now use B's canonical PCM extractor under explicit finite source/gain
hypotheses. Real-phone calibration/correspondence and human-anatomy recovery
remain unvalidated.

The complete ownership and unmet acceptance gates are in the repository
[coordination record](../docs/coordination/lead-a-handoff.md). The Python job/replay
interfaces are executable internal profiles, not a competing KIT-01 wire contract.

---

# Scientific implementation evidence and handoff

Verified on macOS arm64 with Python 3.12. This is Person A's first executable
foundation milestone under the [two-person plan](../docs/physiology/two-person-execution-plan.md).

## Implemented

- Pinned, patched VocalTractLab build with 13 global anatomical controls.
- Validated process-local Python adapter and executable CLI.
- Forward audio, sagittal contour, tube geometry and transfer function exports
  sharing parameter records and content hashes.
- Two-parameter inverse fitting across three known template vowel poses, using
  bounded global search and local refinements. Other anatomy is fixed.
- Hidden-truth scoring after fitting, including a held-out vowel and a fixed
  anatomical template baseline.

## Checks run

- `python science/scripts/build_native.py`: 21/21 native tests passed.
- `python science/scripts/build_native.py --sanitize`: 21/21 native tests passed
  under AddressSanitizer, including repeated anatomy-update/close regression.
- `python -m pytest science/tests -q`: 7/7 passed after the final native build.
- `git diff --cached --check`: passed.

The commands use the virtual environment described in [README](README.md).
The source submodule remains unmodified. The versioned patch fixes an upstream
out-of-bounds tongue-parameter write; the investigation records the reproduction.

## Controlled results

Both cases fit hard-palate length and pharynx length from direct synthetic
transfer magnitudes for a/i/u; e is held out. Units below are centimeters and dB.

| Seed / observation noise | Palate absolute error | Pharynx absolute error | Calibration RMSE | Held-out RMSE | Fixed-anatomy calibration RMSE |
|---|---:|---:|---:|---:|---:|
| 7 / 0 dB | 1.85e-9 | 2.49e-9 | 8.71e-8 | 6.26e-8 | 51.17 |
| 11 / 0.1 dB standard deviation | 0.000223 | 0.000123 | 0.0922 | 0.0156 | 44.63 |

Reproduce with `singing-physics benchmark --seed 7 --output <fresh-directory>`
and `singing-physics benchmark --seed 11 --noise-db 0.1 --output <fresh-directory>`.
Each command writes observation-only input, fit diagnostics, separate scoring
truth and fitted forward artifacts. Small numerical differences across machines
are possible. Noise is independent Gaussian perturbation of spectral dB values,
not a recording-room or microphone noise model.

These are two controlled cases, not a general success rate. The same simulator
generates and fits data, articulation is known, and source/capture effects are
absent. The tiny errors establish numerical recovery in this setup, not anatomical
measurement precision on people. An earlier local-only optimizer failed; the
implemented global search resolves these tested cases but does not prove global
identifiability. Candidate spread is not a calibrated uncertainty distribution.

## Original foundation handoff (superseded above)

1. **A:** add unknown excitation, capture response and bounded per-trial
   articulation; keep global anatomy shared across trials. Test whether competing
   parameter sets explain the same observations.
2. **B:** implement synchronized audio/RGB/depth acquisition, calibration and
   versioned feature extraction; consume A's forward artifacts to establish ingest
   and rendering independently of live reconstruction.
3. **A + B:** finalize the observation contract, then implement FUSE-01 so visible
   geometry constrains the same anatomical model that explains acoustic evidence.
4. **A:** generate physical intervention forecasts. **B:** freeze forecasts before
   capture, implement Astra's experiment orchestration and independent scoring.

Human-audio inverse fitting, sensor fusion, nasal outlet occlusion, tissue-mechanics
recovery, calibrated posterior inference and service endpoints remain unimplemented.
The foundation does not claim the overall reconstruction moonshot has been proven.
