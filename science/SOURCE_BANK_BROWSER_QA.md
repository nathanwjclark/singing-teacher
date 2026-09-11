# Source bank browser verification

`npx playwright test -c tests/source-bank-runtime.config.ts` runs this check automatically, and CI runs it. The config starts the actual local application and scientific worker with `PHONATION_SOURCE_ENABLED=1` on data that `tests/fixtures/prepare_source_bank_runtime.py` seeds by running the two-round integration test (`science/tests/test_app_source_loop.py`) and then one forecast with the optional runner missing, which the app records as failed. The browser then freezes a new bank from that failed state and checks the retained ranking. No API response is intercepted and no paid model call is made. The seeded run's `astra-current.json` comes from the integration test's stand-in decision provider (`provider: 'test-only'` in its bootstrap), not from Astra; `science/scripts/app_source.py` reads it to choose the vowel of the frozen bank. The config uses the default geometric source family; two-mass mode (below) is still verified only by hand.

The runs below predate that config; each used a manually started app over copied integration-test data and a Playwright config that has since been removed.

Verified on the actual local application and scientific worker, using generated native audio retained from the two-round integration test. No successful API responses were mocked and no paid model calls were made.

- Runtime: `0524095` (integration `28816c2` plus terminal source retry fixes `4175a45` and `c94793a`). Worker: `28816c2`.
- Command: `SOURCE_BANK_APP_URL=http://127.0.0.1:5284 CI=1 npx playwright test --config playwright.source-bank.config.ts tests/source-bank-runtime.spec.ts`
- Result: **1 passed in 48.7s**. Real app recovery from a failed forecast runner created a new frozen bank with **30 native synthesis calls and 30 alternatives**. The prior baseline model, source model and conditional ranking version 2 were unchanged.
- Browser checks: every frozen family/candidate and scored discrepancy rendered; conditional ranking identity visible; baseline scientific panel still available; 390px viewport stayed within bounds; no page errors.
- Session: `live-28aa639bb0eb287a3f1c14d6`; run: `run-1789074209191-e4bbada8`.
- New forecast: `source-app-7954a0c8-111a-46bd-98a1-7c8f82824b30`.
- New bank SHA-256: `5069213a027ecef19c94a5ba2ec5ced5eee9e80963bddf1f43b69ce1e7ec1051`.
- Preserved ranking: `source-ranking:332297b9c47475682ce7d0651ec6af2cdb0cd42812cf0fbb466f4dedf3ee8b0f`, version 2, from scored bank `008cab0fdcc50a5907065d434b82b514e987ef7470a87fb80c64ef5b932dae62`.

Separate contract-fixture browser tests cover unavailable alternatives and legacy single forecasts: `tests/source-bank-states.spec.ts` and `tests/source-inference.spec.ts`, now in the default suite (`npx playwright test`); the recorded run gave **5 passed in 12.1s**. These fixture checks are UI coverage, not native evidence.

Earlier real browser attempts exposed excessive concurrent session replay work and permanent reuse of a terminal failed source intent. The passing runtime includes verified-read performance/coalescing fixes and fresh explicit retry identities while preserving pending intents. Human anatomical accuracy is not established by this generated-data verification.

## Two-mass mode and F0 columns

Verified on the actual local application (port 5205) and scientific worker (port 8805) with `PHONATION_SOURCE_MODEL=two_mass`, using generated native two-mass audio driven through `/api/science/use-latest-capture`, `/api/science/run` and `/api/source/analyze`, `/forecast`, `/score`. No response was mocked and no paid call was made.

- Fit: 10 two-mass candidates (5 anatomies × `XB=XT` .005/.015 cm), 30 native calls. Bank: 30 alternatives, 30 calls; held-out score: 30 of 30 scored.
- Command: `SOURCE_BANK_APP_URL=http://127.0.0.1:5205 CI=1 npx playwright test --config <playwright config with testMatch source-bank-runtime.spec.ts, baseURL http://127.0.0.1:5205 and no webServer> tests/source-bank-runtime.spec.ts` — **1 passed in 4.2 s**. Every frozen row shows requested → simulated F0 from the bank (179.1 Hz requested; 168.4-187.9 Hz simulated), every scored row shows its pitch-excluded discrepancy, the 390 px viewport stays in bounds and there are no page errors. Screenshots: `test-results/source-bank-runtime-frozen.png`, `test-results/source-bank-runtime-ranking.png`.

This is software verification with generated audio. It does not establish human anatomy, tissue mechanics or vocal-fold contact.
