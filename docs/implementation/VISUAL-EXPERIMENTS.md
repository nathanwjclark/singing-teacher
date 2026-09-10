# Optional visual experiments and illustrated teaching

These are separate features. Conditional visual likelihood compares original
recorded pixels with frozen projections. Illustrated teaching explains a cue,
with general educational views and separately enabled native comparisons.

## Enable at app startup

After the existing Python/native installation and `npm run build`, set the
desired server flags when starting `npm run science:local` or
`npm run science:private`:

| Flag | Optional capability |
|---|---|
| `VISUAL_LIKELIHOOD_ENABLED=1` | Original-video frame indexing, explicit correspondence declarations, fixed-camera calibration, frozen targets and later annotation scoring. |
| `VISUAL_TEACHING_ENABLED=1` | Allows Astra to select supported versioned teaching demonstrations. General explanations remain distinct from personalized predictions. |
| `VISUAL_TEACHING_MODEL_ENABLED=1` | Enables supported native model comparison preparation and model-bound geometry/prediction artifacts in the teaching integration. |
| `VISUAL_TEACHING_AUDIO_ENABLED=1` | Allows explicit playback of available model-synthesized comparison audio when personalized teaching is enabled. No autoplay. |

These opt-ins default off. Their absence does not block ordinary recording,
voice modeling or coaching. They are installation choices, not per-attempt
backend steps; subsequent frame selection, declarations, freeze, scoring and
comparison controls are in the app. Live Astra still requires its server-side
credential and bounded-call configuration. A visual experiment does not itself
require a paid model call.

## Conditional visual likelihood

In Experiments, select an existing saved motion capture and **Index original
video frames**. Choose one calibration frame. Annotate the declared upper and
lower native outer-lip correspondences, or report occlusion/missing evidence.
The picker uses decoded original dimensions and pixels without auto-rotation;
it does not reinterpret MediaPipe points 13/14 as the native markers.

Declare the vowel, assumed jaw angle, finite camera rotation/scale candidates
and calibration tolerance. Select a disjoint later target frame and **Calibrate
and freeze visual forecast**. Once the forecast is committed, **Open frozen
target frame**, annotate it or mark it missing, and **Score frozen visual
forecast**. Reloading retains the committed predictions and source bindings.

Results report calibration support and held-out pixel discrepancies for joint
anatomy/camera candidates. Equivalent candidates stay ambiguous. Missing
correspondences are unscorable, not perfect predictions. This operator preserves
the baseline model; it does not infer calibrated continuous motion, unique
metric anatomy or hidden tissue. See the
[conditional visual plan](../physiology/conditional-visual-likelihood-plan.md).

Two actual native app/browser flows passed using transparently generated video
and projected correspondence labels: visible target scoring and occluded target
scoring, including reload and unchanged baseline/forecast checks. These are
software results, not validated human correspondences.

## Illustrated teaching integration

The A-owned teaching integration contains general cricothyroid, soft-palate,
tongue/jaw and source/filter explanations, plus a supported native comparison
adapter. The UI distinguishes **General explanation**, **Your model's
prediction** and **Your recorded result**. Unsupported mechanisms remain
educational rather than receiving fabricated personalized geometry or sound.

Native teaching browser acceptance passed with real HTTP geometry, explicit
A/B synthesis playback and a recorded numerical outcome, followed by historical,
educational, reduced-motion and mobile checks. The decision in that fixture was
seeded and no paid model call was made. See the [delivery audit](../coordination/2026-09-10-delivery-audit.md)
for integration receipts and remaining physical/human evidence. The
[teaching plan](../physiology/visual-teaching-plan.md) defines acceptance.
