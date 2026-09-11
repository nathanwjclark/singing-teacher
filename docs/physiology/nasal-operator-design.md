# Coupled oral/nasal external-drive operator: design

Status: design only, September 11, 2026. No operator code is part of this change. Evidence source for every number here: `synthetic` (native VocalTractLab template geometry JD3, no recordings). Scientific outcome: `untested`.

This document answers the wave-3 "Nasal operator" lane ([plan](wave3-scientific-plan.md)): establish the exact native branch matrices, boundary conditions and units, then specify how a coupled oral/nasal external-drive operator binds them, how it is validated against network limits, and how it is evaluated on held-out cases.

Source references use `vendor/` for `science/vendor/vocaltractlab` at the pinned revision `df30392` (`engine.py` `REVISION`). The built library's copies of `TlModel.cpp`, `Tube.cpp`, `VocalTractLabApi.cpp` and `VocalTractLabApi.h` are byte-identical to `vendor/` (`cmp`), and the only native patch (`science/patches/anatomy-tongue-bounds.patch`) touches `AnatomyParams.cpp` only. Probe outputs (`P1`-`P6`) are in the appendix.

## 1. Verified facts

| # | Fact | Source |
|---|---|---|
| F1 | `vtlTractToTube` returns only the 40 pharynx+mouth sections (`numTubeSections` is 40). This is the only tube call the adapter binds (`Engine.geometry`). | `vendor/src/VocalTractLabApi/VocalTractLabApi.cpp:307,558-632`; `engine.py:136-150,407` |
| F2 | Two exported functions expose the full network: `vtlTractToFullTube` (all 93 sections: length, area, volume, wall mass/stiffness/resistance, articulator, fossa length/volume) and `vtlGetTLIntermediateValues` (the 93 cumulative ABCD products at one frequency index, plus the fossa input impedance and the nose and mouth radiation impedances). Both are exported by the built dylib (`nm -gU`) and neither is bound by `engine.py`. No function returns individual section matrices or evaluates an arbitrary frequency. | `VocalTractLabApi.cpp:713-782,2589-2670`; `VocalTractLabApi.h:887-926` |
| F3 | Section order: 0-22 trachea (23 x 1 cm), 23-24 glottis, 25-40 pharynx (16), 41-64 mouth (24), 65-83 nose (19), 84-88 piriform fossa (5), 89-92 paranasal sinuses (4). | `vendor/include/VocalTractLabBackend/Tube.h:68-94`; P1 |
| F4 | Matrix convention: `(p_in, U_in) = M (p_out, U_out)`, "in" toward the lungs, volume velocity positive toward the openings. Phasors use `exp(+i omega t)` (series element `i omega L`), the same convention as `acoustic_probe.py`. | `vendor/src/VocalTractLabBackend/TlModel.cpp:864-865,847`; `acoustic_probe.py:1` |
| F5 | Cumulative products restart per branch: fossa (`TlModel.cpp:587`), trachea through pharynx (`:601`), mouth (`:652`), nose (`:684`). `matrixProduct[k]` is stored before the shunts attached after section k (`:618` then `:620-646`; nose `:689` then `:697-705`). The branch-end products `P[40]`, `P[64]`, `P[83]` therefore contain every internal side branch, because no side branch attaches after a branch's last section. | `TlModel.cpp:580-708` |
| F6 | The piriform fossa is a closed-end 5-section side branch (input impedance `A/C`) shunted after pharynx section 3 (global 28). JD3 declares 2.5 cm and 1.5 cm3, not the `Tube` defaults 3.0 cm and 2.0 cm3. | `TlModel.cpp:594,640-645`; `Tube.cpp:268-300`; `JD3.speaker:42`; P1 |
| F7 | The four paranasal sinuses are Helmholtz resonators (neck length/area, cavity volume 11.3, 6.8, 33.0, 6.2 cm3, wall resistance 6500, wall mass 0) shunted after nose sections 8, 9, 11, 12. | `Tube.cpp:79-82,203-257`; `TlModel.cpp:692-705,889-908`; P1 |
| F8 | Mouth and nose both start at the downstream end of the last pharynx section (the velopharyngeal junction). The junction load is nose in parallel with mouth. | `Tube.cpp:665`; `TlModel.cpp:1034-1036` |
| F9 | The velopharyngeal port is not a separate element. `setVelumOpening` rewrites the areas of nose sections 0-3; section 0 area equals the port area, floored at `MIN_AREA_CM2` = 1e-4 cm2. Port area = `maxNasalPortArea * VO`, floored at 0. JD3 declares 2.0 cm2, scaled by palate_depth x soft_palate_length. `VO` is labelled "cm^2" with range -0.1..1.0 but acts as a multiplier: VO=0.5 gives a 1.0 cm2 port. Every stored JD3 pose has VO of -0.1 or -0.09. | `Tube.cpp:56,441-456`; `VocalTract.cpp:165,5576-5578`; `AnatomyParams.cpp:745-748`; `JD3.speaker:32`; P1, P5 |
| F10 | Velum closed is not a seal in the native network. `vtlTractToTube` reports the raw port area (0 for VO <= 0), which `acoustic_probe` requires to be <= 1e-8. The TL network still contains a 1e-4 cm2 port. That port changes the lips-side input impedance by at most 2.9e-3 (at 97 Hz, pose a). | `Tube.cpp:443,556-558`; `acoustic_probe.py:102-103`; P2 |
| F11 | Nasal geometry is a fixed template (Dang and Honda 1994, subject 1): 19 x 0.6 cm sections scaled to the 11.4 cm nasal cavity length, with fixed areas. None of the 13 adapter anatomy parameters changes nose lengths, nose areas beyond the port sections, sinuses, fossa or trachea. Only the port area scales. | `Tube.cpp:189-238`; P5 |
| F12 | Boundaries used by every TL call: lung end pressure-release (`lungTerminationImpedance = 0`), glottis forced closed (`setGlottisArea(0.0)`, clamped to 1e-4 cm2), and radiation impedances at lips and nostrils from the aperture areas (default `PARALLEL_RADIATION`, a resistor in parallel with an inductor). The nostril aperture is the last nose section (0.76 cm2). Both nostrils are one lumped tube. There is no occlusion option. | `TlModel.cpp:549-551,796-802`; `VocalTractLabApi.cpp:2631`; `Tube.cpp:199-201,428-432` |
| F13 | Static-pressure-drop resistances are zero in these calls: a fresh `TlModel` has lung pressure 0, so mean flow is 0 and each added series element is 0. | `TlModel.cpp:61,567,625,634` |
| F14 | Units are CGS: density 1.14e-3 g/cm3, sound speed 3.5e4 cm/s, viscosity 1.86e-4 dyn s/cm2, sampling rate 44100 Hz. Wall mass, resistance and stiffness are per unit wall area (divided by length x circumference). | `vendor/include/VocalTractLabBackend/Constants.h:30-35,43`; `TlModel.cpp:857` |
| F15 | Frequency grid: `f_k = k * 44100 / N`. Only `k` in `[1, numFreq-1]` is computed, where `numFreq = min(floor(cutoff * N / 44100), 4096, N/2 - 1)`. The cutoff is 10 kHz with lumped elements (the default) and 22.05 kHz without. `vtlGetTLIntermediateValues` rejects only `k >= N/2` (return code 2). For `numFreq <= k < N/2` it returns code 0 with identity matrices and zero impedances. At `k = 0`, omega is clamped to 1e-4 rad/s. | `TlModel.cpp:26,139-166,746`; `VocalTractLabApi.cpp:2637`; P1 |
| F16 | The native transfer function is `(U_mouth + U_nose) / U_source`, with the flow source at the centre of section 25 and native default options. | `VocalTractLabApi.cpp:834-921`; `TlModel.cpp:1317-1410` |
| F17 | `vtlTractToFullTube` and `vtlGetTLIntermediateValues` do not save and restore control parameters (unlike `vtlTractToTube`). Each `Engine` call passes explicit parameters, and anatomy, spectrum and geometry are unchanged after these calls. | `VocalTractLabApi.cpp:572,615,713-782`; P5 |
| F18 | The existing oral operator `external-monopole-oral-line-v1` reverses the 40 native sections (lips to glottis), converts cm to m and cm2 to m2, and cascades a lossless line with 0.5 Np/m. It uses density 1.204 and sound speed 343, a rigid, pressure-release or resistive glottal end at the section-25 input, and an unflanged low-ka mouth radiation. | `acoustic_probe.py:9-10,33-62,104-121` |
| F19 | `predict_probe` and `fit_probe_pcm` accept only channel `oral_external`. The Engine capabilities list `nasal_outlet_occlusion` as unsupported. | `probe_prediction.py:37-38`; `probe_inverse.py:31-32`; `engine.py:370` |
| F20 | Measured probe responses sit at `k * rate / n` (device rate, power-of-two FFT, then band-aggregated centres). These are generally not on the native `44100 / N` grid. | `src/observations/acoustics/probeResponse.ts:16,52-53` |
| F21 | Cost per native call: 7.3, 8.6, 16.4 and 48.5 ms for `vtlGetTLIntermediateValues` at N = 512, 1024, 4096, 16384 (one frequency per call); 3.1 ms for `vtlTractToFullTube`; 8.9 ms for `Engine.geometry`. Each call allocates a `TlModel` holding 93 x 4096 complex 2x2 matrices (about 24 MB). Probe process peak RSS was 140 MB. | `TlModel.h:116`; P6 |

