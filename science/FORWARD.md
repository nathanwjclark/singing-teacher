# PHY-01 forward-engine handoff

`Engine.synthesize(pose, articulation=None, f0_hz=160., duration_s=.4)` returns
one-dimensional float64 NumPy audio at `engine.sample_rate`. It uses the current
anatomy; it never restores the template implicitly. Each call resets the native
acoustic solver, starts pressure at zero, and ramps to the existing 8000 source
pressure setting over 25 ms. Audio is native amplitude, without normalization or
microphone calibration. The supported duration is 0.1–5 seconds; F0 must satisfy
both the adapter's 40–1000 Hz interval and the native source's bounds.

`Engine.geometry(pose, articulation=None)` returns the actual native tube lengths
in cm, areas in cm², articulator indices, velum opening in cm², incisor position
from the glottis in cm, and the native TS3 tongue-side-elevation control. The
latter retains its native parameter meaning; no invented distance unit is added.
The return includes current anatomy and requested/applied articulation. These are
simulator outputs, not observed internal human dimensions or tissue mechanics.
SVG remains available through `export`.

`Engine.export(path, anatomy=None, ...)` synthesizes and exports the current model
when anatomy is omitted. An explicit mapping uses existing template-relative
`set_anatomy` semantics (including `{}` to reset). Successful export retains that
model; a failed export restores the previous anatomy. Partial filesystem output
has no valid manifest and must be discarded by consumers. Native pose clipping
remains recorded as requested versus applied controls.

Use one context-managed engine per process and only from its owning thread.
Array outputs have independent storage. Synthesis, transfer calculation and
geometry calls can be interleaved; each explicitly supplies its pose.

The adapter verifies the pinned speaker and local safety patch against build
provenance. New native builds also pin the library hash in the manifest, and
invalidate a previous manifest before rebuilding. Legacy manifests without a
library hash remain usable; their runtime library hash is recorded rather than
verified against build-time provenance. All new builds should use the updated
build script. Native binaries were not rebuilt for this Python adapter change.

## Reproduction

From the repository root, after the documented native build and Python setup:

```sh
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_engine.py -q
```

Acceptance covers actual synthesis repeatability and sensitivity to pitch,
articulation and anatomy, finite audio, state preservation, malformed inputs,
failed-export rollback, matching geometry, process ownership and native lifecycle.
The existing native tongue-bounds safety patch is unchanged.

This interface unblocks observed-versus-synthesized audio extraction. It does not
supply nasal-outlet occlusion, source-tissue inference, calibrated loudness or
measured anatomy. Those capabilities require separate physical implementations
and evidence.
