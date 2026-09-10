# Current Lead A integration status

## Callable session integration

The local app now forwards scientific jobs and durable session commands to the
isolated numerical worker. `npm run science:local` starts both services with an
ephemeral transport secret; no paid model calls or account system are introduced.
See [LOCAL_HARNESS.md](LOCAL_HARNESS.md) for the executable B handoff and
[SESSION.md](SESSION.md) for versioned commands, scoring, stop/failure and replay.
Original combined phone archives and ordinary voice recordings now have import
adapters alongside the existing probe adapter. Imported evidence remains distinct
from a successful physiological reconstruction.

This continuation incorporates B main `da55bf3`. Twenty-two focused Python
session/HTTP/archive tests pass with warnings treated as errors; five Node proxy
and actual HTTP-to-native integration tests pass. Build, lint and all four browser
tests pass. The one-command launcher was exercised against a real session route;
shutdown closed both listener ports. These are new-path checks, separate from the
prior full-suite checkpoint below. Actual phone capture and live Astra invocation
still require B's device/runtime integration.

Review then identified and fixed importer command identity, synthesis-budget and
recording-profile mismatches. Four singing adapter tests now include original
48 kHz recording → canonical extraction → real fit and versioned session ingestion
with idempotent replay. Four final session tests pass, including actual 48 kHz
search. Strict NodeNext TypeScript passes. See
[SESSION_HARNESS_REVIEW.md](SESSION_HARNESS_REVIEW.md) for independent review.
Explicit type-import changes alter the canonical extractor source hashes; rebuild
derived evidence rather than reuse receipts from the earlier source revision.

## Revision 8 continuation

Final assembled verification: **286 Python tests passed with warnings treated as
errors** (240.33 seconds), **8 KIT integration tests**, **5 probe bridge tests**,
strict TypeScript checks for scientific adapters, build/lint, **24 focused B
tests**, **6 coaching tests**, and **4 browser tests** passed. Python compilation
and whitespace checks pass. The build retains its bundle-size advisory. No
physical phone session or live runtime Astra invocation was performed by A.

The current queue incorporates B main `703492f` and the research-harness finish
plan `ab3e737`. See [ACTIVE_RESEARCH.md](ACTIVE_RESEARCH.md) for the connected
PCM search/design/update loop and [the recovery ledger](../docs/coordination/lead-a-recovery.md)
for reconciliation of interrupted agents and saved work. Positive reconstruction
or learning outcomes are not implementation completion requirements.

Final publication also incorporates B main `5e919bb`. Eleven dynamic-handoff
tests, build and lint passed after that delta. The iOS rebuild cannot run on this
host because full Xcode is absent; B reports its own unsigned build. This remaining
verification gap does not imply that native code was locally tested here.

External-drive physics, immutable probe forecasts, joint singing/probe fitting
and process-isolated CLI/service execution are now implemented. The source is a
free external monopole with direct leakage and oral reradiation, not the glottal
transfer function. See [ACOUSTIC_PROBE.md](ACOUSTIC_PROBE.md),
[PROBE_INVERSE.md](PROBE_INVERSE.md) and [PROBE_PREDICTION.md](PROBE_PREDICTION.md).
Native geometry and synthetic response tests exercise these paths. Physical
calibration/authenticity remains distinct from software correctness.

The [verified probe importer](PROBE_IMPORT.md) now runs B's original raw-media
import/extractor and consumes its full response with explicit instrument, pose,
placement, timing and processing evidence. A real software-fixture recording
reaches the actual joint fitter in 12 operator calls; its large discrepancy is
retained. Five bridge checks and strict TypeScript validation pass. The immutable
B acquisition record remains separate from A's actual inclusion/result receipt.

Visible and dynamic tongue handoffs now reject tongue-overlapping alignment
annotations; missing optical-flow results remain failed frames. These diagnostics
do not yet provide validated correspondence to the native anatomical surface.
See [TONGUE_HANDOFF.md](TONGUE_HANDOFF.md) and
[DYNAMIC_TONGUE_HANDOFF.md](DYNAMIC_TONGUE_HANDOFF.md).

The active loop used 24 native synthesis calls and selected one remaining finite
candidate with 2.45 mm palate error. The separate frozen robustness matrix found
1 cm errors despite low residuals. These negative scientific results are preserved;
they do not erase successful execution of the research harness.

The evidence below records earlier milestones and is retained historically.

Lead B's contracts, canonical PCM extractor, native acquisition/import and
independent scoring are received through main `55ff619`. New consumers are in
[PCM_INVERSE.md](PCM_INVERSE.md), [KIT_BRIDGE.md](KIT_BRIDGE.md),
[NATIVE_GEOMETRY.md](NATIVE_GEOMETRY.md), [DEPTH_RECTIFICATION.md](DEPTH_RECTIFICATION.md)
and [FROZEN_CONTROL.md](FROZEN_CONTROL.md). Original native LPCM now reaches the
canonical extractor and fitting inputs via [NATIVE_PCM.md](NATIVE_PCM.md).

## B integration verification

The assembled Python suite passed **195 tests with `-W error`** (183.14 seconds).
After the final clipping-threshold adjustment, all **10 targeted PCM and service
tests** passed again. The **7 KIT bridge tests**, **8 native PCM importer tests**,
and strict TypeScript checks for these scientific adapters pass. Application
build and lint pass, as do **23 focused B contract/audio/capture/evaluation tests**,
**6 coaching tests**, and **4 Playwright browser tests**. The build reports its
existing bundle-size advisory. No native C++ source changed in this integration;
the native results below belong to the earlier certified build.

The final local replay is `science/artifacts/b-final-kit-replay`: its forecast is
committed before a later synthetic target is generated and independently scored.
Pitch error is 0.0380 Hz, centroid error 20.2484 Hz, flatness error 0.0000196 and
level error 1.2181 dBFS. These are one software replay's errors, not human accuracy
or improvement over a baseline. The native PCM fixture output is
`science/artifacts/b-final-native-pcm`; private/generated artifacts stay untracked.

See [B_INTEGRATION.md](B_INTEGRATION.md) for executable handoff paths and owners.
Actual phone captures, physical calibration and synchronization/head-pose evidence
remain external acceptance gates. Anatomy identifiability, microphone/room and
tissue models, and held-out human learning outcomes remain research work; passing
the software suite does not resolve them.

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
