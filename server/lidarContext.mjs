// Scientific state is read from the authenticated local worker. This summarizes
// evidence verified at adoption; it does not claim a fresh sensor measurement.
export function lidarContextFromState(state, {enabled = process.env.LIDAR_FUSION_ENABLED === '1', previewEnabled = process.env.LIDAR_PREVIEW_ENABLED === '1'} = {}) {
  const base = {previewEnabled, fusionEnabled: enabled, status: enabled ? 'available-no-adopted-evidence' : 'disabled',
    limitation: 'Separate held-pose outer-lip distance under declared correspondence, camera mapping and uncertainty; no hidden anatomy or simultaneous singing pose is measured.'};
  const snapshot = state?.snapshot, fusion = snapshot?.lidar_fusion;
  if (!fusion) return base;
  const receipt = state.lidar_fusions?.findLast(row => row.status === 'adopted' && row.job_id === fusion.job_id && row.result_sha256 === fusion.result_sha256);
  const rows = fusion.rankings;
  if (!receipt || !Array.isArray(rows) || !rows.length || rows.length > 32
      || !snapshot.evidence_ids?.includes(fusion.source_evidence_id)
      || !snapshot.evidence_hashes?.includes(fusion.source_manifest_sha256)) return {...base, status: 'unavailable', reason: 'Adopted depth provenance could not be matched to the current scientific state'};
  const compact = {...base, status: enabled ? 'adopted-experimental-evidence' : 'disabled-with-retained-evidence',
    modelId: snapshot.model_id, adoptedModelId: receipt.model_id, rankingIsCurrent: receipt.model_id === snapshot.model_id,
    evidenceVerification: 'Original artifacts verified by the numerical worker at adoption; not remeasured now',
    receivedAt: receipt.received_at, sourceKind: fusion.source_kind, captureCreatedAt: fusion.source_capture_created_at,
    sourceEvidenceId: fusion.source_evidence_id, manifestSha256: fusion.source_manifest_sha256,
    resultSha256: fusion.result_sha256, annotationSha256: fusion.annotation_sha256, operatorSha256: fusion.operator_sha256,
    parentModelId: fusion.baseline_model_id, scanPose: fusion.scan_pose,
    observedDistanceMeters: fusion.observed_distance_m, combinedSigmaMeters: fusion.combined_sigma_m,
    measurementSigmaMeters: fusion.measurement_sigma_m, modelSigmaMeters: fusion.model_sigma_m,
    numericalEquivalence: fusion.distance_equivalence,
    scanJAValues: fusion.scan_JA_values, scanJAWeights: fusion.scan_JA_weights,
    withoutDepthOrder: fusion.without_depth_order, withDepthOrder: fusion.with_depth_order,
    rankings: rows.map(row => ({hypothesisId: row.hypothesis_id, depthDiscrepancy: row.depth_discrepancy,
      predictions: row.predictions?.slice(0, 3).map(p => ({JA: p.JA_requested, weight: p.weight, distanceMeters: p.distance_m}))})),
    limitations: fusion.limitations,
    interpretation: 'Depth-conditioned ordering of retained physical hypotheses, not a calibrated posterior. Historical depth rankings do not override later acoustic evidence.'};
  return JSON.stringify(compact).length <= 24000 ? compact : {...base, status: 'unavailable', reason: 'Depth summary exceeds context bound'};
}
