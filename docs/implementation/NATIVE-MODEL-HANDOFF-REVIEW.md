# Private native model handoff review

`review-native-model-handoff.py` binds the original verified native capture, ZIP, dynamic diagnostic and frozen chronological split. It invokes the scientific native reader and actual VTL reference mesh exporter. It reports calibration and withheld-frame eligibility separately; missing observations or predictions never produce zero-error scores.

This is a readiness assessment, not a new fitting operator. The current dynamic visible-patch diagnostic has no validated anatomical correspondence, physical calibration uncertainty or predictive tongue-control model. The report therefore abstains from anatomical fitting even when diagnostic surfaces exist. Anonymous deeper-cavity returns cannot replace missing tongue depth. Native reference anatomy and meshes are explicitly unfitted and never applied to the live model.

Run with the existing scientific environment; all paths must remain private:

```sh
science/.venv/bin/python scripts/review-native-model-handoff.py /private/original-capture \
  --capture-zip /private/capture.zip \
  --dynamic-analysis /private/dynamic-review/analysis.json \
  --output .local-data/capture/model-review
```

Original source identity, native artifact hashes and diagnostic hash are retained. A viewed contact sheet before freezing a split must remain disclosed; it is not a blinded evaluation. To unlock a physical fitting experiment, provide simultaneous tongue/rigid-face depth, validated measurement mapping/error, declared surface correspondence and prospective articulation inputs or a motion predictor. These are data/operator dependencies, not test-suite failures.