## 2. Network topology

```
 lungs (p=0) --[trachea 0-22]--[glottis 23-24, 1e-4 cm2]--[pharynx 25-40]--+-- J --[mouth 41-64]-- lips   (Z_rad,L, blocked pressure p_b,L)
                                            fossa 84-88 shunt after 28 --'   |
                                                                            '--[nose 65-83]-- nostrils (Z_rad,N, p_b,N | rigid seal)
                                                            sinuses 89-92 shunts after nose 8,9,11,12
```

The operator treats the network as three two-port branches meeting at one junction node J. Each branch uses its native branch-end product: `P_T = P[40]` (lungs to J, including the glottis and fossa), `P_M = P[64]` (J to lips) and `P_N = P[83]` (J to nostrils, including the port sections and sinuses). The operator does not compose sections itself, and it never replaces a branch with an assumed tube.

The subglottal-plus-pharynx branch enters only through its admittance seen from J. With the native lung load, `p_lung = 0` gives `Y_T = A_T / B_T`. With the glottal-end options of v1 (section 7), the operator uses the pharynx-only product `P_ph = P[24]^-1 P[40]`, for example rigid `U = 0` at the section-25 input, which gives `Y_T = C_ph / D_ph`.

## 3. The five-equation system

Unknowns: `x = [p_L, U_L, p_N, U_N, p_J]`. These are the pressure and outward volume velocity at the lips and at the nostrils, and the junction pressure. The count is five for these reasons:
- Each open branch has two port states. The junction shares one pressure.
- The flows entering the mouth and nose branches at J are not independent unknowns. The second ABCD row expresses each one from its outlet state.
- The lungs-to-J branch reduces to one admittance `Y_T`.

