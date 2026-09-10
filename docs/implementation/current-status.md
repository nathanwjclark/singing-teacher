# TractStar implementation status

This describes the integrated application including PR #10, the merged Tract Star branding, and the subsequent source/session connections. It distinguishes executable software from evidence that the
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
  into physiological measurements. Saved cues can enter the existing reviewed
  recall/transfer protocol with their original lineage; unprompted phases hide
  adjacent assistance as well as the protocol's own cue.
- Session export downloads authoritative server history, IDs and artifact hashes.
  Raw media and credentials are explicitly omitted; retained originals are needed
  for a complete numerical rerun. Missing receipts remain visible as omissions.
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

Optional source/tract fitting, isolated aggregate execution, atomic session adoption,
committed forecasts and later scoring now traverse the actual native app path.
The source result is separate from baseline anatomy. Actual source candidates and
scores reach Astra's decision context; scoring may explicitly retain the source
model. Enable the server capability once with `PHONATION_SOURCE_ENABLED=1` and use
the app's opt-in controls. See
[phonation status](PHONATION-STATUS.md) for the independently gated capabilities.

Human anatomical recovery, individualized tissue mechanics and teaching benefit
remain unvalidated. Physical phone acquisition and acoustic-probe calibration
require device evidence. Depth and visible tongue measurements do not expose
hidden cavities or internal musculature. These limitations constrain scientific
claims; they do not mean the numerical engine or connected app is absent.

Motion recordings support recorded 2D trajectory review and app-side retention of
the original JSON and hash-bound companion video. Saving is available from the
normal capture/replay controls; saved download links survive reload. Gaps, failed
attempt markers and unknown synchronization remain explicit. This evidence is
not automatically included in a physical fit. These recordings cannot be
converted into the existing synthetic direct-transfer dynamic fitter's input:
depth, rigid alignment, synchronization and the acoustic quantity differ.
The app now offers a bounded audio-only consumer: it decodes the retained
recording, compares three windows against finite source/articulation alternatives
on retained anatomy, and preserves the original evidence and baseline. This is
conditional acoustic analysis linked to motion review; measured 2D movement does
not enter the physical fitting objective.

## Remaining ownership

- **Lead A, further research:** validate and extend the conditional audio windows
  into a temporally coupled model, and define a calibrated visual forward
  observation model before fitting visible trajectories jointly. The current
  independent-window audio fit must not be described as recovered dynamic
  anatomy or verified motor control.
- **Lead B, acquisition evidence:** collect real phone/depth/probe captures with
  declared device calibration and timing uncertainty; complete native iOS build
  and device checks in an Xcode-capable environment.
- **Both leads, scientific validation:** evaluate held-out human recordings and
  paired reference measurements before claiming anatomical recovery, closure
  detection or coaching benefit. Synthetic recovery establishes software
  execution only.

Current integration evidence: source/replay/learning browser suite 20 passed;
actual native source lifecycle and source-to-Astra route checks passed; motion
persistence adds two real-server browser tests with exact original downloads
and rejection/fallback coverage. Build/typecheck and lint passed.

The optional motion-audio path additionally passed actual encoded-media app
runtime checks (voiced, silent, no-audio, missing decoder, restart reuse and
unchanged baseline), plus real-server browser checks for actual native results
and unavailable states. The final UI refreshes baseline identity before a new
analysis while preserving uncertain retry identities. See
[motion audio review](motion-audio-review.md).
