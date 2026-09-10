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
