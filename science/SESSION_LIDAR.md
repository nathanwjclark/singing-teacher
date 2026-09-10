# Experimental LiDAR session adoption

`fit_lidar` takes `parameters: {capture_directory, annotation, enabled, max_geometry_calls?}` plus the standard command identity and expected version. The controller injects its exact current snapshot into isolated worker operation `rank_lidar_hypotheses`. This uses the existing queue, cancellation, deadline and durable intent/restart behavior.

`collect_job` adopts only a complete native ranking of all unchanged retained anatomies. It re-verifies the original archive and rejects any original artifact already present in parent evidence. A new model records `snapshot.lidar_fusion` (numerical result hash, job, native/operator hashes, annotation, original artifact hashes, before/after ordering, scan pose and relative timestamp/timebase). Native capture UTC is nullable; receipt time never substitutes for capture time. The scan pose is separate from earlier singing controls. Parent evidence and all hypotheses remain; earlier designs become stale. Optional source models become stale through the existing baseline-version guard.

`state.lidar_fusions` records adopted, rejected and unsuccessful attempts. A disabled, incomplete, stale or changed-archive result leaves the baseline intact. App consumers must read the matching authoritative receipt and snapshot, rather than interpret the numerical worker's `model_updated:false` as a session adoption claim. Numerical results remain immutable and hash-addressed.

Depth scores are conditional discrepancies under declared marker correspondence, JA mixture and uncertainty. Their ordering is not calibrated probability or a reconstruction of internal tissue. Existing acoustic ordering is retained as the without-depth comparison; acoustic likelihoods are not invented or multiplied into depth scores.
