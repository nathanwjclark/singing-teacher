# Optional phonation delivery status

This implements the independently gated capabilities in the PHON-01–05 addendum. It does not enable audio-only closure diagnosis.

| Capability | Implementation | Default / limitation |
|---|---|---|
| Canonical acoustic measurement | Connected to live microphone worker, verified saved PCM worker and synthesized source experiments | Pitch, periodicity, spectral flatness and raw harmonic slope; unavailable values retain reasons |
| Live acoustic comparison | Connected in Experiments; actual microphone/worker browser flow verified | Explicit opt-in; repeated compatible within-session reference required; no new microphone owner |
| Saved-recording analysis | Connected through optional server routes and compact Astra capability context | `PHONATION_MEASUREMENT_ENABLED=1` enables analysis; disabled by default; unknown acquisition time stays null |
| Conditional source/tract research fitting | Actual native fitting, fixed-source/fixed-anatomy comparisons and frozen held-out scoring verified | Internal API defaults off; not connected to application model adoption |
| Source-driven coaching/model updates | Not enabled | Requires isolated aggregate native execution and session integration before enabling; baseline source assumptions remain explicit |
| Human vocal-fold contact validation | Unavailable | No paired EGG/imaging evidence; no closure, pathology or tissue-contact result is claimed |

The Experiments page's **Optional phonation acoustics** panel uses the already active microphone. Enabling acoustic feedback starts the dedicated analysis worker; disabling it stops only analysis resources. Silence, stale evidence, clipping, unsupported pitch, processing changes and worker failures suppress current conclusions. Analysis failure does not stop recording or change the valid scientific model.

Saved-recording analysis is separately controlled. Its results are dated history, not live feedback. Missing modules and failures expose capability state to Astra; supported baseline exercises remain available. Neither enabling nor disabling this feature rewrites a committed forecast or changes baseline scoring. The experimental source scorer pins its extractor version and returns unsupported if that implementation changes or disappears after the forecast.

The core live Astra/native loop was verified using synthetic recordings. The optional live panel was verified with generated microphone audio and the actual canonical worker. These software results are distinct from human singing or anatomical validation. See [independent review](../physiology/phonation-independent-review.md), [source research API](../../science/PHONATION_SOURCE.md), and [saved-recording runtime](../../science/PHONATION_RUNTIME.md).
