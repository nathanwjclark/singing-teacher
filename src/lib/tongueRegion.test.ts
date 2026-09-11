import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectTongueRegion} from './tongueRegion.ts';
// The runtime reads its threshold from the shipped manifest; test with the same value.
const {threshold}=JSON.parse(readFileSync(new URL('../../public/models/tonguesam/manifest.json',import.meta.url),'utf8'));
test('shipped manifest keeps the published 0.7 detector threshold',()=>assert.equal(threshold,.7));
test('the manifest verification claim is backed by the committed smoke results',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../public/models/tonguesam/manifest.json',import.meta.url),'utf8'));
 const rows=JSON.parse(readFileSync(new URL('../../public/models/tonguesam/smoke-results.json',import.meta.url),'utf8')) as {file:string;score:number;box:number[];inputSha256:string}[];
 assert.equal(rows.length,manifest.verification.examples);
 for(const row of rows){assert.match(row.inputSha256,/^[0-9a-f]{64}$/);assert.equal(row.box.length,4);assert.ok(row.score>=threshold&&row.score<=1);}
 assert.ok(rows.some(row=>row.file==='1.jpg'&&row.inputSha256==='53e1c1a4aa44db507a2584ba5567a1679a2255442ecb4be56b2f135d286ce2ff'));
});
test('region selection abstains and never returns a tip or depth',()=>{
 // Abstention keeps the best score below the threshold for display; it never becomes a box.
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.69],threshold),{box:null,score:.69});
 assert.deepEqual(selectTongueRegion([],threshold),{box:null,score:0});
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.9],threshold),{box:[.1,.2,.7,.8],score:.9});
 assert.deepEqual(selectTongueRegion([.1,.2,.7,.8,.69],.6),{box:[.1,.2,.7,.8],score:.69});
});
test('highest valid detection wins; malformed and off-image boxes cannot become regions',()=>{
 assert.deepEqual(selectTongueRegion([.2,.3,.8,.9,.8,0,0,.9,.9,.95],threshold).box,[0,0,.9,.9]);
 assert.equal(selectTongueRegion([2,2,3,3,.99,NaN,0,1,1,.9,.9,0,.1,1,.95],threshold).box,null);
 assert.throws(()=>selectTongueRegion([1],threshold));
});
