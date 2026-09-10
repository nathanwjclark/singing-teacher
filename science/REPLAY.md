# Scientific integration replay

This runner exercises the implemented local backend end to end with real simulator
outputs. It proves module and artifact integration, not anatomical recovery or
validity on human recordings. It does not replace Lead B's independent evaluation.

From a checkout with the native simulator built and Python package installed:

```sh
PYTHONPATH=science/src science/.venv/bin/python science/scripts/replay_science.py science/artifacts/scientific-replay --budget 20
PYTHONPATH=science/src science/.venv/bin/python -m pytest science/tests/test_scientific_flow.py -q
```

Use a new output directory for each run. Existing directories are refused. Budget
is the residual-call cap for each of the joint and fixed-anatomy models; each call
uses two native spectra in this replay. With budget 20, the total is at most 40
residual calls / 80 spectra. This deliberately small integration budget is not an
anatomical recovery performance threshold.

The sequence is:

1. Generate calibration vowel spectra `a` and `i` with distinct jaw controls from a
   known synthetic anatomy; export native capabilities and matching forward audio
   and geometry. Keep truth and the synthetic `u` observation in separate files.
2. Submit calibration spectra only to `JobService.fit_joint`. Joint anatomy and
   per-trial articulation are estimated without supplied truth controls.
3. Freeze the returned geometry candidates with model identity, calibration evidence
   IDs, native provenance, timestamp and canonical content digest.
4. Submit a forecast for `u` with explicitly proposed jaw control. Store the immutable
   forecast and replay the job, requiring identical numerical output and exact
   artifact bytes. These predict tract transfer, not microphone audio.

The output includes:

- `fit-input.json`: exact calibration document, without ground-truth geometry or
  jaw controls and without held-out spectra.
- `generation-truth.json` and `heldout-observation.json`: separately stored synthetic
  generation records, available for an independent evaluator.
- `frozen-candidates.json`: canonical candidate artifact consumed by prediction.
- `capabilities.json` and `synthetic-forward/`: native provenance and paired forward
  WAV/SVG/tube/transfer artifacts.
- `jobs/artifacts/<job-id>/`: fit and forecast results with integrity-checked manifests.
- `summary.json`: lineage, job IDs, computational counts and explicit claim limits.
- `replay-manifest.json`: hashes for replay outputs outside the durable job store;
  job artifacts have their own service-managed manifests.

This is a **retrospective synthetic replay**: the held-out observation was generated
before the forecast. It must not be presented as commit-before-human-capture
validation. The proposed jaw control is part of the experiment, not a recovered
hidden target behavior. Candidate geometry is passed to forecasting; fitted trial
controls are retained in the fit result but not silently reused as target controls.
No independent score or physiological accuracy result is fabricated.

Acceptance tests verify lineage, budget counts, real audio/geometry artifacts,
byte-stable forecasting, rejection of unsupported nasal plugging and fitting-evidence
reuse as a prediction target, and integrity failure after artifact mutation.
