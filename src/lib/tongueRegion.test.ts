import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectTongueRegion} from './tongueRegion.ts';
// The runtime reads its threshold from the shipped manifest; test with the same value.
const {threshold}=JSON.parse(readFileSync(new URL('../../public/models/tonguesam/manifest.json',import.meta.url),'utf8'));
test('shipped manifest keeps the published 0.7 detector threshold',()=>assert.equal(threshold,.7));
test('region selection abstains and never returns a tip or depth',()=>{
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.69],threshold),{box:null,score:0});
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.9],threshold),{box:[.1,.2,.7,.8],score:.9});
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.69],.6),{box:[.1,.2,.7,.8],score:.69});
});
test('highest valid detection wins; malformed and off-image boxes cannot become regions',()=>{
 assert.deepEqual(selectTongueRegion([.2,.3,.8,.9,.8,0,0,.9,.9,.95],threshold).box,[0,0,.9,.9]);
 assert.equal(selectTongueRegion([2,2,3,3,.99,NaN,0,1,1,.9,.9,0,.1,1,.95],threshold).box,null);
 assert.throws(()=>selectTongueRegion([1],threshold));
});
