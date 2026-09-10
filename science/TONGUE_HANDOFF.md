# Visible-tongue patch handoff audit

Reviewed B's `scripts/fit-native-tongue.py` and `docs/implementation/NATIVE-TONGUE-FIT.md` at the `74210c3` integration. The numerical fit is a six-coefficient quadratic **camera-space depth patch**, in millimeters, with a three-coefficient plane baseline. Both fit only the designated reference frame and are persisted before the loop over other frames. Subsequent frames use frozen coefficients. Correlated frames from the same held pose are not cross-pose validation.

## Executable evidence and correction

Nine targeted tests execute B's actual numerical functions without loading its optional Pillow viewer dependency. They verify curved-patch recovery with large outliers, frozen predictions under changed held-out values, rejection of highlights/spikes/missing depth and ROI boundaries, and source ordering of validation, fitting, freezing and held-out evaluation.

A concrete registration flaw was identified and fixed in `scripts/fit-native-tongue.py`: the script described its face template and cheek offset as non-tongue nuisance controls, but previously accepted those rectangles directly without checking bounds or overlap with the evaluated tongue. Assigning either control rectangle inside the tongue ROI could let tongue movement drive the nuisance correction itself. The new `validate_regions` runs **before fitting** and rejects overlapping tongue/template or tongue/cheek regions, invalid/noninteger rectangles, missing tracking margins and nonexistent reference frames. This leaves the fit algorithm and viewer unchanged. Separate image rectangles still do not establish a full rigid-head transform or prove physical rigidity; independent acquisition/registration validation remains necessary.

## What A can consume now

The source, fixed selection policy and frozen-shape diagnostic are useful for reviewing visible-surface support and within-pose residual behavior. Original capture artifacts can pass through A's native reader, ray rectification and independent target diagnostics. A can preserve the visible patch as a **derived observation** with its raw support and fit uncertainty limitations, rather than treating its polynomial coefficients as physiological parameters.

The handoff is **not yet a valid native tongue likelihood**. The patch's camera XY/Z coordinates and color-selected rectangle have no declared correspondence to a VTL anatomical surface or native landmark. They are not equivalent to `TCX`, `TCY`, tongue side controls or hidden cavity dimensions. B's frozen model records the training depth hash/settings/support, but does not itself bind all capture/annotation/calibration identities that A requires for a physiological likelihood. A should retain the original verified manifest and annotation/calibration lineage, not ingest the standalone polynomial as an anatomical measurement.

Pinned VTL exposes actual tongue surface geometry through `vtlTractSequenceToEmaAndMesh`: surface 16, predefined midsagittal EMA vertices 115/225/335 (tongue back/middle/tip). These accessible numerical landmarks do not establish that any red pixel in the observed patch is their corresponding human landmark. A usable observation operator still needs visible-region correspondence, camera-to-model pose, and a task state matched to the observed frame; hidden/unobserved tongue volume cannot be recovered by simply extruding the patch.

## Masking and held-out interpretation

The selection policy uses observed color, valid depth and local depth consistency in every frame. Its fixed thresholds avoid tuning on held-out results, but reported errors remain conditional on the retained subset; difficult/missing surfaces are excluded. Sample and frame exclusion counts must remain visible. The geometry is evaluated only inside reference-frame XY support. Approximate image translation and a cheek depth offset do not remove rotation or independent jaw/cheek motion, so temporal residuals are not sensor noise estimates or proof of unchanged tongue anatomy.

No private capture, patch model or evaluation artifact was publicly committed in the inspected tree. This audit independently checks source behavior and analytic fixtures, not B's private physical results. The physical correspondence, target accuracy and head registration gates remain open.

## Tube-topology note for active probing

The pinned native `Tube.h` defines 40 pharynx/mouth sections (16+24), 19 nose sections, four sinus sections and separate fossa sections. The public `vtlTractToTube` arrays expose the 40-section glottis-to-mouth tract plus a velum-opening scalar; they do not expose the complete branched nasal topology. The forward/probing owner was notified to avoid interpreting this oral tube export as an internal nasal scan or complete graph. A branch-aware probing operator needs explicitly supported native geometry/boundary APIs and independently defined observation conditions.

Run:

```sh
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_native_tongue_handoff.py -q
```
