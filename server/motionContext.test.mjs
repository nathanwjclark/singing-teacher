import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactMotionEvidence} from './motionContext.mjs';
test('long motion context retains timeline endpoints and explicitly counts omitted or missing evidence',()=>{
 const windows=Array.from({length:120},(_,index)=>({index,sourceStartSample:index*12000,sampleRateHz:48000,status:index%3?'scored':'unavailable',fit:{joint:{candidates:Array.from({length:18},(_,j)=>({candidate_id:'c'+j,status:'scored',weighted_mean_square_discrepancy:j}))}}}));
 const result=compactMotionEvidence({windows,modelUpdated:false,analysisPolicy:'motion-forward-bank-2'},{});
 assert.equal(result.windows.length,12);assert.equal(result.windows[0].index,0);assert.equal(result.windows.at(-1).index,119);assert.equal(result.windows.at(-1).seconds,29.75);
 assert.equal(result.timeline.missingWindows,40);assert.equal(result.timeline.scoredWindows,80);assert.equal(result.windows[0].candidateCount,18);assert.equal(result.windows[0].candidates.length,3);assert.ok(JSON.stringify(result).length<24000);
});
