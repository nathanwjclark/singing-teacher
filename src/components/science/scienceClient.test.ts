import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readableScienceStatus} from './scienceClient.ts';
import type {ScienceStatus} from './scienceClient.ts';
test('partial historical receipts do not become runnable model controls',()=>{
 const partial={status:'succeeded',runId:'run-old',result:{modelId:'model-old'}} as ScienceStatus;
 const safe=readableScienceStatus(partial);assert.equal(safe.status,'unavailable');assert.equal(safe.result,undefined);assert.equal(partial.result?.modelId,'model-old');assert.equal(safe.runId,'run-old');
 const idle={status:'not-run'};assert.equal(readableScienceStatus(idle),idle);
});
