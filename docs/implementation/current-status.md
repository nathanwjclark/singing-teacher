# TractStar implementation status

This describes the integrated application at revision `7d33e79`, including the
merged PR #10 work. It distinguishes executable software from evidence that the
scientific hypotheses are correct.

## Available app flow

- Native iPhone capture transfer prepares ordinary voice recordings automatically.
  Fitting runs through the persistent numerical worker and publishes verified
  fitted/reference geometry. Later recordings score committed forecasts and
  retain the resulting model lineage, including unsuccessful outcomes.
- The live Astra loop reads derived scientific evidence, chooses a supported
  experiment, commits it before capture, and receives the later numerical score
  and successor model. Server-side credentials and finite call limits apply.
- Personal cue memory saves subjective sensations against actual recorded
  attempts and links matching Astra decisions. It does not convert sensations
  into physiological measurements. The separate cue-learning protocol remains
  available for recall and transfer experiments.
- Live camera/audio views, optional private neural tongue tracking, and optional
  phonation measurements report their own availability and limitations.

Use [the app voice flow](../../science/APP_VOICE_FLOW.md) for learner actions and
[Astra integration](ASTRA-INTEGRATION.md) for verified execution. Normal operation
does not require editing backend configuration, entering hashes or running
scientific commands between attempts.

## Start the connected app

After [one-time Python/native setup](../../science/README.md#setup), run
`npm install`, `npm run build`, then `npm run science:local`.
Open `http://127.0.0.1:5173`. After [local phone HTTPS setup](LOCAL-PHONE.md), use
`npm run science:private` when the phone needs the private HTTPS endpoint.
Both launchers start the scientific worker and app; `npm run local` alone does
not start the worker. Live Astra requires a server-side API key; numerical
experiments do not require a paid model invocation.

## Evidence and remaining work

The documented two-round live Astra/native test used synthetic recordings and
verified prospective decisions, scored outcomes, successor-model context and
replay without duplicate calls. Browser checks exercise app orchestration;
they do not establish physiological accuracy or coaching efficacy.

Optional source/tract research fitting exists, but its isolated aggregate
executor and application session adoption are **in progress**. The baseline
source assumptions remain explicit until that integration is verified. See
[phonation status](PHONATION-STATUS.md) for the independently gated capabilities.

Human anatomical recovery, individualized tissue mechanics and teaching benefit
remain unvalidated. Physical phone acquisition and acoustic-probe calibration
require device evidence. Depth and visible tongue measurements do not expose
hidden cavities or internal musculature. These limitations constrain scientific
claims; they do not mean the numerical engine or connected app is absent.
