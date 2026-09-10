# Heldout external-probe evaluation

`probe_evaluation.evaluate_probe(forecast: Artifact, *, expected_digest,
document, receipt, configuration_json, original_artifacts,
supplemental_artifacts, capture_started_at) -> Artifact` evaluates an existing
`predict_probe` artifact without fitting or modifying any model.

Supply the immutable forecast bytes and digest, exact document/receipt/config
from `science/scripts/import_probe_science.ts`, and maps of relative artifact
names to base64 original media and calibration evidence bytes. The evaluator
reruns that same canonical B DSP/importer in a temporary directory. Every
claimed document and receipt field must equal the independently regenerated
result. No editable receipt alone authorizes scoring. Node must be on PATH.

The target trial ID must equal the frozen target evidence ID. Received evidence
must not overlap fitting/calibration lineage; pose, grid, calibration,
placement, boundary conditions and magnitude/complex comparison must match.
Unsupported phase/quality and missing source bytes reject. Imported records
carry the generic importer's `split=calibration`; this evaluator never fits that
record. A record becomes heldout here only through its disjoint frozen target
identity and temporal check. Additional articulation cannot be verified by this
import contract and is rejected.

All hypotheses use the intersection of their valid frequency support. Output
contains per-bin absolute error, per-band RMSE, overall RMSE and missing counts,
in recorded-PCM-per-digital-drive units. Empty support remains unavailable.
There is no sorting, posterior, anatomy rejection, posthoc acceptance threshold,
or automatic update. Importer band sigmas/weights are not used to invent a
precommitted statistical test. Nonzero residuals describe numerical mismatch.

The server records receipt time and requires forecast seal < asserted capture
start <= receipt. Raw bytes and software chronology are verified, but caller
capture timestamps, physical calibration validity, and exact human execution
are not hardware authenticated. A content digest is not a signature.

`JobService` operation `evaluate_probe` uses the same keywords with
`forecast_json` replacing the positional Artifact. It writes `evaluation.json`
and the standard immutable job result. Model/session stale checks apply. The
existing 2 MB JSON job limit remains: larger media can use the Python API from
CLI with base64 maps; each decoded artifact is limited to 16 MB. No arbitrary
executable/path parameter or paid API is exposed. Import subprocess timeout is
60 seconds.

Verification: `PYTHONPATH=science/src python -m pytest
science/tests/test_probe_evaluation.py science/tests/test_service.py -q`.
The regression persists a genuine native anatomy forecast, generates a later
known FIR raw response, replays the B importer, and reports the expected large
mismatch. It also exercises actual service execution, stale digest, byte and
receipt corruption, chronology and target/model binding.