Two boundary equations, two branch equations and one flow-balance equation close the system:

```
(1) lips:      p_L - Z_rad,L U_L = p_b,L                         (open, externally driven)
(2) nostrils:  p_N - Z_rad,N U_N = p_b,N                         (open, externally driven)
          or   U_N = 0                                           (rigid seal: exact zero nasal flow)
(3) mouth:     A_M p_L + B_M U_L - p_J = 0
(4) nose:      A_N p_N + B_N U_N - p_J = 0
(5) junction:  (C_M p_L + D_M U_L) + (C_N p_N + D_N U_N) + Y_T p_J = 0
```

Equation (5) states that the flow into the mouth and nose branches equals the flow arriving up the pharynx, which is `-Y_T p_J`. A rigid seal replaces equation (2) with `U_N = 0`. The unknown vector stays the same, so boundary types switch without changing the system size. The operator solves one 5x5 complex system per frequency with LU and partial pivoting. It returns `x`, the relative residual `||Ax - b|| / ||b||` and the 2-norm condition number. In CGS the condition number was 2.5e2 to 1.2e4 with the port open, and up to 3.8e6 with the native closed-velum port, where the 1e-4 cm2 port makes `B_N` large (P2, P3).

This is the same information as a 2x2 aperture impedance matrix. The five-equation form is kept because it handles the rigid seal exactly and exposes `p_J` and the branch flows for the checks in section 8.

## 4. Units: CGS to SI at the binding boundary

The Engine binding converts every quantity once, when the arrays leave the native call. Everything downstream (solve, coupling, artifacts) is SI, matching `acoustic_probe`.

| Quantity | Native unit | SI unit | Multiply by |
|---|---|---|---|
| Length, position | cm | m | 1e-2 |
| Area | cm2 | m2 | 1e-4 |
| Volume (sinus, fossa) | cm3 | m3 | 1e-6 |
| Pressure | dyn/cm2 (dPa) | Pa | 1e-1 |
| Volume velocity | cm3/s | m3/s | 1e-6 |
| Acoustic impedance (matrix B, Z_rad, fossa input impedance) | dyn s/cm5 | Pa s/m3 | 1e5 |
| Acoustic admittance (matrix C) | cm5/(dyn s) | m3/(Pa s) | 1e-5 |
| Matrix A, D | dimensionless | dimensionless | 1 |
| Wall mass per area | g/cm2 | kg/m2 | 10 |
| Wall resistance per area | dyn s/cm3 | Pa s/m | 10 |
| Wall stiffness per area | dyn/cm3 | Pa/m | 10 |
| Density | g/cm3 (1.14e-3) | kg/m3 (1.14) | 1e3 |
| Sound speed | cm/s (3.5e4) | m/s (350) | 1e-2 |
| Viscosity | dyn s/cm2 (1.86e-4) | Pa s (1.86e-5) | 1e-1 |

Conversion check: `det(P)` is dimensionless and must stay equal to 1 after conversion. The CGS and SI solves must give the same dimensionless outputs (`U_N/U_L`, `p_J/p_b`) to 1e-12.

