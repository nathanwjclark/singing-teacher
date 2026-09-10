# Active physiological inference continuation

Revision 8 now prioritizes closing harness connections and preserving honest
scores. The methods and negative experiments below are completed work; additional
optimizer studies are deferred. External-probe integration is documented in
[PROBE_INVERSE.md](PROBE_INVERSE.md) and [PROBE_PREDICTION.md](PROBE_PREDICTION.md).

This continuation uses Lead B main `3d909d1`, including the private native-depth
surface, temporal diagnostic and frozen visible tongue-patch experiment. Public KIT contracts and canonical PCM extraction
remain B-owned. The scientific operations below are local, executable research
methods, not evidence that internal human anatomy is recoverable.

| Workstream | Owner | Acceptance |
|---|---|---|
| PCM experiment design and update | A prediction agent | Freeze physiological hypotheses, rank actual synthesized PCM differences, acquire later evidence, update with retained ambiguity and source lineage |
| Bounded anatomical search | A inverse agent | Search beyond a fixed supplied grid under a total native-call cap, with explicit nuisance controls and fixed-anatomy comparison |
| Capture robustness | A forward agent | Predeclare noise/filter/echo/control and out-of-grid cases; preserve failures and score later targets only after calibration fitting |
| Physical depth target checks | A geometry agent | Compare verified camera-space measurements to independently supplied target geometry and tolerances; distinguish software parity from physical acceptance |
| Integration | A coordinator | Durable service operations and reproducible calibration-to-next-experiment replay |
| Scientific review | A reviewer | Audit evidence reuse, budgets, model mismatch, missing predictions, baseline fairness and overstated confidence |

The inference loop keeps a finite set of candidate anatomies. A proposed
experiment supplies explicit vowel, jaw, source-frequency and digital-gain
conditions. Each candidate predicts B's canonical audio descriptors through the
same native synthesizer. Separation under declared feature scales ranks the
experiments. A later observation can favor some candidates, leave several
indistinguishable, or disagree with every candidate. These outcomes must remain
distinct; a low residual cannot certify physiological uniqueness.

Search bounds and candidate pruning constrain what this loop can discover.
Engineering discrepancy scales are not calibrated measurement likelihoods, and
candidate ranges are not anatomical confidence intervals. A human's execution
of the proposed controls is also uncertain. The software exposes these
assumptions instead of attributing every acoustic difference to anatomy.

## Physical and research dependencies

B's preview makes native projection and temporal inspection reviewable. It does
not provide a known calibration target, sensor-error model, rigid head transform,
or measured audio/depth synchronization. B and the phone operator own those
private capture inputs. A owns checking them and determining which operators can
then enter physiological fitting. No private media is placed in public git.

Further research can proceed without those inputs: sensitivity to unmodeled
sources and capture filters, experiment discrimination and search behavior can
be tested in simulation. General anatomical identifiability and human coaching
efficacy require independent evidence beyond this simulator. They are continuing
research questions, not a claim that all remaining work is blocked on B.

## Executable active loop

```sh
PYTHONPATH=.:science/src science/.venv/bin/python science/scripts/pcm_active_replay.py science/artifacts/active-replay
PYTHONPATH=.:science/src science/.venv/bin/python -m pytest science/tests/test_active_service.py -q -W error
```

The replay runs actual `search_pcm`, `design_pcm` and `update_pcm` spawned jobs.
It writes its protocol first, generates calibration, searches a declared box,
freezes a finite shortlist, saves a prospective design, and only then generates
the chosen target. Updates preserve the original design and cumulative evidence;
no-separation, mismatch and single-candidate outcomes stop explicitly.

The first run used 24 synthesis calls (45 maximum), selected the predeclared `i`
experiment and reduced four shortlisted geometries to one. That candidate's palate
length was 4.125 cm against generating truth 4.37 cm: **2.45 mm error despite
single-candidate support**. This is an executed finite-support update, not evidence
of unique anatomy. Search tested five anatomies, and the shortlist itself was
truncated. The result retains this scoring-only error without changing thresholds.

Five actual service/boundary tests pass, including numerical search replay, hard
budget failure, prospective-before-observation ordering, immutable design bytes,
model mismatch/staleness and rejection of arbitrary executable parameters.

The separate [robustness challenge](PCM_ROBUSTNESS.md) found a larger failure:
1 cm errors in two anatomical dimensions remained compatible with low coarse
descriptor discrepancy. [Depth target checks](DEPTH_ACCEPTANCE.md) add an
independent measurement acceptance path; they do not certify internal anatomy.
