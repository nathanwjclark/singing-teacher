# App-operated voice experiments

After the existing local app/worker and iPhone connection setup, ordinary voice
experiments do not require backend commands, configuration files or session hashes.

1. Record a comfortable sustained **ah** in the native iPhone app and save it.
2. In the desktop app, click **Pull iPhone**, open **Experiments**, confirm the
   recording contains the stated vowel without played probes, then click
   **Fit latest iPhone capture**.
3. The app verifies and prepares the original archive, fits the physical
   hypotheses and commits the selected forecast. It retrieves the result itself.
4. Follow the displayed vowel instruction, save a new native recording, and click
   **Pull iPhone** again. Confirm this is the new attempt and click
   **Score latest iPhone capture**.
5. The app shows the numerical errors, scientific result, retained hypotheses and
   model lineage. Poor agreement or a stopped attempt is not presented as success.

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
