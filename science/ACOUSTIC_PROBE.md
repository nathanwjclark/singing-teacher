# External acoustic-drive operator (PROBE-03)

`singing_physics.acoustic_probe.predict_external_probe` predicts a conditional **recorded PCM / digital excitation** response from the current native anatomy and oral pose. It includes free-field speaker leakage and a compact mouth reradiation term. It does not use the engine's glottis-to-mouth transfer function as a phone measurement. No playback or human acquisition is performed.

## Physics and domain

All phasors use `exp(+i ωt)`. Pressure/volume-flow impedance has units Pa s/m³. Each piecewise uniform tube section has characteristic impedance `Zc=ρc/S`, propagation constant `γ=α+iω/c`, and transfer matrix `[cosh(γL), Zc sinh(γL); sinh(γL)/Zc, cosh(γL)]`. Cascading is evaluated by the equivalent backwards impedance recurrence. `tube_impedance` accepts sections ordered from mouth/input to glottal termination. Density is 1.204 kg/m³ and sound speed 343 m/s. Constant α (default .5 Np/m) is a declared passive phenomenological loss; it is not measured tissue damping or a validated thermoviscous model. Termination is explicitly rigid, pressure-release, or a nonnegative real resistance; none identifies the user's actual glottal closure.

For unflanged compact aperture radius `a=sqrt(Smouth/π)`, `Zrad=(ρc/Smouth)[(ka)²/4+i 0.6133 ka]`. This low-frequency radiation approximation uses the unflanged end correction from [Levine and Schwinger, Physical Review 73, 383 (1948)](https://materias.df.uba.ar/l2a2021c2/files/2012/07/Levine-efecto-de-extremo-del-tubo.pdf); more complete pipe-radiation approximations are discussed by [Silva et al.](https://arxiv.org/abs/0811.3625). The model masks mouth `ka>.5` and any internal equivalent radius `ka>1`; these conservative engineering cutoffs are approximation limits, not calibrated error bounds.

A point monopole's outgoing pressure Green function is `G(r)=iωρ exp(-ikr)/(4πr)`, Pa per m³/s, consistent with the [acoustic monopole derivation](https://euphonics.org/4-3-1-monopoles-and-dipoles/). With source volume velocity `Qs`:

- Mouth incident pressure is `G(source,mouth) Qs`.
- Inward mouth flow is `U=G(source,mouth) Qs/(Zin+Zrad)`.
- Mouth reradiation at the microphone is `-G(mouth,mic) U` (an inward sink).
- Direct pressure is `G(source,mic) Qs`.

Thus `H=M Q exp(-iω delay)[Gdirect-Gmouth,mic Gsource,mouth/(Zin+Zrad)]`, where `Q` is calibrated m³/s per digital drive and `M` is calibrated recorded PCM per Pa. The signed components are separately returned for explicitly bounded scalar nuisance models. Neither nuisance gain nor an arbitrary digital playback level substitutes for calibration. Exact frequency grids are required; the operator does not invent device responses or interpolate calibration. [UNSW external vocal-tract impedance work](https://www.phys.unsw.edu.au/jw/broadband.html) establishes the usefulness of external excitation but uses purpose-built source coupling and calibration; it does not validate this phone-placement approximation.

Source and microphone must be at least three aperture radii from the mouth; all three pairwise distances are .005..5 m. Free point-source coupling omits head/lip/phone diffraction, finite speaker directivity, room reflections and device processing. It is a falsifiable low-order forward hypothesis, not a validated human/phone acoustic simulator. Absolute source level, linearity and physical calibration require separate measurements.

## Native geometry audit

Pinned `VocalTractLabApi.cpp::vtlTractToTube` exports **40 pharynx/mouth sections, glottis to lips**, lengths cm and areas cm². These are reversed and converted by .01 and 1e-4. `Tube.h` also defines 19 nasal sections, four sinuses, five fossa sections, trachea and glottis, but these branches are **not in this public 40-section export**. Velum opening is a separate scalar. This operator rejects nonzero velum opening; it does not infer hidden nasal geometry or quietly use an oral-only model with an open branch. Closed-velum oral reduction still omits fossa, wall compliance and subglottal resonances. Full native tube export exists upstream but is not bound or substituted here.

Geometry is model-derived and conditional on the native template, anatomy parameters and pose. The operator returns actual geometry, its canonical SHA256, requested/applied controls and native provenance. It does not mutate stable anatomy. A low discrepancy does not establish anatomical recovery.

## API

```python
predict_external_probe(engine, *, pose, frequency_hz, placement, calibration,
                       articulation=None, termination="rigid",
                       termination_resistance_pa_s_m3=None,
                       attenuation_np_per_m=.5)
```

`placement`: nonempty `placement_id`, `coordinate_frame`, and `source_m`, `microphone_m`, `mouth_m` three-vectors in the same metric frame. Calibration must declare matching `placement_id`, `calibration_id`, `route_id`, `kind` (`measured` or `synthetic-fixture`), `source_hashes` (SHA256 evidence), `frequency_hz`, `delay_s` (0..1), and equal-length complex arrays:

- `source_volume_velocity_real`, `source_volume_velocity_imag`: m³/s per digital drive.
- `microphone_gain_real`, `microphone_gain_imag`: recorded PCM/Pa.

These hashes and labels retain caller evidence; authenticity and physical calibration are **not verified**. Fixture calibration must remain labelled synthetic. A route-specific response supplied here cannot be transferred to another device/placement without supporting evidence.

Output includes `frequency_hz`, `valid_mask`, per-band `invalid_reason`, and real/imag arrays for `response`, `direct_response`, `mouth_response`, `input_impedance_pa_s_m3`, `radiation_impedance_pa_s_m3`, and `reflection`. All invalid-band complex components are `None`; callers must preserve the mask, not coerce them to zero. Quantity is `recorded_pcm_per_digital_drive`. Conditions, geometry/native provenance, calibration hash, and unsupported capabilities accompany every prediction. Accepted frequency inputs are strictly increasing 20..20000 Hz, maximum 2048; unsupported approximation bands remain masked.

## Verification

```sh
PYTHONPATH=science/src /path/to/science/.venv/bin/python -m pytest science/tests/test_acoustic_probe.py -q
```

Actual run: **4 passed**. Checks cover analytic uniform rigid/open tubes, section subdivision, matched loads, nonuniform passivity, geometry/unit use in genuine native evaluation, reproducibility, source scaling, source/receiver reciprocity, direct-plus-mouth identity, anatomical sensitivity and state preservation, domain masks, invalid calibration and open-velum rejection. No claim of hardware or human validation follows from these software tests.
