# Synthetic motion-to-control integration replay

Run the complete local backend loop after building the native engine and installing
its Python dependencies:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/replay_motion_control.py science/artifacts/motion-replay --budget 20
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_motion_control_flow.py -q
```

Choose a new output directory; existing directories are refused. The replay uses a
fictional cue explicitly restricted to synthetic research. It supplies no human
exercise instructions or reviewed teaching library.

The runner generates three independent synthetic a → i → a attempts. Every frame
contains a genuine native transfer spectrum and a two-pixel calibrated depth pair
whose reconstructed distance equals the simulator's visible lip-marker distance.
Depth intrinsics vary by synthetic frame to realize that controlled distance; these
are calibrated mathematical fixtures, not recorded camera measurements. Explicit
identity head transforms and distinct rigid-reference evidence describe the known
synthetic stationary head. The resulting `DepthFrame` / `MotionFrame` records pass
through the real `analyze_motion` path and yield nine visible geometry observations.

The dynamic job jointly fits shared anatomy and per-frame articulation against audio
and visible geometry. A protocol saved before fitting selects only the final a frame
from each attempt. Those three inferred JA values become **three independent attempt
records**, not nine independent repetitions. Success, failure and unknown execution
are retained. All records cite the dynamic model that derived them, with unknown
inference uncertainty retained as null. They are not direct motor measurements or a
calibrated latent-control posterior.

The motor-profile job freezes this three-attempt history. The control-aware forecast
then integrates native spectra over its empirical support and the fitted anatomy.
The prospective canonical artifact is written before generating a fourth synthetic
JA measurement. That observation produces a separate conditional forecast. Replaying
the prospective job after the observation must preserve its exact bytes and lineage.
This demonstrates ordering and immutability in this runner; it is not a signed
external capture-order attestation.

Artifacts include:

- `protocol.json`, `dynamic-input.json`, and nine `depth/*.npz` calibrated fixtures.
- `generation-truth.json`, kept outside dynamic fitting input.
- `control-attempts.json`, `control-profile.json`, and `anatomy-candidates.json`.
- `prospective.json`, followed by `target-measurement.json` and separate target truth.
- Integrity-checked dynamic, motor, prospective, conditional and replay job outputs.
- `summary.json` and a manifest indexing standalone artifacts.

The budget counts residual calls per joint/fixed-anatomy model, not a scientific
accuracy threshold. This is an integration test of implemented physics, geometry,
inference and job handling. It makes no claim of human G6/G7 validation, motor
learning, tissue recovery or calibrated physiological accuracy. Inferred motor
points depend on their fitted anatomy; Cartesian support is not a joint posterior.
