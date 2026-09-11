import test from 'node:test';
import assert from 'node:assert/strict';
import {resultCurrent} from './tongueTracking.ts';

test('a slow result is current when it arrives and stays current until the next result can arrive',()=>{
 // Inference started at frame 1000 and took 400 ms; the next result is due near 1800.
 const result={observedAt:1000,arrivedAt:1400};
 assert.equal(resultCurrent(result,1400,800),true);
 assert.equal(resultCurrent(result,1799,800),true);
 assert.equal(resultCurrent(result,2599,800),true);
 assert.equal(resultCurrent(result,2600,800),false);
});
test('phone-speed inference no longer expires on arrival',()=>{
 // Timing from observedAt with an 800 ms window dropped every 1.5 s result immediately.
 const result={observedAt:0,arrivedAt:1500};
 assert.equal(resultCurrent(result,1500,800),true);
 assert.equal(resultCurrent(result,2999,800),true);
 assert.equal(resultCurrent(result,3800,800),false);
});
test('a fast tip model keeps its short expiry',()=>{
 const result={observedAt:100,arrivedAt:110};
 assert.equal(resultCurrent(result,409,300),true);
 assert.equal(resultCurrent(result,420,300),false);
});
