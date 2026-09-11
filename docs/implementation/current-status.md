# TractStar implementation status

For the September 10 usage-recovery checkpoint, active A-owned visual/teaching
work, preserved user changes and verification boundaries, see the
[delivery audit](../coordination/2026-09-10-delivery-audit.md). That audit names
separate integration branches; candidate work is not automatically merged main.

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

- **Lead A, conditional visual observation:** original-frame outer-lip projection,
  fixed declared camera calibration, frozen targets and held-out scoring are
  implemented with explicit missing/ambiguous results and an unchanged baseline.
  Calibrated continuous-motion inference and human correspondence validation
  remain separate work. The optional
  fixed-anatomy temporal comparison now reports heuristic path penalties and
  sensitivity over existing audio windows; it does not recover continuous
  motion or verified motor control. See [temporal comparisons](../../science/MOTION_PATH.md).
- **Lead A, source forecast comparison:** connected. Every bounded competing
  source/tract prediction is frozen before the later recording, then scored
  against one canonical original frame. Conditional ranking versions reach the
  next round and Astra; unsupported alternatives stay visible. See
  [matched source budgets](../../science/SOURCE_BANK_BUDGET.md).
- **Lead B, acquisition evidence (except A-owned rear LiDAR):** collect real phone/depth/probe captures with
  declared device calibration and timing uncertainty; complete native iOS build
  and device checks in an Xcode-capable environment.
- **Both leads, scientific validation:** evaluate held-out human recordings and
  paired reference measurements before claiming anatomical recovery, closure
  detection or coaching benefit. Synthetic recovery establishes software
  execution only.

Current integration evidence: source/replay/learning browser suite 20 passed;
actual native source lifecycle and source-to-Astra route checks passed; motion
persistence adds two real-server browser tests with exact original downloads
and rejection/fallback coverage. The final native teaching/browser flow passed
with geometry, explicit A/B synthesis, recorded outcome, historical and
educational views, reduced motion, mobile layout and complete app mounting.
Build/typecheck and lint passed. The evidence is generated/software evidence;
no human anatomical or learning claim follows from it.

The optional motion-audio path additionally passed actual encoded-media app
runtime checks (voiced, silent, no-audio, missing decoder, restart reuse and
unchanged baseline), plus real-server browser checks for actual native results
and unavailable states. The final UI refreshes baseline identity before a new
analysis while preserving uncertain retry identities. See
[motion audio review](motion-audio-review.md).

Motion-analysis receipts now enter session exports only after original byte/hash
verification and session/model binding. Astra receives bounded current-model
motion evidence and optional temporal comparisons; unavailable or stale motion
evidence does not block the existing decision flow. Raw media is not sent.

The later [A-owned rear LiDAR plan](../physiology/optional-lidar-plan.md) is merged.
Optional scanning, original-byte projection, experimental visible-lip likelihood,
durable model adoption, native preview, Astra context and replay are connected.
Enable fusion independently with `LIDAR_FUSION_ENABLED=1`. See
[LiDAR implementation status](LIDAR-STATUS.md) for the supported operator, explicit
uncertainty assumptions, bounded budgets and remaining iOS/device/reference checks.


An offline [score recomputation adapter](../../science/SESSION_SCORE_RECOMPUTATION.md)
can rerun one exported PCM update against a retained original frame and original
controller replay. It reports numerical agreement separately from unverified
legacy scoring-policy provenance; it does not fabricate missing media.

The connected conditional visual workflow and independently gated illustrated
teaching integration are described in [visual experiments](VISUAL-EXPERIMENTS.md).
Two real native/browser visual flows passed with synthetic evidence, including
visible and missing targets after reload. Illustrated teaching acceptance also
passed with synthetic/native evidence, including explicit model audio and a
recorded numerical outcome. Calibrated motion and human anatomical accuracy are
not implied by either implementation.

## Third-wave scientific work

The merged prototype is ready for the next model-improvement phase. The
authoritative workstream map and unmerged branch checkpoints are in the [Wave 3
handoff](../coordination/WAVE3-HANDOFF.md). Active work includes a versioned
multi-resolution spectral objective, cue-conditioned execution support, a native
two-mass source family, time-resolved audio trajectory inference, a coupled
oral/nasal external-drive operator, app-managed probe calibration, read-only
recomputation, melodic transfer and independent equal-budget evaluation.

The first independent spectral stress run is mixed/inconclusive: gain
perturbation robustness improved, but unseen-vowel generalization was poor and
noise/out-of-support cases could worsen. This result is preserved as a research
boundary; Wave 3 work must not advertise universal improvement without a new
held-out evaluation.

The spectral objective is selectable in the app's scientific model panel (the coarse objective stays the default) and runs through
search, sealed forecast and update with pinned scoring code. A second frozen
evaluation (three held-out vowels, equal native budgets, production scorer) is
inconclusive: both objectives hit 13 of 18 held-out comparisons. Details are in
[the spectral objective note](../physiology/WAVE3_SPECTRAL_OBJECTIVE.md) and
[the wave-three review](../physiology/wave3-review.md).
