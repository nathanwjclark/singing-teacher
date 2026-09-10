# Bounded canonical PCM anatomy search

`singing_physics.pcm_search.search_pcm(engine, document, *, anatomy_bounds, nuisance_profiles, max_synthesis_calls=128, rounds=3, seed=1, node_binary=None)` adaptively proposes anatomy and uses the existing `fit_pcm` path to synthesize audio and extract **the actual canonical PCM descriptors**. It does not substitute tract transfer spectra or invent a new audio feature extractor.

This is a small conditional search over explicit hypotheses. It does not establish identified anatomy, a posterior, microphone calibration, or the unknown room response.

## Inputs and service wiring

The observation document is exactly the existing `canonical_pcm_observations` document: schema version 0.1.0 and 1–10 calibration `trials`. No held-out field or trial split is accepted; freeze the resulting hypotheses before independently providing target evidence to a separate evaluation. The finite fitter validates canonical contract/extractor versions, source bindings/hashes, feature units and quality, sample rate/window alignment, and duplicate source intervals even when record IDs are changed. Artifact bytes are not verified by this layer; preserve the existing receipt-validation boundary.

`anatomy_bounds` explicitly selects one or both supported dimensions, in centimeters:

- `hard_palate_length`: a subinterval of [3.8, 5.1].
- `pharynx_length`: a subinterval of [5.7, 7.4].

All other anatomy remains at the fixed native reference. Shared anatomy applies across every calibration trial. Supply 1–8 unique complete nuisance profiles, each shaped as:

```json
{
  "profile_id": "nuisance-0",
  "trials": {
    "calibration-trial-id": {"JA": -2.0, "f0_hz": 180.0, "gain": 0.8}
  }
}
```

Each profile must bind every trial, with explicit JA, F0 and scalar gain. These are complete finite combinations, not independent continuous nuisance optimizers. Duplicate control profiles under new names are rejected. Native support bounds are JA −5 to −1 degrees, F0 65–1000 Hz and gain 0.001–100. The search cannot infer arbitrary glottal mechanics, microphone coloration, reverberation or phase from these nuisance choices.

The service passes observation data as `document` and the required bounds/profiles as parameters. Optional parameters are integer `max_synthesis_calls` (1–4096), `rounds` (1–8) and a nonnegative 32-bit `seed`; `node_binary` is a local runtime selection, not an external user path requirement.

## Search and hard budget

The initial normalized design contains the midpoint plus a seeded Latin-hypercube design: three points in one dimension or five in two. Later rounds examine shrinking coordinate neighborhoods of the best scored anatomy. All points are clipped to the declared box and duplicates are removed. Ties use stable candidate IDs. Seed affects the initial spatial coverage; evaluated proposals and SciPy version are recorded for replay.

Every anatomy point receives **all** predeclared nuisance profiles. Batches preserve complete nuisance sets and stay within `fit_pcm`'s 32-candidate limit. The initial complete design must fit within the budget before any synthesis occurs. Later proposals that cannot fit are explicitly recorded as omitted for budget; the algorithm never buys extra compute implicitly.

A counted engine forwards real synthesis calls and enforces one cap across every round and both joint and fixed-anatomy evaluations. Calls that raise during synthesis are counted as attempted invocations, so failures cannot bypass the budget. Complete fit batches must return exactly the expected call count. If a later synthesis/extraction/operator error interrupts a batch, its consumed calls and error are retained and the incomplete comparison is excluded from ranking. Previously completed candidates remain available. Native anatomy is restored on success and failure.

The fixed-anatomy model receives identical finite nuisance coverage and equal literal synthesis calls for every completed batch. Once all nuisance profiles have been evaluated, its repeated calls add **no new unique exploration**. Results explicitly report unique nuisance calls and redundant baseline calls; equal counts do not imply equal optimizer effectiveness or new statistical evidence. The baseline optimum is conditional on the same finite nuisance support.

## Results and interpretation

`joint` and `fixed_anatomy_baseline` each contain `best`, all completed `candidates`, and completed synthesis counts. Rows retain the finite fitter's scored/missing-predicted-features status, canonical predictions, discrepancy and applied articulation, plus `search_round`, `anatomy_point_id`, `nuisance_profile_id` and `proposed_anatomy`.

`history` preserves proposed points, complete batch results, failed/incomplete batch records and budget omissions. Top-level counts distinguish total attempted synthesis calls from paired completed comparisons and unpaired failure calls. If every prediction is clipped or otherwise missing supported features, the result says `no_scorable_candidates`; it does not discard those hypotheses and declare an anatomy. Other stop states include round limit, budget exhaustion and execution failure.

The result reports evaluated parameter ranges, unique evaluated anatomy points, native/extractor provenance and the observation digest. Ranges are finite search support, **not** posterior intervals or anatomical certainty. Numerical results/proposal selection are reproducible with the same seed, operator and data. Canonical prediction records retain their real `createdAt` audit timestamps, so independently executed complete result JSON is not byte-identical solely because those timestamps differ.

## Verification and limitations

Run `PYTHONPATH=.:science/src python -m pytest science/tests/test_pcm_search.py -q -W error` with the installed scientific Python environment and a Node runtime supporting TypeScript stripping.

Real-native tests generate a palate length absent from the initial candidate design, verify refinement improves the canonical discrepancy, enforce declared geometry/budget bounds and equal completed comparison counts, retain clipping failures, check numerical reproducibility, reject held-out contamination and relabeled duplicate source intervals, and inject a later native failure to verify earlier results and anatomy restoration. This is implementation/recovery evidence for a controlled development case, not independent human anatomical validation.
