import test from 'node:test';
import assert from 'node:assert/strict';
import {visualContextFromState,verifiedVisualForecasts} from './visualContext.mjs';

test('only completed bound visual artifacts enter context without anatomy adoption',()=>{
 const artifact={sha256:'a'.repeat(64),artifact:{model_id:'baseline',targets:[],calibration_status:'scored',budget:{actual_geometry_calls:2}}};
 const score={sha256:'b'.repeat(64),artifact:{forecast_sha256:artifact.sha256,status:'scored',scores:[{heldout_rms_px:2}],missing_frame_ids:[]}};
 const state={snapshot:{model_id:'new-model'},visual_forecasts:{f:{baseline_model_id:'baseline',artifact,score_result:score,status:'scored'}},
 visual_receipts:[{forecast_id:'f',job_id:'freeze',operation:'freeze_visual_forecast',status:'succeeded',baseline_model_id:'baseline'},
 {forecast_id:'f',job_id:'score',operation:'score_visual_forecast',status:'succeeded'}],
 jobs:[{job_id:'freeze',status:'succeeded',request:{operation:'freeze_visual_forecast'},result:artifact},
 {job_id:'score',status:'succeeded',request:{operation:'score_visual_forecast'},result:score}]};
 const context=visualContextFromState(state,{enabled:true});assert.equal(context.modelUpdated,false);assert.equal(context.forecasts[0].current,false);
 assert.equal(context.forecasts[0].score.scores[0].heldout_rms_px,2);
 state.jobs[1].status='cancelled';assert.equal(verifiedVisualForecasts(state)[0].score,null);
 state.visual_forecasts.f.artifact=structuredClone(artifact);state.visual_forecasts.f.artifact.sha256='changed';
 assert.equal(verifiedVisualForecasts(state).length,0);
});
