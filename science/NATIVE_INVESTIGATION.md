# Anatomy lifecycle investigation

Symptom: init/close passes; init/read-anatomy/set-anatomy/close aborts in Python
with an invalid free.

| Hypothesis | Action | Result |
|---|---|---|
| Incorrect Python signature | Explicit pointer types; second Python runtime. | Abort persists; ordinary init/close passes. |
| Python-only failure | Minimal C++ reproduction and AddressSanitizer. | Shape vector is corrupted during anatomy update. |
| Setter writes beyond control array | Compare loop and parameter enum. | Loop writes four tongue controls; only TS1, TS2, TS3 exist. |
| Bound loop by actual parameter count | Versioned patch in exported build copy. | Update/readback/close succeeds; repeated lifecycle and sanitized checks added. |

The fix retains transformations for existing controls and prevents a write into
memory after the parameter array. The pinned submodule stays unmodified.

The inverse test also exposed local minima: local least-squares restarts could
terminate with high spectral error. A bounded global search now precedes local
refinement. Optimizer termination is reported separately from recovery quality.
