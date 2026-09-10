import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTongueRegion} from './tongueRegion.ts';
test('region selection abstains and never returns a tip or depth',()=>{
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.69]),{box:null,score:0});
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.9]),{box:[.1,.2,.7,.8],score:.9});
});
test('highest valid detection wins; malformed and off-image boxes cannot become regions',()=>{
 assert.deepEqual(selectTongueRegion([.2,.3,.8,.9,.8,0,0,.9,.9,.95]).box,[0,0,.9,.9]);
 assert.equal(selectTongueRegion([2,2,3,3,.99,NaN,0,1,1,.9,.9,0,.1,1,.95]).box,null);
 assert.throws(()=>selectTongueRegion([1]));
});
