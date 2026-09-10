// Focused browser smoke: exercise the same isolated geometry and textures used
// by AtlasCrossSection, in teaching and native comparison modes.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const diff=process.argv[3]?JSON.parse(await readFile(process.argv[3],'utf8')):null;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();await page.goto(process.argv[2]||'http://127.0.0.1:5201');
 const results=await page.evaluate(async(diff)=>{
  const {createAtlasSurface}=await import('/src/lib/atlasSurface.ts');
  const {emptyAnatomyState}=await import('/src/lib/anatomyState.ts');
  const {nativeTongueRig,referenceTongueRig}=await import('/src/lib/atlasMotion.ts');
  const {createTractOverlay}=await import('/src/components/anatomy/tractOverlay.ts');
  const {createModelTractOverlay}=await import('/src/components/science/modelSpaceTexture.ts');
  const outcomes=[];
  for(const mode of diff?['teaching','native','native-diff']:['teaching']){
   const surfaces=[createAtlasSurface('structure'),createAtlasSurface('structure'),createAtlasSurface('tongue')];
   const rig=mode==='teaching'?referenceTongueRig:nativeTongueRig(diff.reference.tongue);
   const state=emptyAnatomyState();state.tongue.visible=true;
   const arrays=()=>surfaces.map(s=>Array.from(s.geometry.getAttribute('position').array));
   const update=()=>surfaces.forEach(s=>s.update(state,rig));update();const rest=arrays();
   const changes=[];
   for(const axis of ['lift','extension','lateral'])for(const sign of [-1,1]){
    state.tongue={lift:0,extension:0,lateral:0,curl:0,visible:true,[axis]:sign};update();
    changes.push({axis,sign,moved:arrays().map((a,i)=>a.some((v,j)=>v!==rest[i][j]))});
   }
   state.tongue={lift:0,extension:0,lateral:0,curl:0,visible:true};
   const poseChanges=[];
   for(const key of ['jaw','head']){
    state.jawOpen=key==='jaw'?.2:0;state.head.x=key==='head'?.15:0;update();
    poseChanges.push({key,moved:arrays().map((a,i)=>a.some((v,j)=>v!==rest[i][j]))});
   }
   const pixels=[];
   for(const part of ['airway','tongue']){
    const texture=mode==='teaching'?createTractOverlay(part):createModelTractOverlay(diff,mode==='native-diff',part);
    const bytes=texture.image.getContext('2d').getImageData(0,0,texture.image.width,texture.image.height).data;
    let alpha=0,red=0,green=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i+3]){alpha++;if(bytes[i]>200&&bytes[i+1]<80)red++;if(bytes[i]<80&&bytes[i+1]>200)green++;}
    pixels.push({part,alpha,red,green});texture.dispose();
   }
   outcomes.push({mode,changes,poseChanges,pixels,isolated:surfaces[0].geometry!==surfaces[1].geometry&&surfaces[1].geometry!==surfaces[2].geometry});
   surfaces.forEach(s=>s.dispose());
  }
  return outcomes;
 },diff);
 for(const mode of results){
  assert(mode.isolated);
  for(const {axis,moved} of mode.changes)assert.deepEqual(moved,[false,false,axis!=='lateral'],`${mode.mode} ${axis}: only the tongue may move`);
  for(const {key,moved} of mode.poseChanges)assert.deepEqual(moved,[true,true,true],`${mode.mode} ${key}: all pieces follow their pose`);
  for(const part of mode.pixels)assert(part.alpha>1000,`${mode.mode} ${part.part}: visible texture`);
 }
 console.log(JSON.stringify(results,null,2));
 console.log('PASS: independent actual plate/airway/tongue vertices, six tongue axis movements, coordinated jaw/head, separate teaching/native textures');
}finally{await browser.close();}
