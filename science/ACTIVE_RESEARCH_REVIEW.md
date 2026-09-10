# Active PCM research review

Initial review baseline: `3ccfaa9` (Lead A `b2b4cbe` plus Lead B merge).
Scope: existing PCM fitter and numerical identifiability/source-evidence paths,
followed by independent review of the new search/design/challenge implementations.

## Initial findings

No new blocking defect was established in the existing finite PCM fitter.
`pcm_inverse.py` preflights twice the candidate-by-trial synthesis count, includes
both joint and fixed-anatomy calls, restores native anatomy in `finally`, retains
clipped or missing-feature candidates without assigning a competitive score, and
binds canonical extractor versions/hashes and observed window metadata. Its
weighted descriptor discrepancy is explicitly not a calibrated likelihood.

The scalar-record fitting boundary does not authenticate underlying media. This
is explicitly reported by `source_artifact_bytes_verified=false`. Native import
verifies bytes separately; active updates must preserve that distinction. Source
hashes can describe an extracted frame or a containing segment depending on the
producer. Unique hashes are not a proof of independent acquisitions.

Existing duplicate protection rejects exact source hash/artifact and window
matches. It does not reject partially overlapping windows. An active update must
check history, preserve physical source lineage and avoid describing overlapping
samples as independent evidence. Candidate identities also do not establish
physical diversity: renamed copies of identical anatomy/control proposals must
not create artificial confidence or extra probabilistic mass.

The existing direct-transfer identifiability ranker reports finite-pair spectral
separation under assumed noise, not information gain or microphone identifiability.
Its limitation that commanded articulation is not guaranteed cue execution must
remain explicit in the PCM design path. The uncertainty investigation similarly
separates numerical optimizer spread from accuracy and excludes singleton ranges
from claims of observed multi-candidate concentration.

## Acceptance checks sent to implementers

- Search counts every joint/baseline/refinement synthesis within one hard cap.
  Adaptive baseline nuisance search needs the same freedom and budget as joint
  search; merely reusing joint-selected controls can favor the joint model.
- Missing/clipped predictions and budget failures remain visible. Pruning is a
  search decision, not evidence that excluded anatomies are impossible.
- Experiment rankings are frozen before target outcomes exist. Ranking priors,
  candidate selection and nuisance controls cannot depend on held-out outcomes.
- Updates reject repeated physical evidence across history, including renamed
  record/trial IDs. Observation provenance and native/extractor identity remain
  bound through the update.
- Candidate spread and finite-hypothesis discrimination do not imply calibrated
  confidence, anatomical correctness or successful execution of a human cue.

## Audit status

No-stubs and wiring audit of new modules is pending their implementations. The
existing fitter calls the actual native engine and canonical B extractor. The
existing identifiability path uses actual transfer spectra and labels their
limited physical scope. No alternative extractor or new dependency is proposed
by this review. No heavy numerical experiment was run for this initial audit.

## Implementation review and concrete corrections

### P1: quality-invalid held-out signals received numerical scores — fixed

`science/scripts/pcm_robustness_challenge.py:compare` initially ignored quality
flags, unlike the fitter. Consequently every clipped baseline held-out prediction
in the actual six-case experiment received a numerical discrepancy. Owner fix
`43cebee` rejects observed/predicted clipping, invalid, dropped, low-SNR and
missing-quality records, retaining raw feature differences as diagnostics.
Previously saved canonical records were rescored without new native synthesis or
threshold tuning. Baseline held-out comparisons are now unavailable. The joint
out-of-grid result remains: both inferred lengths differ by 1 cm while the
predeclared residual warning fails to trigger. That negative finding is evidence
against anatomical adequacy claims from small residuals, not a passed accuracy
check. Independently ran all 12 robustness tests: passed in 3.82 seconds.

### P1: distinct support updates could share a model identity — fixed in `130e09e`

`science/src/singing_physics/pcm_design.py:update_pcm` initially derived model ID
from only parent model ID and frame bytes. Two different frozen designs accepting
the same frame could retain different support yet have the same model ID. The
updated identity hashes parent snapshot, design, experiment, canonical receipt,
retained hypothesis IDs and status. A native regression uses narrow versus broad
retention designs on the same frame, obtains one versus two retained hypotheses,
and verifies distinct IDs. Independently ran all seven design tests: passed in
9.82 seconds. The update also recomputes predicted-feature discrimination status
rather than trusting a disconnected stored status field.

### Depth diagnostic review

Reviewed `cf13ed6` and its existing rectification/native-reader dependencies.
No blocking issue found. Unique integer depth pixels, explicit affine pixel
mapping, valid measured LUT and calibrated camera projection remain required.
The target plane/distance is supplied independently rather than fitted to the
same evaluated depth. Raw residual tolerance decisions do not silently subtract
reference uncertainty or label residual variance as sensor noise. Analytic fixture
provenance remains distinct from physical target evidence, and physiological
acceptance remains false. Independently ran 13 tests: passed in 0.32 seconds.
Caller assertions of independent target measurement still require external review.

### Search and service review

Read the complete bounded search implementation. Actual synthesis invocations
are counted across batches and both models; complete nuisance sets stay together.
Previously completed candidates survive a subsequent failed batch, while partial
comparison calls are reported separately. Native state is restored. Extractor and
native signatures are checked across batches. Baseline duplicate calls are
explicitly separated from unique nuisance exploration; equal literal calls are
not described as equal information. Missing/clipped candidates remain recorded.

Read root service dispatch and model binding. Design/update execute outside an
already-owned native Engine; search uses the worker's Engine. Artifact digests
and snapshot model identity flow into the new operation handlers. Whole-service
publication and end-to-end loop verification remain root-owned checks.

### No-stubs, wiring and minimality audits

No placeholder algorithms were found in the new reviewed production modules.
Design and search use native synthesis and the shared canonical extractor;
robustness transforms actual generated PCM before extraction. Depth acceptance
uses the actual hash-verified native reader and existing LUT projection. Software
fixtures remain explicitly labeled tests. Search reuses the fitter and existing
SciPy dependency; design reuses canonical artifact/feature primitives rather than
introducing another extractor or posterior abstraction. The new API calls are
wired through service dispatch; device evidence and cross-modal calibration are
still external acceptance inputs, not silently fabricated by the research loop.

Search verification: two tests passed independently on the initial run; the third
initially compared entire receipts and failed solely on genuine `createdAt` audit
timestamps. The owner preserved timestamps in production and restricted the
reproducibility assertion to numerical/proposal content. Independently reran that
affected test: passed in 6.37 seconds. Thus all three targeted search tests have
passed independently after the assertion correction. No production timestamp
removal or fabricated deterministic receipt was introduced.

Remaining verification: root integration suite and service replay. No remaining
blocking defect was found in the reviewed module revisions.
