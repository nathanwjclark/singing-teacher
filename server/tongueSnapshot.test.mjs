import test from 'node:test';
import assert from 'node:assert/strict';
import {tongueSnapshotError} from './tongueSnapshot.mjs';

const tip={trackingMode:'tip',x:.5,y:.6,lateral:.1,lift:0,visibleFraction:0,elevation:.2,extension:.1,observedAt:10,confidence:.8,tip:{x:.5,y:.6},tip3D:{x:.1,y:.2,z:.3,depthSource:'learned'}};
const region={trackingMode:'region',box:[.3,.4,.7,1],observedAt:1200,confidence:.96};
test('only a well-formed tip is a tongue landmark',()=>{
 assert.equal(tongueSnapshotError(null,null),null);assert.equal(tongueSnapshotError(undefined,undefined),null);
 assert.equal(tongueSnapshotError(tip,null),null);
 for(const bad of [region,{box:[.3,.4,.7,.8]},{...tip,trackingMode:undefined},{...tip,tracking_mode:'region'},{...tip,box:[.3,.4,.7,.8]},{...tip,x:1.2},{...tip,lateral:null},{...tip,tip:{x:2,y:0}},{...tip,tip3D:{x:0,y:0,z:0,depthSource:'guess'}},'tip',[tip]])
  assert.match(tongueSnapshotError(bad,null),/must be a tip observation/,JSON.stringify(bad));
});
test('a region box is accepted only as a well-formed visibleTongueRegion, including one touching the image edge',()=>{
 assert.equal(tongueSnapshotError(null,region),null);assert.equal(tongueSnapshotError(null,{...region,box:[0,0,1,1]}),null);
 for(const bad of [{...region,box:[.7,.4,.3,.8]},{...region,box:[.3,.4,.7,1.0000000000000002]},{...region,lateral:0},{...region,trackingMode:'tip'},{...region,confidence:null},{...region,box:[.3,.4,.7]}])
  assert.equal(tongueSnapshotError(null,bad),'Invalid visible tongue region',JSON.stringify(bad));
});
