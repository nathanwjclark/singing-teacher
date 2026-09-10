# Applying native model geometry

The Studio toolbar's **Model adjustments** control verifies the current private run's
`space-diff.json` SHA-256 and byte length before applying it. **Clear model** and
**Reset tracking** remove the application. Application is opt-in and is not persisted.

The blue airway and tongue use the native reference geometry. Bright green is
candidate-only space and bright red is reference-only space, calculated using
polygon subtraction. The candidate outline is pale blue. Turning off differences
shows the candidate geometry alone. The native pair has identical units,
registration and declared pose; each shape is never independently resized to match.
This comparison is not against a reconstructed patient airway and colors do not
mean good or bad technique.

`live_capture_jobs.py` now performs a second native forward export using reference
anatomy, in addition to the existing candidate forward export. The complete run has
47 synthesis calls (36 search + 9 prospective forecasts + 2 exports). The paired
artifact is hashed into the existing summary. Existing runs without this artifact
remain viewable; the application control explains that a new run is required.

`model_space_diff.py` reads named-order sagittal contours from the current VTL
native SVG exporter (`VocalTract::exportSvg`, upper cover / uvula / lower cover /
tongue). It makes a closed sagittal airway envelope and tongue section, not a
cross-sectional area measurement. Native contours are in the same VTL frame.
A single illustrative affine registration places both on the licensed head atlas;
this atlas placement is not personalized anatomical registration. Both share the
existing live head/jaw/tongue deformation surface.

The current inverse experiment estimates **only hard palate length**. In the
actual checked output it changes from 4.70 to 4.45 cm. It does not estimate jaw
angle, shoulder posture, muscle tension, or muscle activation. Accordingly those
quantities are not fabricated. A separate optional **Preview declared jaw pose**
checkbox applies the actual exported JA (-3 degrees in this run) to shared motion
state. This rotates the existing mandible and attached muscles in the front view
and the same jaw in the side view. Live tongue and head motion remain active.
The static full native 3D candidate remains available through the existing Model
mode. The research model does not export a personalized musculoskeletal mesh.

Validation was kept light: build/lint and a Chrome smoke using the actual existing
candidate plus one real native reference export. The visible difference texture
contained 9,938 red, 2,985 green and 190,954 blue pixels; the declared jaw was exactly
3 degrees in shared state, live tongue height was preserved, Clear removed the
applied state, and the page reported no JavaScript errors. Screenshot:
`/tmp/model-diff-native.png` (local only). New full jobs should be rerun once after
integration to publish the paired artifact through the private service.
