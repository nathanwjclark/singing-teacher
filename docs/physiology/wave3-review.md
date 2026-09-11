# Independent third-wave scientific review

Scope: richer spectral observation models, mechanical source hypotheses, continuous motion, learned cue execution, app probe calibration, and full score reproduction. The prototype already connects the research loop; this wave tests its scientific assumptions and expands supported operators.

## Frozen review criteria

The independent protocol in `evaluation/wave3/protocol.json` was fixed against main `304ee87`, before reading the new implementations. Its generated truth is deliberately absent from the four-member anatomy/source grid. The cases are a clean observation, gain change, spectral coloration, noise, incorrectly fixed jaw/F0, anatomy outside support, wholly missing evidence, and exact duplicate hypotheses.

1. Both old and new objectives receive identical candidate PCM and the same calibration observations. Freeze candidate predictions and calibration ranking before opening held-out target PCM. Report actual synthesis and extraction counts separately; reused predictions are declared reuse, not free extra search.
2. Report per-case failures, missing predictions and ties. A wholly missing record cannot produce a finite fit. Identical candidates must remain indistinguishable to the objective; deterministic list ordering is not evidence of uniqueness.
3. Distinguish fixed JA/F0/source/gain assumptions from learned values. A smaller residual is not proof of anatomy recovery. A compensating source or capture parameter may explain the same signal.
4. Nuisance gain/tilt estimated separately for each candidate is a conditional profile discrepancy. It is not calibrated likelihood or Bayesian marginalization. Preserve the fitted nuisance values and declared bounds.
5. A mechanical simulator controls masses, spring forces and collision according to its implementation. Selecting its parameters from microphone audio does not establish actual vocal-fold closure, tissue properties, muscle activation or contact measurements.
6. A learned cue predictor must bind attempts to the actual instruction and model version. Score later execution prospectively. Reusing the same attempt for calibration and success evaluation is leakage; sensations alone are not measured kinematics.
7. Changes to native source family, extractor, scoring policy or capture calibration invalidate incompatible frozen predictions. Keep original receipts and explicit incompatibility reasons.
8. State implementation, evidence source and scientific outcome independently. Passing generated/native tests establishes execution under those conditions; physical-device and human reference evidence remain separate.

## Review limits

This is a small falsification/stress suite, not a representative benchmark or a calibrated uncertainty study. Its results may be negative or inconclusive. Model parameters must not be tuned to make these fixed cases pass. New tuning requires a new training set and a separately frozen evaluation revision.

## First independent execution

Protocol commit `761f8ef`; harness `b442c1e`; production spectral module `8c68f60`. The unmodified first run used 21 native calls with zero synthesis failures. Canonical extraction ran 86 times, including rejected inputs; spectral extraction ran 30 times. The same forecast PCM was reused by both objectives. Three protocol integrity checks passed. Results and hash receipts are committed in `evaluation/wave3/results/`; the command is in its provenance record.

Scientific outcome: **mixed and inconclusive**, not an anatomical recovery claim. No weights, candidate parameters, gains or stress settings were changed after seeing these results.

| Case | Coarse calibration choice | Spectral calibration choice | Independent observation |
|---|---|---|---|
| Clean | anatomy 0/source 1 | anatomy 0/source 1 | Both choose their held-out minimum among scorable predictions; the absolute held-out mismatch remains large. |
| Half amplitude | anatomy 0/source 0 | anatomy 0/source 1 | Spectral choice remains the held-out minimum; coarse choice changes with gain. |
| Low-pass coloration | anatomy 0/source 0 | anatomy 0/source 0 | Neither calibration choice is its held-out minimum. |
| Added noise | anatomy 0/source 1 | anatomy 0/source 0 | Coarse choice is its held-out minimum; spectral choice is not. |
| Wrong fixed JA/F0 | No scorable calibration | No scorable calibration | One calibration vowel lacks required descriptors. The failure is retained. |
| Anatomy outside support | anatomy 0/source 0 | anatomy 0/source 1 | Coarse choice is its held-out minimum; spectral choice is not. A small spectral residual does not detect absence of true anatomy from the grid. |
| All missing | No fit | No fit | All calibration and held-out scores remain null. |
| Exact degeneracy | Both aliases tied | Both aliases tied | Identical forecasts remain exactly equal; ordering supplies no evidence of uniqueness. |

Two of the four held-out candidate predictions clip under the frozen gain and remain explicitly unscorable for both objectives. This reduced comparison coverage prevents a clean four-way generalization claim. The clean selected candidate's coarse calibration discrepancy is 0.000578, yet held-out discrepancy is 36.6066 on that objective. The spectral held-out comparison reaches its +24 dB gain bound and retains 16.58 dB unexplained level. These diagnostics show why a tiny calibration residual cannot be treated as physiological identification. Scores on the two objective scales are not directly comparable.

## Concrete review findings

1. **P1, fixed: insufficient exact-frame binding in the first spectral draft.** Matching whole-artifact identity alone could pair the spectrum from one time window with another canonical trial. `science/src/singing_physics/pcm_spectral.py` now requires the exact frame hash and sample offset; the importer appends the independently computed frame hash and forecasts bind the canonical float32 hash. Focused production tests check mismatched hashes/offsets.
2. **P2, fixed: nuisance-label ambiguity.** The spectral objective removes an unbounded DC offset separately at each resolution as well as fitting bounded overall level/tilt. Diagnostics now state that centering explicitly. The bounded-adjustment label must not be read as bounding every discarded degree of freedom.
3. **Scientific limitation, retained: sparse-grid confounding and prediction coverage.** The fixed experiment above supplies direct negative/inconclusive evidence. A production UI must retain failed alternatives, fixed execution assumptions, nuisance saturation and mismatch reasons. It must not turn the minimum residual into a probability of anatomical correctness.

## No-stubs, wiring and minimality audit

The independent harness calls the actual native source synthesizer, canonical TypeScript PCM extractor and production spectral scorer. It does not substitute prerecorded scores, mock a native response or emit a positive result on failure. Every generated frame is hashed; synthesis failures and rejected observations are retained. The harness is deliberately an offline investigator tool, linked from its README with an executable command; it does not mutate the session model. There are no new third-party dependencies. Test signals are explicitly generated development fixtures and contain no personal information.

The scoring-policy pin invalidates frozen predictions when implementation/runtime changes. The committed result is tied to the tested spectral implementation hash; subsequent integration changes require their own compatibility checks rather than relabeling this result as a fresh experiment. Physical phone capture, microphone response calibration, independent anatomical/EGG references and human learning efficacy remain untested by this suite.
