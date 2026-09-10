import {isDeepStrictEqual} from 'node:util';

// Only session-owned, completed worker envelopes enter optional coach context.
export function verifiedVisualForecasts(state) {
  return Object.entries(state?.visual_forecasts || {}).flatMap(([forecastId, entry]) => {
    const receipt = state.visual_receipts?.findLast(r => r.forecast_id === forecastId && r.operation === 'freeze_visual_forecast' && r.status === 'succeeded');
    const job = state.jobs?.find(j => j.job_id === receipt?.job_id && j.status === 'succeeded' && j.request?.operation === 'freeze_visual_forecast');
    if (!receipt || !job || !isDeepStrictEqual(job.result, entry.artifact) || entry.baseline_model_id !== receipt.baseline_model_id) return [];
    const scoreReceipt = state.visual_receipts?.findLast(r => r.forecast_id === forecastId && r.operation === 'score_visual_forecast' && r.status === 'succeeded');
    const scoreJob = state.jobs?.find(j => j.job_id === scoreReceipt?.job_id && j.status === 'succeeded' && j.request?.operation === 'score_visual_forecast');
    const score = entry.score_result && scoreReceipt && scoreJob && isDeepStrictEqual(scoreJob.result, entry.score_result)
      && entry.score_result.artifact?.forecast_sha256 === entry.artifact.sha256 ? entry.score_result : null;
    return [{forecastId, entry, receipt, scoreReceipt: score ? scoreReceipt : null, score}];
  });
}

export function visualContextFromState(state, {enabled = process.env.VISUAL_LIKELIHOOD_ENABLED === '1'} = {}) {
  const forecasts = verifiedVisualForecasts(state).slice(-4).map(({forecastId,entry,score}) => ({
    forecastId, status: entry.status, current: entry.baseline_model_id === state.snapshot?.model_id,
    modelId: entry.baseline_model_id, committedAt: entry.committed_at, forecastSha256: entry.artifact.sha256,
    calibrationStatus: entry.artifact.artifact.calibration_status, coordinateSystem: entry.artifact.artifact.coordinate_system,
    geometryCalls: entry.artifact.artifact.budget?.actual_geometry_calls,
    targets: entry.artifact.artifact.targets, score: score ? {sha256:score.sha256,status:score.artifact.status,
      scores:score.artifact.scores,missingFrameIds:score.artifact.missing_frame_ids} : null,
  }));
  const result = {enabled,status:enabled ? (forecasts.length ? 'conditional-evidence' : 'no-verified-evidence') : 'disabled',
    modelUpdated:false, evidenceVerification:'Matched completed worker artifacts in authoritative session; original video bytes are not re-read for this context',
    interpretation:'Annotation holdout with assumed articulation and fixed camera candidates. Pixel residuals are conditional comparisons, not measured internal anatomy or calibrated probabilities. Historical forecasts do not override current acoustic models.', forecasts};
  return JSON.stringify(result).length <= 24000 ? result : {...result,status:'unavailable',reason:'Visual context exceeds bound',forecasts:[]};
}
