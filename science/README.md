# Physiological acoustic model foundation

Person A's first working model milestone integrates a real VocalTractLab engine,
exposes anatomical controls, exports sound and corresponding geometry, and runs
a controlled inverse test. It does **not** yet fit human recordings, fuse RGB/depth,
recover tissue mechanics or run the Astra experiment planner.

See [verified results and owner handoff](STATUS.md) for measured recovery results,
checks run and the next integrated tasks.

## Setup

Requires Git, Python 3.12-3.13, CMake and a C++17 compiler. Tested on macOS arm64;
Linux library naming is supported but untested. Run from the repository root:

```sh
git submodule update --init --recursive
python3 -m venv science/.venv
science/.venv/bin/python -m pip install -e './science[test]'
science/.venv/bin/python science/scripts/build_native.py
science/.venv/bin/python -m pytest science/tests -q
```

The native build requires network access for upstream GoogleTest. It exports the
pinned source to `science/.build/native/source`, applies the versioned patch,
builds it and runs native tests. The submodule is not patched. Build products and
recordings are ignored by Git.

## Runnable handoffs

```sh
science/.venv/bin/singing-physics capabilities --output science/artifacts/capabilities.json
science/.venv/bin/singing-physics forward --pose a --f0 160 --output science/artifacts/reference-a
science/.venv/bin/singing-physics benchmark --seed 7 --output science/artifacts/recovery
science/.venv/bin/singing-physics fit-transfer science/artifacts/recovery/observations.json --output science/artifacts/refit.json
```

Commands refuse to overwrite existing outputs. Choose fresh paths for new runs.
`forward --anatomy anatomy.json` accepts a mapping of names from `capabilities` to
values in the listed units. Unknown names, nonfinite values and invalid bounds
are rejected.

`forward` exports `audio.wav` (native float32 waveform), `tract.svg` (matching
sagittal contour), `geometry.json` (tube lengths/areas with units), `transfer.json`
(simulated transfer magnitude/phase), and `manifest.json` (parameters, actual
articulation, source assumptions, sample rate and source/patch/artifact hashes).
There is no hidden playback normalization; peak amplitude is recorded.

Person B can ingest this genuine audio/geometry pair before live capture is
integrated. This milestone provides local commands and Python functions, not a
network server or unfinished sensor endpoints.

## Scientific scope

There are 13 global anatomy controls from upstream `AnatomyParams`. Each proposal
starts from a stable reference anatomy, shared across all fitting poses. The
initial inverse test varies **hard palate length** and **pharynx length**, holding
other anatomy fixed. Reference articulatory controls are passed through native
geometry limiting; requested and applied values are recorded.

The fitter consumes **direct synthetic transfer functions with known template
articulation**, not microphone spectra. A recorded voice also contains an unknown
source and capture response, which this test does not solve. The geometric glottis
does not recover tissue stiffness or mass. Anatomical vocal-fold length is not
claimed to personalize the source's tissue mechanics.

Bounded global search precedes local refinements. Results include all candidates,
convergence messages, actual evaluation counts and a fixed-anatomy baseline.
Candidate spread is not a calibrated posterior; convergence is not success.

The benchmark creates observation-only input, freezes the fit, then separately
scores hidden generating parameters and a held-out vowel. `score.json` contains
truth and must never be supplied to fitting/planning. This is same-simulator
evidence level A, not human reconstruction or robustness to different physics.

## Native ownership and regression testing

Use `with Engine() as engine`. VTL has process-global state: only one engine may
be active per process, and calls must use its owning thread. Parallel jobs need
separate processes. The adapter loads only the pinned, hash-checked template;
it does not accept arbitrary XML.

The upstream anatomy setter writes beyond the tongue-control array. The versioned
patch bounds its loop by the actual parameter count. We reproduced the failure
under AddressSanitizer and added repeated-anatomy lifecycle checks. See
[native investigation](NATIVE_INVESTIGATION.md).

```sh
science/.venv/bin/python science/scripts/build_native.py --sanitize
```

Upstream also emits temporary exception-message string warnings. These are not
fixed by the anatomy patch; broader file ingestion needs further hardening.

## Next Person A tasks

- Model excitation, articulation and capture when fitting actual microphone audio.
- Fit bounded per-trial articulation with shared anatomy; test mismatch and identifiability.
- Integrate Person B's synchronized RGB/depth bundle and visibility/calibration (FUSE-01).
- Add scientific job/evidence identities and intervention forecasts for the experiment loop.

Original `science/` code is AGPL-3.0-or-later; dependencies retain their own terms.
This scoped license does not relicense existing frontend code or assets. See
[third-party attribution](THIRD_PARTY.md).
