# App-operated voice experiments

After the existing local app/worker and iPhone connection setup, ordinary voice
experiments do not require backend commands, configuration files or session hashes.

1. Open the desktop app. Record a comfortable sustained **ah** in Singing Depth
   on the connected iPhone and stop/save it. Keep the phone unlocked.
2. Click **Pull iPhone** in the desktop header. Its popover shows the verified
   capture and audio count. Confirm that this recording is the stated vowel with
   no played probe, then click **Fit and show model changes**. This declaration
   is necessary: a tongue-video capture is not automatically labeled singing.
3. The header spinner covers archive verification, modeling and geometry
   verification, even while the Studio is visible. Results arrive automatically.
   The app verifies the bound `space-diff.json` hash and applies the fitted/reference
   comparison to the live movement map and inside view. Failures open Experiments
   with the reason and do not apply an unverified overlay.
4. For a later prospective trial, follow the frozen vowel instruction, save a new
   recording, then pull again. In the popover choose **Score frozen prediction**,
   confirm that vowel, and click **Score and update model**. A new initial fit is
   also available and is the default; an existing older model does not force
   scoring. Experiments retains the more detailed fit/score controls.
5. The app shows numerical errors and retained model lineage. Outcome updates
   currently change the retained candidate set, not the exported geometry pair.
   The display says so; it never presents the original geometry as a newly
   reconstructed post-outcome surface. Poor agreement or stopped attempts remain
   explicit outcomes.

Preparation uses the original ordinary `capture-*.zip` archive already copied by
the USB feature. Linked session and probe archives are rejected with an explicit
message; they are not silently interpreted as ordinary voice. Capture time must
follow the committed forecast. Audio formats, clipping, native frame availability
and evidence reuse remain validated by the original import/update code. The app
does not authenticate human origin or measure whether declared internal controls
were reproduced. The forecast's control assumptions stay visible.

The new recording is prepared, imported, submitted, polled, collected and saved
automatically. Repeating an identical completed request returns the saved attempt.
Interrupted submissions resume with the same command identity; a stopped attempt
cannot publish an otherwise completed worker result. A changed session version
uses a fresh collection attempt only after confirming the old one did not commit.

Normal client interruption cancels its owned numerical jobs and clears terminal
pending state when the worker is reachable. Hard process kills and unavailable
workers can still require recovery after restart; the app reports an interrupted
or failed state rather than inventing completion.

## Integration surface

- `POST /api/science/use-latest-capture` takes only purpose, declared pose and
  `contains_external_excitation:false`; the server resolves and verifies the
  latest private USB receipt and prepares its own internal configuration.
- Bodyless `POST /api/science/run` starts initial modeling.
- Bodyless `POST /api/science/outcome` starts or resumes the later recording.
- `GET /api/science/status` and `/api/science/outcome` supply app display state.
  Outcome process status and the inner scientific result are separate.

Live Astra selection/coaching and the physical-device demonstration remain
separate integration work. These controls execute the supported numerical
experiment; they do not claim a live Astra call or validated anatomy.

## Browser integration events

Successful USB receipt publication emits `singing:native-capture` with the receipt.
Completed numerical results emit `singing:science-result` with `kind` (`fit` or
`outcome`), `runId`, `resultId`, `sourceCaptureId` and `result`. Events refresh views;
server-persisted receipts and summaries remain authoritative after a reload.
`singing:show-science` opens detailed progress/errors and `singing:show-model`
returns to live Studio after a verified new fit. New immutable outcome summaries
include the source capture ID and native manifest hash, including rejected outcomes.
Historical summaries lacking those fields remain unchanged.

The four focused browser checks include a simulated USB receipt through the
Studio-mounted hidden processor, spinner and hash-bound diff application. They
verify orchestration, not a physical-phone recording or anatomy accuracy.
