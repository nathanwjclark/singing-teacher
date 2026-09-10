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
   const surfaces=[createAtlasSurface('structure'),createAtlasSurface('airway'),createAtlasSurface('tongue')];
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
   const distance=(a,i,j)=>Math.hypot(a[i]-a[j],a[i+1]-a[j+1],a[i+2]-a[j+2]);
   for(const key of ['jaw','head']){
    state.jawOpen=key==='jaw'?.2:0;state.head.x=key==='head'?.15:0;update();
    const next=arrays();
    poseChanges.push({key,moved:next.map((a,i)=>a.some((v,j)=>v!==rest[i][j])),rigidErrors:next.map((a,i)=>Math.max(...[0,123,999,4500,15000].map(j=>Math.abs(distance(a,j,j+300)-distance(rest[i],j,j+300)))))});
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
  const {createOralOverlay}=await import('/src/components/anatomy/oralOverlay.ts');
  const oral=createOralOverlay(),oralState=emptyAnatomyState();
  const oralArrays=()=>oral.group.children.map(mesh=>Array.from(mesh.geometry.getAttribute('position').array));
  oral.update(oralState);const oralRest=oralArrays();
  const distance=(a,i,j)=>Math.hypot(a[i]-a[j],a[i+1]-a[j+1],a[i+2]-a[j+2]);
  const oralCases=[];
  for(const key of ['head','jaw','tongue']){
   oralState.head.x=key==='head'?.3:0;oralState.jawOpen=key==='jaw'?.3:0;oralState.tongue.lift=key==='tongue'?1:0;oralState.tongue.visible=true;oral.update(oralState);
   oralCases.push({key,moved:oralArrays().map((a,i)=>a.some((v,j)=>v!==oralRest[i][j])),rigidErrors:oralArrays().map((a,i)=>Math.max(...[0,123,999,4500,15000].map(j=>Math.abs(distance(a,j,j+300)-distance(oralRest[i],j,j+300)))))});
  }
  oral.dispose();
  return {outcomes,oralCases};
 },diff);
 for(const mode of results.outcomes){
  assert(mode.isolated);
  for(const {axis,moved} of mode.changes)assert.deepEqual(moved,[false,false,axis!=='lateral'],`${mode.mode} ${axis}: only the tongue may move`);
  for(const {key,moved,rigidErrors} of mode.poseChanges){
   assert.deepEqual(moved,key==='jaw'?[true,false,true]:[true,true,true],`${mode.mode} ${key}: only attached pieces follow jaw`);
   assert(rigidErrors[1]<.002&&rigidErrors[2]<.002,`${mode.mode} ${key}: airway and tongue shapes must not smear`);
  }
  for(const part of mode.pixels)assert(part.alpha>1000,`${mode.mode} ${part.part}: visible texture`);
 }
 for(const {key,moved,rigidErrors} of results.oralCases){
  assert.deepEqual(moved,key==='head'?[true,true,true,true]:key==='jaw'?[false,true,false,true]:[false,false,false,false],`${key}: upper/lower cavity and lips articulate independently`);
  assert(rigidErrors.every(error=>error<.002),'Oral pieces preserve pairwise distances under head and jaw rotation');
 }
 console.log(JSON.stringify(results,null,2));
 console.log('PASS: independent actual plate/airway/tongue vertices, six tongue axis movements, rigid head motion, independent upper/lower oral articulation, separate teaching/native textures');
}finally{await browser.close();}