Inside the tract and at the aperture radiation impedances, the network uses the native constants (1.14 kg/m3, 350 m/s). External propagation (Green's functions) keeps the v1 room-air constants (1.204, 343). The operator records both sets. That split is a declared modelling choice, not a measurement (see decision Q4).

## 5. Source and receiver coupling

The coupling is v1's compact free-monopole model extended to two apertures. `G(d) = i omega rho exp(-i k d) / (4 pi d)` and `Q` is the calibrated source volume velocity (`acoustic_probe.py:117-121`).
- Drive: `p_b,a = G(|source - aperture_a|) Q` for a in {lips, nostrils}. Free-field, compact, no baffle doubling: the same assumption as v1.
- Receiver: `p_mic = G(|source - mic|) Q + G(|mic - lips|) U_L + G(|mic - nostrils|) U_N`, multiplied by the calibrated microphone gain and delay exactly as in v1.
- Placement gains a declared `nostril_m` point in the placement frame. It is a caller-declared coordinate. The native model has no 3-D nostril position (the nose is one-dimensional). Distances from source and microphone to each aperture must be at least 3 aperture radii. The native nostril is 0.76 cm2, a 0.49 cm radius.
- Channels: `oral_external` (microphone near the mouth) and `nasal_external` (a second phone near the nostrils). Both are the same equations with a different `microphone_m`.
- Validity mask per frequency: on the native grid (F15), `k a <= 0.5` for both apertures, `k * max(tract radius) <= 1` (as v1), finite result, and relative residual <= 1e-10. Masked bins keep a named reason and are never interpolated.
- Not modelled: mutual radiation between mouth and nostrils, head and phone diffraction, room response. These are listed as limitations in every artifact.

## 6. Declared native conditions

The operator records native `TransferFunctionOptions` as declared conditions. The default is the native API default (lumped elements, boundary layer, soft walls, sinuses, fossa, parallel radiation; `VocalTractLabApi.cpp:784-798`, confirmed by P1). Only the booleans and the radiation type are accepted, as a validated closed mapping. They are needed for the limit tests and are physics declarations in the same way that `termination` and `attenuation_np_per_m` are in v1.

## 7. Boundary-condition options

| Location | Options | Notes |
|---|---|---|
| Glottal end | `native-closed-glottis-trachea` (default: P[40] with lung pressure-release, glottis 1e-4 cm2); `rigid`, `pressure-release`, `resistive` at the section-25 input via `P[24]^-1 P[40]` | The native call cannot open the glottis (F12). Quiet breathing with abducted folds is not representable by the default; see Q3. |
| Lips | open radiation with external drive | Native `Z_rad,L` for the lip-section area. |
| Nostrils | `open` (native `Z_rad,N`, external drive) or `sealed` (rigid, `U_N = 0`) | The trial record carries `nostril_boundary: {state, evidence: "declared" or "measured", evidence_ids}`. The operator computes under the stated boundary. A declared seal is a control, not proof of execution. Partial occlusion has no validated boundary model: those trials are stored as `unmodeled_nostril_boundary` and excluded from likelihoods. |
| Velopharyngeal port | `VO` articulation of the candidate (port area = max area x VO, floored at 1e-4 cm2 in the network) | Model parameter only. Never inferred from, or set by, the nostril boundary. Nostril occlusion and velum opening are separate inputs and separate record fields. |

## 8. Validation plan

Tolerances below come from the pilot probes (appendix). Before implementation starts, the tolerances are frozen in the test file. Tests run through the real Engine with no mocked internals.

| Gate | Check | Pilot result | Frozen tolerance |
|---|---|---|---|
| V1 binding sanity | Pharynx+mouth sections from `vtlTractToFullTube` equal `Engine.geometry`; section sums as in F3; `k` outside `[1, numFreq-1]` rejected before the native call; identity-matrix sentinel rejected | equal (P1) | exact |
| V2 determinant | `abs(det(P) - 1)` for P[40], P[64], P[83] | <= 8.5e-10 (P1) | <= 1e-8 |
| V3 residual | relative residual of the 5x5 solve | <= 4.5e-13 (P2, P3) | <= 1e-10 |
| V4 reciprocity | nostril flow for lip drive equals lip flow for nostril drive | <= 4.0e-15 (P3) | <= 1e-12 |
| V5 rigid seal | `U_N` with `sealed` nostrils | exactly `0j` (P3) | `== 0` |
| V6 native full-tract transfer | Drive both apertures with `p_b = 1` and read the pressure at the centre of section 25 (`[1, Za25] P[25]^-1 P[40] [p_J, U_up]`, `Za25 = (A-1)/C` of `P[24]^-1 P[25]`). By reciprocity this equals `Engine.spectrum` complex output (magnitude and phase). Poses a, i, u; VO in {-0.1, 0.25, 0.5}; also with sinuses off and with fossa off | rel. error <= 2.1e-9 on 9 cases (P2, P3) | <= 1e-8 |
| V7 velum-closed physical limit | VO <= 0 (1e-4 cm2 port) against the nose cut at J (`U_N = 0`, nose rows removed): relative change of the lips-side impedance. Also native closed glottis and trachea against a rigid end at the section-25 input | port <= 2.9e-3, glottal end <= 3.9e-3 (P2) | report only; expected < 1e-2 above 90 Hz |
| V8 reduction to v1 (exact) | Matched physics: velum closed and nose cut, distributed sections, walls, boundary layer and fossa off, rigid glottal end at the section-25 input, native density and sound speed. The lips-side impedance equals `tube_impedance(..., attenuation 0)` | <= 1.2e-11 from 97 Hz to 19.4 kHz, poses a, i, u (P4) | <= 1e-9 |
| V9 physics attribution | Relative change from V8 physics when each native option is added: soft walls up to 0.82 (97 Hz), fossa up to 2.29 (797 Hz), boundary layer up to 0.08, lung and glottis up to 0.016 (P4b). Shipped v1 differs from matched native by 0.10-0.58 (P4a) | recorded | report only |

V8 needs `tube_impedance` and `predict_external_probe` to accept declared `density_kg_m3` and `sound_speed_m_s` (defaults unchanged). v1 already reports these values in `conditions` (`acoustic_probe.py:136`). This is a two-argument extension, not a second implementation.

V6 is the comparison against the native full-tract transfer function. It tests section ordering, branch topology, boundary conditions, phase sign and branch-end semantics together. Its readout formula lives in the test as an oracle over the production binding's returned matrices, in the same way `test_acoustic_probe.py` uses analytic cascades.

V7 and V9 show that the network operator is not a drop-in replacement for v1. With native default physics, the velum-closed network and shipped v1 differ by 4-76% in lips-side impedance (P2, "existing oral line" column). Wall compliance dominates below 500 Hz and the fossa from 0.5 to 3 kHz (P4b). The two operators therefore keep distinct versions. Choosing between them for fitting is a held-out question (section 9), not a software default.

## 9. Held-out evaluation protocol (shape; frozen before any result)

File: `evaluation/wave3/nasal/protocol.json`. It follows `evaluation/wave3/protocol-2.json`: committed before the run, a hard native-call limit, a decision rule written in advance, and every outcome retained.

- `evidence_source: "synthetic"`. The generator is the native network under declared options.
- Question S1 (identifiability): can oral + nasal channels with open and sealed nostrils recover the port area (VO) and one anatomy dimension better than oral-channel-only trials, at equal native-call budget?
- The generating anatomy and VO lie outside the candidate grid, following the generating-rule pattern of revision 2. The candidate grid covers VO in {-0.1, 0.1, 0.3, 0.6} and three anatomy points.
- Calibration trials: poses a and i; channels oral and nasal; nostrils open and sealed. Held-out trials: pose u and one unseen VO. A held-out microphone placement is not in calibration.
- Noise: a declared seed and complex Gaussian noise at a declared SNR per band. Missing or masked bins stay missing.
- Metrics: held-out standardized residual per band, regret against the generator, retained-candidate count (ambiguity), and VO error. Frequency bins are not counted as independent evidence (as in `probe_inverse`).
- Arms: (a) network operator, oral channel only, nostrils open; (b) network, both channels, open and sealed; (c) v1 on velum-closed cases only. v1 cases with VO > 0 are reported as `unsupported`, never as errors.
- Decision rule: (b) beats (a) if its held-out median regret is lower by more than a tie margin derived from repeated-noise calibration frames before the run. Otherwise the result is `negative` or `inconclusive`, and both are reportable.
- Stated limit: S1 tests recoverability under the operator's own physics. It cannot show that the operator is correct for people. Operator validity (for example, whether network beats v1) needs `reference object` or `human` evidence with an independent generator. Synthetic runs must not claim it.

## 10. Binding into existing modules (no parallel implementation)

- `engine.py`: bind `vtlTractToFullTube`, `vtlGetTLIntermediateValues` and `vtlGetDefaultTransferFunctionOptions` (ctypes `TransferFunctionOptions`: two `c_int` enums, nine `c_bool`). Add one method, `Engine.tract_network(pose, articulation=None, *, spectrum_samples, frequency_indices, options=None)`. It returns SI branch products for all 93 sections, the radiation and fossa impedances, full-tube geometry, the port area, and the exact native frequencies. It validates `k` against `numFreq` (F15), adds `tract_network` to `supports`, and keeps `nasal_outlet_occlusion` unsupported until V5 passes.
- `acoustic_probe.py`: split `predict_external_probe` into shared validation and coupling (calibration, placement, Green's functions, direct path, masks) plus a tract model. v1's tract model is `tube_impedance` at the lips. The network's tract model is the five-equation solve. New `OPERATOR_VERSION` `external-monopole-oral-nasal-native-network-v1`. v1 output stays byte-identical, which a regression test checks.
- `probe_prediction.py` and `probe_inverse.py`: accept `operator_version` and channel `nasal_external` only with the network operator. Carry `nostril_boundary` per trial. Count native calls per frequency evaluation in `_Operators.counts` so equal-budget comparisons stay honest. Reject off-grid records with `off_native_grid` until M3 lands.
- Alternative rejected: reimplementing `getSectionMatrix` in Python from `vtlTractToFullTube` geometry. It would allow arbitrary frequencies without a patch, but it is a second copy of native physics that can drift. M3 gets the same capability from the native code.

## 11. Milestones and Definition of Done

| M | Scope | Files | DoD |
|---|---|---|---|
| M1 | Native binding, grid frequencies only | `engine.py`, `science/tests/test_nasal_network.py` | V1, V2 and V6 pass on the real Engine. Unit conversion test. State-restore test (F17). |
| M2 | Five-equation solve and network operator | `acoustic_probe.py`, the same test file | V3-V5, V7 and V8 pass. Existing `test_acoustic_probe.py` passes unchanged. Artifact JSON is finite (`allow_nan=False`). |
| M3 | Native patch: evaluate branch products at caller frequencies in one call (move the `prepareCalculations` loop body into a per-omega routine; export it) | new `science/patches/*.patch`, `build_native.py`, manifest and Engine patch-hash check | Bitwise-equal to M1 on grid frequencies. Rebuilt library hash recorded. The CTO rebuilds once (brief rule for patch changes). |
| M4 | Prediction and inverse wiring | `probe_prediction.py`, `probe_inverse.py`, `import_probe_science.ts` (channel, `nostril_boundary`) | Targeted pytest. Oral-only records produce unchanged v1 artifacts. Nasal records rejected before M3 with a named reason. |
| M5 | Frozen protocol and single run | `evaluation/wave3/nasal/` | Protocol committed before the run. Results, failures and unsupported cases retained. Outcome labelled. |

Estimated size: Python production about 180 lines (engine about 50, acoustic_probe about 90 after sharing, prediction and inverse about 40). C++ patch about 80 lines. Tests about 250 lines. Protocol and runner about 350 lines.

## 12. Budgets

- Grid-only (M1-M2): one native call per frequency, 16 ms at N = 4096, plus one 3 ms full-tube call per candidate and pose. Cap: 64 frequencies per record, so about 1.1 s per candidate-record.
- After M3: estimated 6 ms fixed per call plus about 0.011 ms per frequency. This is a two-point fit of F21: (16.4 - 7.3) ms / (928 - 116) frequencies gives 0.0112 ms, leaving about 6 ms fixed. UNCERTAIN until measured.
- Memory: about 24 MB transient per native call (F21). One native process at a time (Engine lock).
- The existing hard caps in `fit_probe_pcm` (`max_native_calls` <= 4096) and `predict_probe` (<= 32 hypotheses) remain in force. Network calls count against the same cap.

## 13. Assumptions and risks

| Item | Label | Evidence or mitigation |
|---|---|---|
| Branch-end products include all side branches | SAFE | F5; V6 reproduces native TF to 2e-9 |
| Sign and phase convention | SAFE | V6 phase agreement |
| Closed-velum native port (1e-4 cm2) is negligible | SAFE for pose a (<= 2.9e-3); UNCERTAIN elsewhere | V7 on poses i and u |
| Lumped-element accuracy at high frequency | UNCERTAIN | Lumped and distributed native differ by 0.1 at 5 kHz and 0.42 at 8 kHz (P4a, columns b and c). The compact-aperture mask (`ka <= 0.5`) usually limits open-mouth poses to about 2 kHz. |
| Glottis forced closed in native TL | Risk | Mis-models breathing trials. Q3. |
| Off-grid device frequencies | Blocker for real data | M3 patch (F20) |
| Free-field compact coupling for two apertures 1-2 cm apart | UNCERTAIN | No mutual radiation. Listed as a limitation. Needs reference-object test. |
| Poor conditioning with closed port | Managed | Residual gate V3; cond up to 3.8e6 observed |

## 14. Open decisions

- Q1: Approve the M3 native patch (changes the manifest, patch hash and library hash; needs one rebuild).
- Q2: Default native options for fitting: API default (lumped) or distributed. The recommendation is the API default, with distributed kept as a declared option; the held-out protocol would compare them only if the comparison is pre-declared.
- Q3: Glottal boundary for probe trials. The native call fixes a closed glottis. Exposing glottal area needs the M3 patch to take it as an input.
- Q4: External propagation constants (room air) versus tract constants (native) at the aperture.
- Q5: Reference-object validation. Native geometry cannot represent a bench object. Testing the five-equation solve and two-aperture coupling on a known tube needs a declared, measured-geometry branch input. That input is separate from, and must never replace, the native nasal branch.

## 15. Non-claims

- No measured nasal, sinus, fossa or tracheal geometry. All of it is the JD3 template (F11).
- No velum measurement. VO is a candidate parameter. A fitted VO is a model-conditional value, not an observed port area.
- A declared nostril seal is not measured occlusion. Nostril occlusion is never equivalent to velum closure.
- Native "velum closed" still carries a 1e-4 cm2 port (F10).
- Synthetic agreement (V1-V8) establishes software correctness against native code. It does not establish scientific accuracy for people.

## Appendix: native probe evidence

All probes: evidence `synthetic`/native, scientific outcome `untested`. Scripts live under the session scratchpad (not committed): `/private/tmp/claude-501/-Users-nicolelu/596d9883-9ad7-44b9-abd2-e88dbaf3c85a/scratchpad/nasal/`. They were run from this worktree with `PYTHONPATH=.:science/src science/.venv/bin/python <script>` against native library sha256 `0d064eab...eed0a`, one process at a time. The five-equation solve used by the probes (`probe_native_network.py`, function `solve`) is the system in section 3, with CGS native matrices. Excerpts are verbatim.

P1 `probe_native_network.py` (binding, sections, grid):
```
constants: sample_rate 44100 tube_count 40 tract_count 19
VO param: {'unit': 'cm^2', 'min': -0.1, 'max': 1.0, 'default': -0.1}
default opts: {'spectrumType': 0, 'radiationType': 3, 'boundaryLayer': True, 'heatConduction': False, 'softWalls': True, 'hagenResistance': False, 'innerLengthCorrections': False, 'lumpedElements': True, 'paranasalSinuses': True, 'piriformFossa': True, 'staticPressureDrops': True}
[full tube, pose a] velum_cm2 0.0 fossa L/V 2.5 1.5
  trachea  [ 0..22] n=23 sum_len_cm= 23.000 area_cm2 min/max=2.5/4
  glottis  [23..24] n= 2 sum_len_cm=  0.600 area_cm2 min/max=0.0001/0.0001
  pharynx  [25..40] n=16 sum_len_cm=  7.081 area_cm2 min/max=0.3266/3.495
  mouth    [41..64] n=24 sum_len_cm=  8.694 area_cm2 min/max=1.613/5.633
  nose     [65..83] n=19 sum_len_cm= 11.400 area_cm2 min/max=0.0001/4.24
  fossa    [84..88] n= 5 sum_len_cm=  2.500 area_cm2 min/max=0.12/1.08
  sinus    [89..92] n= 4 sum_len_cm=  2.050 area_cm2 min/max=0.11/0.185
  nose areas[0:5] [1.000e-04 2.650e-01 1.060e+00 2.385e+00 4.240e+00] nose[-1] 0.76
  sinus neck len/area/vol [0.3  0.3  0.45 1.  ] [0.185 0.185 0.145 0.11 ] [11.3  6.8 33.   6.2]
  wall mass/stiff/res std sec 30: 2.4 100000.0 5000.0
  sinus wall mass/res: 0.0 6500.0
  pharynx+mouth equals vtlTractToTube (length, area): True True tube velum 0.0
[grid] N=4096 df=10.766602 Hz numFreq=928 max valid f=9980.64 Hz
  N=512: df=86.1328 numFreq=116 fmax=9905.3
  N=16384: df=2.6917 numFreq=3715 fmax=9996.8
  N=32768: df=1.3458 numFreq=4096 fmax=5511.2
  k=46 f=  495.26 rc=0 |det-1| pharynx/mouth/nose = ['4.2e-10', '4.4e-16', '1.1e-11'] Zrad_mouth=0.05007+1.005j Zrad_nose=0.05017+1.947j Zfossa=53.06-355.3j
  k=139 f= 1496.56 rc=0 |det-1| pharynx/mouth/nose = ['8.5e-10', '1.0e-15', '5.1e-12'] Zrad_mouth=0.4482+2.977j Zrad_nose=0.4556+5.853j Zfossa=0.7146-95.58j
  k=279 f= 3003.88 rc=0 |det-1| pharynx/mouth/nose = ['5.5e-10', '3.3e-16', '4.6e-12'] Zrad_mouth=1.692+5.599j Zrad_nose=1.803+11.54j Zfossa=0.1582-36.41j
  k=1500 f=16149.90 rc=0 |det-1| pharynx/mouth/nose = ['0.0e+00', '0.0e+00', '0.0e+00'] Zrad_mouth=0+0j Zrad_nose=0+0j Zfossa=0+0j  P40==I:True
  k=N/2 rc 2
```
(Impedances in P1 are CGS, dyn s/cm5.)

P2 native transfer-function equivalence and velum-closed port (same script):
```
[native TF equivalence] pose a, drive p_b=1 at lips and nostrils, readout p at section-25 centre
  f=  495.26 native=2.77379-0.464372j reciprocal=2.77379-0.464372j rel_err=4.01e-10 residual=3.2e-13 cond=3.8e+06
  f= 1496.56 native=1.20744+0.0969157j reciprocal=1.20744+0.0969157j rel_err=6.09e-10 residual=4.5e-13 cond=1.5e+06
  f= 3003.88 native=-0.904902-0.0110873j reciprocal=-0.904902-0.0110873j rel_err=3.97e-10 residual=1.6e-13 cond=5.4e+05
[velum-closed limit, pose a] mouth input impedance seen from the lips, SI Pa s m^-3
  f=   96.90 |Zin| native+nose=4.8942e+06 nose-cut=4.9028e+06 (rel 2.9e-03) rigid-glottis native=4.9112e+06 (rel 3.0e-03) | existing oral line=6.1001e+06 (rel vs nose-cut 0.76)
  f=  204.57 |Zin| native+nose=3.1800e+06 nose-cut=3.1802e+06 (rel 1.4e-03) rigid-glottis native=3.1801e+06 (rel 1.5e-03) | existing oral line=2.8245e+06 (rel vs nose-cut 0.32)
  f=  398.36 |Zin| native+nose=1.2904e+06 nose-cut=1.2901e+06 (rel 6.7e-04) rigid-glottis native=1.2895e+06 (rel 9.4e-04) | existing oral line=1.1639e+06 (rel vs nose-cut 0.11)
  f=  796.73 |Zin| native+nose=5.5040e+05 nose-cut=5.5049e+05 (rel 4.3e-04) rigid-glottis native=5.5171e+05 (rel 3.9e-03) | existing oral line=3.2117e+05 (rel vs nose-cut 0.43)
  f= 1604.22 |Zin| native+nose=8.1488e+05 nose-cut=8.1496e+05 (rel 1.4e-04) rigid-glottis native=8.1504e+05 (rel 1.4e-04) | existing oral line=8.1862e+05 (rel vs nose-cut 0.05)
  f=  495.26 |Zin| native+nose=7.9687e+05 nose-cut=7.9661e+05 (rel 6.3e-04) rigid-glottis native=7.9607e+05 (rel 1.1e-03) | existing oral line=7.4584e+05 (rel vs nose-cut 0.06)
  f= 1496.56 |Zin| native+nose=5.8052e+05 nose-cut=5.8058e+05 (rel 1.6e-04) rigid-glottis native=5.8066e+05 (rel 2.1e-04) | existing oral line=5.6479e+05 (rel vs nose-cut 0.08)
  f= 3003.88 |Zin| native+nose=2.8773e+06 nose-cut=2.8774e+06 (rel 4.8e-05) rigid-glottis native=2.8779e+06 (rel 2.1e-04) | existing oral line=2.9305e+06 (rel vs nose-cut 0.04)
```

P3 open port: equivalence, reciprocity, rigid seal (same script):
```
[VO=0.25] applied VO=0.250 velum_cm2=0.5000 nose areas[0:5]=[0.5    0.7338 1.435  2.6038 4.24  ]
  f=  495.26 TF rel_err=3.24e-10 res=9.0e-17 cond=4.1e+02 | U_N(mouth drive)=-0.002804+0.01228j U_L(nose drive)=-0.002804+0.01228j recip rel=1.3e-15 | rigid seal U_N=np.complex128(0j) res=5.9e-17 U_L/U_L(open)=1.0725
  f= 1496.56 TF rel_err=2.12e-09 res=3.3e-16 cond=8.0e+02 | U_N(mouth drive)=0.003451-0.006531j U_L(nose drive)=0.003451-0.006531j recip rel=1.1e-15 | rigid seal U_N=np.complex128(0j) res=1.7e-16 U_L/U_L(open)=0.9810
  f= 3003.88 TF rel_err=3.02e-10 res=1.2e-16 cond=2.6e+03 | U_N(mouth drive)=0.006472-0.0139j U_L(nose drive)=0.006472-0.0139j recip rel=4.0e-15 | rigid seal U_N=np.complex128(0j) res=4.5e-16 U_L/U_L(open)=0.9442
[VO=0.5] applied VO=0.500 velum_cm2=1.0000 nose areas[0:5]=[1.     1.2025 1.81   2.8225 4.24  ]
  f=  495.26 TF rel_err=3.85e-10 res=3.4e-16 cond=2.5e+02 | U_N(mouth drive)=-0.002697+0.01171j U_L(nose drive)=-0.002697+0.01171j recip rel=2.4e-15 | rigid seal U_N=np.complex128(0j) res=7.4e-17 U_L/U_L(open)=1.0844
  f= 1496.56 TF rel_err=6.24e-10 res=1.6e-16 cond=7.7e+02 | U_N(mouth drive)=0.00347-0.006632j U_L(nose drive)=0.00347-0.006632j recip rel=1.7e-15 | rigid seal U_N=np.complex128(0j) res=2.3e-16 U_L/U_L(open)=0.9813
  f= 3003.88 TF rel_err=3.29e-10 res=4.5e-16 cond=1.2e+04 | U_N(mouth drive)=0.0547+0.0202j U_L(nose drive)=0.0547+0.0202j recip rel=8.0e-16 | rigid seal U_N=np.complex128(0j) res=5.2e-16 U_L/U_L(open)=1.1572
```

P4 reduction to v1. `probe_distributed_limit.py` (exact, V8):
```
pose a: distributed lossless native vs existing line (native rho,c), rel |dZ| by f[Hz]: 97:3.9e-15 205:2.7e-14 495:4.5e-14 1497:1.7e-14 3004:1.4e-14 4996:1.6e-13 8000:3.4e-15 10767:1.5e-12 16150:3.3e-13 19380:4.2e-12
pose i: distributed lossless native vs existing line (native rho,c), rel |dZ| by f[Hz]: 97:3.5e-15 205:1.8e-13 495:9.2e-15 1497:1.1e-15 3004:5.6e-15 4996:4.4e-14 8000:8.3e-13 10767:1.8e-13 16150:6.6e-13 19380:2.2e-12
pose u: distributed lossless native vs existing line (native rho,c), rel |dZ| by f[Hz]: 97:2.5e-15 205:4.8e-13 495:1.3e-13 1497:3.9e-16 3004:6.4e-16 4996:1.1e-13 8000:1.7e-13 10767:6.0e-13 16150:1.6e-12 19380:1.2e-11
```
P4a `probe_oral_limit.py` (lumped native against v1; reference (b) = native lumped, walls, boundary layer and fossa off, rigid end, nose cut; (a) native defaults; (c) v1 line with native density and sound speed, no attenuation; (d) v1 as shipped):
```
  f=   96.90 (a)=4.9028e+06 rel 8.30e-01 | (b)=6.2441e+06 | (c)=6.2441e+06 rel 7.63e-06 | (d)=6.1001e+06 rel 2.80e-01
  f=  495.26 (a)=7.9661e+05 rel 1.65e-01 | (b)=7.5320e+05 | (c)=7.5344e+05 rel 3.17e-04 | (d)=7.4584e+05 rel 1.39e-01
  f=  796.73 (a)=5.5049e+05 rel 1.41e+00 | (b)=2.3225e+05 | (c)=2.3174e+05 rel 2.19e-03 | (d)=3.2117e+05 rel 5.79e-01
  f= 1496.56 (a)=5.8058e+05 rel 2.28e-01 | (b)=4.7398e+05 | (c)=4.7241e+05 rel 3.31e-03 | (d)=5.6479e+05 rel 2.29e-01
  f= 3003.88 (a)=2.8774e+06 rel 1.55e-01 | (b)=2.4964e+06 | (c)=2.4760e+06 rel 8.14e-03 | (d)=2.9305e+06 rel 1.86e-01
  f= 4995.70 (a)=4.3691e+06 rel 6.19e-02 | (b)=4.5597e+06 | (c)=4.1108e+06 rel 9.85e-02 | (d)=6.9294e+06 rel 5.55e-01
  f= 7999.58 (a)=3.1692e+06 rel 3.94e-02 | (b)=3.1329e+06 | (c)=4.4544e+06 rel 4.22e-01 | (d)=2.9028e+06 rel 9.76e-02
```
P4b `probe_oral_attribution.py` (one native option added to (b) at a time):
```
  f=   96.90 softWalls=8.17e-01 boundaryLayer=3.85e-04 piriformFossa=4.15e-02 lung+glottis=1.60e-02
  f=  495.26 softWalls=2.23e-01 boundaryLayer=8.98e-03 piriformFossa=1.50e-01 lung+glottis=2.05e-03
  f=  796.73 softWalls=3.89e-01 boundaryLayer=8.11e-02 piriformFossa=2.29e+00 lung+glottis=8.14e-03
  f= 1496.56 softWalls=4.84e-02 boundaryLayer=3.65e-02 piriformFossa=2.66e-01 lung+glottis=7.63e-04
  f= 3003.88 softWalls=1.11e-02 boundaryLayer=2.05e-02 piriformFossa=1.70e-01 lung+glottis=1.78e-04
```

P5 `probe_anatomy_state.py` (anatomy dependence at VO=0.5; native state after the new calls):
```
template                 velum_cm2=1.0000 nose_len=11.400 nose_area[4:]==template True sinus==template True fossa=2.5,1.5 trachea_len=23.0 pharynx_mouth_len=15.620
palate_depth=4.5         velum_cm2=1.2500 nose_len=11.400 nose_area[4:]==template True sinus==template True fossa=2.5,1.5 trachea_len=23.0 pharynx_mouth_len=15.740
soft_palate_length=2.4   velum_cm2=1.0118 nose_len=11.400 nose_area[4:]==template True sinus==template True fossa=2.5,1.5 trachea_len=23.0 pharynx_mouth_len=15.640
pharynx_length=7.5       velum_cm2=1.0000 nose_len=11.400 nose_area[4:]==template True sinus==template True fossa=2.5,1.5 trachea_len=23.0 pharynx_mouth_len=16.115
anatomy restored: True | spectrum identical after TL/full-tube calls: True | geometry identical: True
```

P6 `probe_timing.py`:
```
geometry (vtlTractToTube) 8.93 ms; vtlTractToFullTube 3.05 ms
vtlGetTLIntermediateValues N=512: 7.30 ms/call (one frequency per call)
vtlGetTLIntermediateValues N=1024: 8.63 ms/call (one frequency per call)
vtlGetTLIntermediateValues N=4096: 16.39 ms/call (one frequency per call)
vtlGetTLIntermediateValues N=16384: 48.45 ms/call (one frequency per call)
engine.spectrum bins=4096: 19.53 ms
```
