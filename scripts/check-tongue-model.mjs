// Focused browser check of real Three.js vertices, shared sagittal projection,
// stale observations, and portrait/landscape crop geometry. Run against Vite.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.argv[2]||'http://127.0.0.1:5199');
 const result=await page.evaluate(async()=>{
  const {createTongueModel}=await import('/src/lib/tongueModel.ts');
  const {emptyAnatomyState,createAnatomyMotion}=await import('/src/lib/anatomyState.ts');
  const {deformAtlasPoint}=await import('/src/lib/atlasMotion.ts');
  const {tongueCrop}=await import('/src/lib/tongueCrop.ts');
  const model=createTongueModel(),rest={lateral:0,lift:0,extension:0,curl:0,visible:true};model.applyPose(rest);const base=model.tipPosition().toArray();
  const positions=model.mesh.geometry.getAttribute('position');let root=0;for(let i=1;i<positions.count;i++)if(positions.getZ(i)<positions.getZ(root))root=i;
  const rootBase=[positions.getX(root),positions.getY(root),positions.getZ(root)];const rows=[];
  for(const [axis,key] of ['lateral','lift','extension'].entries())for(const value of [-1,1]){
   const pose={...rest,[key]:value};model.applyPose(pose);const state=emptyAnatomyState();state.tongue=pose;rows.push({axis,key,value,tip:model.tipPosition().toArray(),root:[positions.getX(root),positions.getY(root),positions.getZ(root)],side:deformAtlasPoint(175.8,877.8,state)});
  }
  const state=emptyAnatomyState(),side=deformAtlasPoint(175.8,877.8,state);model.dispose();
  const motion=createAnatomyMotion();const frame={face:[],pose:[],timestamp:0,metrics:{mouthOpen:0,headTilt:0,shoulderTilt:0,brightness:0,motion:0},tongue:{x:.5,y:.5,lateral:.5,lift:0,elevation:.3,extension:.2,visibleFraction:0,observedAt:0}};
  motion.update(frame,false,0);const first=motion.state.tongue.visible;motion.update({...frame,timestamp:300},false,300);const expired=!motion.state.tongue.visible;
  const crops=[];for(const [w,h] of [[1280,720],[720,1280]]){const face=Array.from({length:478},()=>({x:.5,y:.5}));face[78]={x:.45,y:.4};face[308]={x:.55,y:.4};face[13]={x:.5,y:.4};const c=tongueCrop(face,w,h);crops.push({pixelWidth:c.width*w,pixelHeight:c.height*h});}
  return {base,rootBase,side,rows,first,expired,crops};
 });
 for(const row of result.rows){for(let axis=0;axis<3;axis++)assert(Math.abs(row.tip[axis]-result.base[axis]-(axis===row.axis?row.value:0))<1e-5,`${row.key} must move its own endpoint axis only`);assert(row.root.every((v,i)=>Math.abs(v-result.rootBase[i])<1e-5));if(row.axis===0)assert.deepEqual(row.side,result.side);}
 assert(result.first&&result.expired,'Cached neural detections must expire');for(const crop of result.crops)assert(Math.abs(crop.pixelWidth-crop.pixelHeight)<1e-6);
 console.log('PASS: six independent actual endpoint movements; root pinned; sagittal lateral invariance; stale expiry; square portrait/landscape crops');
}finally{await browser.close();}
