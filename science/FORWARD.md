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
certified library hash are rejected with an explicit rebuild instruction. Use the
updated build script to create a certified manifest. Native binaries were not rebuilt for this Python adapter change.

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

## Source-defined visible lip operator

`Engine.lip_markers(pose, articulation=None)` uses the pinned native
`vtlTractSequenceToEmaAndMesh` API for one static frame. Fixed surface indices 4/5
and vertex 89 identify upper/lower **outer lip** points (not aperture edges).
Native cm coordinates are converted to `positions_m.upper` / `positions_m.lower`
in the VTL model frame. The Euclidean distance is returned as `distance_m` and
`value_m`, with operator ID `vtl-upper4-lower5-vertex89-distance-v1`, source marker
identities, EMA artifact hash and requested/applied controls. No camera-frame
registration or human landmark correspondence is inferred.

Only these fixed source-verified marker indices enter the native API. Its EMA
and incidental mesh files are temporary and removed before return, including
when the native call fails. Native text precision is eight significant digits;
sequence offset zero means a static simulator frame, not a capture timestamp.
Current anatomy is preserved. A measured constraint is valid only with an
explicit corresponding outer-lip annotation protocol and model-discrepancy
uncertainty. This is a visible-surface observation operator, not evidence that
external lip distance determines internal anatomy.

## Genuine 3D surface export for VIS-01

Forward bundles now include native `tract0.obj`, its referenced `tract0.mtl`, the
matching static-frame `tract-ema.txt`, and `surface-mesh.json`. Every file is
hashed in the existing manifest. Mesh metadata is also included in the manifest.
The adapter preserves the exact files emitted by the pinned native
`VocalTract::saveAsObjFile(saveBothSides=true)` implementation; it does not derive
3D shape from spectral features. The OBJ contains triangle faces and normals,
with coordinates in **centimeters** in the VTL model frame (multiply by 0.01 for
meters). Material colors/transparency are native rendering defaults, not measured
tissue properties. The mesh is labeled model-derived and template-conditional,
not a scan; no watertightness claim is made.

Export validates finite vertices/normals, nonempty triangles with valid indices,
and the companion material reference before publishing the bundle. It retains
SVG, audio, transfer and tube geometry. The tested mesh is repeatable for fixed
controls and changes with articulation. Capability names are
`native_surface_mesh_obj` and `native_outer_lip_markers`; these do not advertise
generic depth fusion or human anatomical reconstruction.
