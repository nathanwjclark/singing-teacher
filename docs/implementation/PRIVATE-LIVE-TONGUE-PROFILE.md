# Private labeled tip tracking

The browser can load `/api/tongue-profile` when its vision engine starts. The local desktop server returns only `.local-data/tongue-review/live-tip-profile.json`; the profile is not a public asset. A missing/invalid profile keeps manual point tracking available. Camera shutdown cancels the request and discards all instance-local tracking state. Resetting/remounting the camera reloads the profile and clears its tracking references.

Create a private profile from the exported point labels:

```sh
science/.venv/bin/python scripts/build-private-tongue-profile.py \
  .local-data/tongue-review/review-direction-ignored.json \
  .local-data/tongue-review/live-tip-profile.json --training-count 16
```

The builder refuses to overwrite its output. It uses only the first specified chronological frames and their actual `label` points; direction dropdown tags are ignored. It records source hash and training/withheld frame indices. The private grayscale examples are derived participant media and must stay outside Git/public distribution.

Whole-mouth appearance selects among labeled examples. A local normalized correlation search transfers the chosen point label onto current visible texture. Both context and local support are required. The profile can acquire/reacquire a point without a manual click; a manual selection takes precedence while its texture remains supported. Correlation scores are similarities, not probabilities. Ambiguous manual tracking abstains but now retains its template to permit subsequent reacquisition instead of disabling tracking permanently.

Only a supported point produces `trackingMode: 'tip'`, a crosshair, and tongue motion. Tissue segmentation remains a distinct `region` observation and never substitutes its centroid for the tip. Point displacement is projected onto current mouth axes for lateral/elevation channels; the extension channel is an illustrative image-plane protrusion proxy, not measured depth. The default zero is mouth-relative, with the lower lip as tongue-rest height (the aperture midpoint made raised tips appear below neutral); only explicit Recenter establishes a personal offset. Profile features never provide a 3D tongue shape.

Validation must freeze the chronological training boundary before evaluation. Report withheld coverage and coordinate error together, including abstentions. Adjacent frames from one short recording are correlated and do not establish generalization to another person/camera/session. The available labeled recording has no hidden-tip examples, so occlusion specificity remains unvalidated. A different view, lighting, retracted tongue or unseen pose can be rejected or mislocalized; missing observations leave the model to its documented stale-data behavior.
