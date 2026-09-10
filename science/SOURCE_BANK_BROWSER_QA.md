# Source bank browser verification

Verified on the actual local application and scientific worker, using generated native audio retained from the two-round integration test. No successful API responses were mocked and no paid model calls were made.

- Runtime: `0524095` (integration `28816c2` plus terminal source retry fixes `4175a45` and `c94793a`). Worker: `28816c2`.
- Command: `SOURCE_BANK_APP_URL=http://127.0.0.1:5284 CI=1 npx playwright test --config playwright.source-bank.config.ts tests/source-bank-runtime.spec.ts`
- Result: **1 passed in 48.7s**. Real app recovery from a failed forecast runner created a new frozen bank with **30 native synthesis calls and 30 alternatives**. The prior baseline model, source model and conditional ranking version 2 were unchanged.
- Browser checks: every frozen family/candidate and scored discrepancy rendered; conditional ranking identity visible; baseline scientific panel still available; 390px viewport stayed within bounds; no page errors.
- Session: `live-28aa639bb0eb287a3f1c14d6`; run: `run-1789074209191-e4bbada8`.
- New forecast: `source-app-7954a0c8-111a-46bd-98a1-7c8f82824b30`.
- New bank SHA-256: `5069213a027ecef19c94a5ba2ec5ced5eee9e80963bddf1f43b69ce1e7ec1051`.
- Preserved ranking: `source-ranking:332297b9c47475682ce7d0651ec6af2cdb0cd42812cf0fbb466f4dedf3ee8b0f`, version 2, from scored bank `008cab0fdcc50a5907065d434b82b514e987ef7470a87fb80c64ef5b932dae62`.

Separate contract-fixture browser tests cover unavailable alternatives and legacy single forecasts: `CI=1 npx playwright test --config playwright.source-bank.config.ts tests/source-bank-states.spec.ts tests/source-inference.spec.ts` — **5 passed in 12.1s**. These fixture checks are UI coverage, not native evidence.

Earlier real browser attempts exposed excessive concurrent session replay work and permanent reuse of a terminal failed source intent. The passing runtime includes verified-read performance/coalescing fixes and fresh explicit retry identities while preserving pending intents. Human anatomical accuracy is not established by this generated-data verification.
