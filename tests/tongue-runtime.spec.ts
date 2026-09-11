import {test,expect,type Page} from '@playwright/test';
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const source='https://raw.githubusercontent.com/cshan-github/TongueSAM/3f6e8c620e4d89e669a92a22f3be3d007932ce45/data/test_in/1.jpg';
const exampleSha='53e1c1a4aa44db507a2584ba5567a1679a2255442ecb4be56b2f135d286ce2ff';
// Real components and the real tracker, fed a canvas stream of the pinned public example (no face model runs here).
const entry=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><div id="side" style="height:420px"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import TongueLab from'/src/components/TongueLab.tsx';import{SideAnatomyPanel}from'/src/components/anatomy/SideAnatomyPanel.tsx';
import{loadTongueNetwork,createNeuralTongueTracker}from'/src/lib/tongueNeural.ts';import{createAnatomyMotion}from'/src/lib/anatomyState.ts';
const canvas=document.createElement('canvas');canvas.width=canvas.height=448;const context=canvas.getContext('2d',{willReadFrequently:true});
const video=document.createElement('video');video.muted=true;video.srcObject=canvas.captureStream(30);
const frame={current:{face:[],pose:[],timestamp:0,metrics:{mouthOpen:1,headTilt:0,shoulderTilt:0,brightness:1,motion:0},tongueSearch:{x:0,y:0,width:1,height:1}}};
const anatomy=createAnatomyMotion(),motion={current:anatomy.state};
let tracker,raf=0;const face=Array.from({length:309},()=>({x:.5,y:.5}));
const tick=now=>{frame.current.timestamp=now;const pixels=context.getImageData(0,0,448,448).data;frame.current.tongue=tracker(pixels,448,448,face,now);frame.current.tongueDiagnostic=tracker.diagnostics();frame.current.tongueStatus=frame.current.tongueDiagnostic.reason;anatomy.update({...frame.current},false,now);raf=requestAnimationFrame(tick);};
window.setup=async()=>{const image=new Image();image.src='/public-example';await image.decode();context.drawImage(image,0,0,448,448);await video.play();
 createRoot(document.getElementById('root')).render(React.createElement(TongueLab,{video:{current:video},frame,close:()=>{document.getElementById('root').textContent='Closed';}}));
 createRoot(document.getElementById('side')).render(React.createElement(SideAnatomyPanel,{motion}));
 tracker=createNeuralTongueTracker();raf=requestAnimationFrame(tick);
};
window.check=()=>({diagnostic:tracker.diagnostics(),tongue:frame.current.tongue,motion:createAnatomyMotion().update(frame.current,false,performance.now()).tongue,shared:{...anatomy.state.tongue}});
// Sample every frame: a region shown continuously must never drop between results.
window.continuity=milliseconds=>new Promise(resolve=>{const start=performance.now(),seen=new Map();let frames=0,missing=0;const sample=now=>{frames++;const t=frame.current.tongue;if(!t)missing++;else if(!seen.has(t.observedAt))seen.set(t.observedAt,now-t.observedAt);if(now-start<milliseconds)requestAnimationFrame(sample);else resolve({frames,missing,results:seen.size,lags:[...seen.values()]});};requestAnimationFrame(sample);});
window.calibrate=()=>{tracker.resetMotionReference();window.calibratedAt=performance.now();};
window.hold=()=>cancelAnimationFrame(raf);
window.resume=()=>{raf=requestAnimationFrame(tick);};
window.showGray=()=>{context.fillStyle='rgb(128,128,128)';context.fillRect(0,0,448,448);};
window.stop=()=>{cancelAnimationFrame(raf);tracker.close();video.srcObject.getTracks().forEach(track=>track.stop());};
window.grayInference=async()=>{const network=await loadTongueNetwork();try{const pixels=new Uint8ClampedArray(448*448*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=128;pixels[i+3]=255;}const start=performance.now(),result=await network.infer(pixels,448,448);return{kind:network.kind,result,milliseconds:performance.now()-start};}finally{await network.close();}};
await window.setup();
</script></body></html>`;

type Harness={check():{diagnostic:{reason:string;capability?:string;abstained?:boolean};tongue?:Record<string,unknown>&{trackingMode?:string};motion:{visible:boolean;extension:number};shared:{visible:boolean;lift:number;extension:number}};continuity(ms:number):Promise<{frames:number;missing:number;results:number;lags:number[]}>;calibrate():void;calibratedAt:number;hold():void;resume():void;showGray():void;stop():void;grayInference():Promise<{kind:string;result:{box:unknown};milliseconds:number}>};
// The window handle is passed as the function's argument, so harness calls stay typed.
const harness=(page:Page)=>async<T>(fn:(w:Harness)=>T|Promise<T>):Promise<T>=>{const w=await page.evaluateHandle(()=>window);try{return await w.evaluate(fn as never) as T;}finally{await w.dispose();}};

test('real public detector: continuous region, independent review export, real-server fallback and labels',async({page,baseURL})=>{
 test.setTimeout(180000);
 const example=process.env.TONGUE_PUBLIC_FIXTURE?await readFile(process.env.TONGUE_PUBLIC_FIXTURE):Buffer.from(await(await fetch(source)).arrayBuffer());
 expect(createHash('sha256').update(example).digest('hex')).toBe(exampleSha);
 // /api goes to the real app server: its answer for an absent personal model is the fallback trigger under test.
 const vite=await createServer({root:process.cwd(),logLevel:'warn',optimizeDeps:{include:['react','react-dom/client','three']},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:baseURL,changeOrigin:true}}},plugins:[{name:'tongue-runtime-entry',configureServer(server){
  server.middlewares.use('/public-example',(_req,res)=>{res.setHeader('Content-Type','image/jpeg');res.end(example);});
  server.middlewares.use('/tongue-runtime',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/tongue-runtime',entry));});
 }}]});
 // The only permitted console errors are the browser's own resource-load notices for the model responses this test makes unavailable.
 const errors:string[]=[],expectedMissing=['/api/tongue-neural/'];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&!(message.text().startsWith('Failed to load resource')&&expectedMissing.some(path=>message.location().url.includes(path))))errors.push(message.text()+' '+message.location().url);});
 const run=harness(page);
 try{
  await vite.listen();const address=vite.httpServer!.address();if(!address||typeof address==='string')throw Error('No Vite address');
  const url=`http://127.0.0.1:${address.port}/tongue-runtime`;
  const personal=page.waitForResponse(r=>r.url().endsWith('/api/tongue-neural/manifest'));
  await page.goto(url);
  expect((await personal).status()).toBe(404);
  await expect.poll(()=>run(w=>w.check?.().tongue?.trackingMode),{timeout:60000}).toBe('region');
  expect((await run(w=>w.check())).diagnostic.reason).toContain('(no personal tip model installed)');

  // Results used to expire 800 ms after their inference started; on slower devices every box expired on arrival.
  const continuity=await run(w=>w.continuity(4000));
  expect(continuity.missing).toBe(0);expect(continuity.results).toBeGreaterThanOrEqual(3);
  console.log('Region continuity:',{frames:continuity.frames,results:continuity.results,lagMilliseconds:continuity.lags.map(Math.round)});

  const observed=await run(w=>w.check());
  expect(Object.keys(observed.tongue!).sort()).toEqual(['box','confidence','observedAt','trackingMode']);
  expect(observed.diagnostic).toMatchObject({capability:'region',abstained:false});
  expect(observed.motion.visible).toBe(false);expect(observed.motion.extension).toBe(0);expect(observed.shared).toMatchObject({visible:false,lift:0,extension:0});
  await expect(page.locator('.side-anatomy-panel footer span')).toHaveText('TONGUE REGION ONLY · SHAPE NOT DRIVEN');
  // Lift the side panel above the lab backdrop only for its screenshot.
  const side=page.locator('#side');await side.evaluate(e=>{e.style.position='relative';e.style.zIndex='300';});await side.screenshot({path:'test-results/tongue-region-side-panel.png'});await side.evaluate(e=>{e.style.position='';e.style.zIndex='';});
  // Wait for a result computed after calibration; the frame still holds the earlier one until the next tick.
  await run(w=>w.calibrate());
  await expect.poll(()=>run(w=>{const t=w.check().tongue;return t&&(t.observedAt as number)>w.calibratedAt?Object.keys(t).sort():null;}),{timeout:10000}).toEqual(['box','confidence','observedAt','trackingMode']);

  // Frame 1: the detected region, labeled independently by hand.
  await expect.poll(()=>run(w=>{if(w.check().tongue?.trackingMode!=='region')return false;w.hold();return true;}),{timeout:10000}).toBe(true);
  await page.getByRole('button',{name:'Freeze frame & label tip'}).click();
  await page.getByLabel('Label mode').selectOption('surface');
  const canvas=page.locator('.tongue-lab canvas'),bounds=await canvas.boundingBox();if(!bounds)throw Error('Missing lab canvas');
  for(const [x,y] of [[.2,.2],[.8,.2],[.8,.8],[.2,.8]])await page.mouse.click(bounds.x+bounds.width*x,bounds.y+bounds.height*y);
  await page.getByRole('button',{name:'Save visible outline'}).click();await page.getByRole('button',{name:'Mark tip hidden / not identifiable'}).click();
  await page.screenshot({path:'test-results/tongue-region-labels-desktop.png',fullPage:true});
  // Frame 2: a uniform gray frame, where the current detector result is an abstention.
  await page.getByRole('button',{name:'Return to live'}).click();
  await run(w=>{w.showGray();w.resume();});
  await expect.poll(()=>run(w=>{const c=w.check();if(!c.diagnostic.abstained)return false;w.hold();return c.diagnostic.capability;}),{timeout:20000}).toBe('region');
  await page.getByRole('button',{name:'Freeze frame & label tip'}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export images + labels + predictions'}).click();
  const data=JSON.parse(await readFile((await(await downloadPromise).path())!,'utf8'));
  expect(data.samples).toHaveLength(2);
  expect(data.samples[0].prediction).toBeUndefined();expect(data.samples[0].regionPrediction).toHaveLength(4);expect(data.samples[0].surface).toHaveLength(4);expect(data.samples[0].label).toBeNull();expect(data.samples[0].predictionObservedAt).toBeGreaterThan(0);
  expect(data.samples[1].regionPrediction).toBeNull();expect(data.samples[1].prediction).toBeUndefined();expect(data.sessionId).toBeTruthy();
  await page.setViewportSize({width:390,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/tongue-region-labels-mobile.png',fullPage:true});
  await run(w=>w.stop());
  const gray=await run(w=>w.grayInference());expect(gray.kind).toBe('region');expect(gray.result.box).toBeNull();
  console.log('Public tongue detector:',{confidence:observed.tongue!.confidence,grayInferenceMilliseconds:Math.round(gray.milliseconds)});

  // A phone: the real server answers 403 to non-loopback clients, and the phone must still get the public baseline.
  await page.setViewportSize({width:1280,height:900});
  await page.route('**/api/tongue-neural/**',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Private model data is available only on this Mac'})}));
  const forbidden=page.waitForResponse(r=>r.url().endsWith('/api/tongue-neural/manifest'));
  await page.goto(url);expect((await forbidden).status()).toBe(403);
  await expect.poll(()=>run(w=>w.check?.().diagnostic.capability),{timeout:60000}).toBe('region');
  await expect.poll(()=>run(w=>w.check().tongue?.trackingMode),{timeout:30000}).toBe('region');
  expect((await run(w=>w.check())).diagnostic.reason).toContain('(personal tip model is served only to the computer running the app)');
  await run(w=>w.stop());await page.unroute('**/api/tongue-neural/**');

  // A partial personal install is an error with its cause, not a silent switch to the region detector.
  await page.route('**/api/tongue-neural/manifest',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'personal-tongue-neural/v1',modelSha256:'0'.repeat(64)})}));
  await page.route('**/api/tongue-neural/model',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Personal tongue model unavailable'})}));
  await page.goto(url);
  await expect.poll(()=>run(w=>w.check?.().diagnostic),{timeout:10000}).toEqual({state:'lost',reason:'Personal tongue model is incomplete: weights unavailable (HTTP 404)',abstained:false});
  await run(w=>w.stop());await page.unroute('**/api/tongue-neural/manifest');await page.unroute('**/api/tongue-neural/model');


  // No model at all: capture and labeling continue, and nothing is recorded as a region result.
  expectedMissing.push('/models/tonguesam/manifest.json');
  await page.route('**/models/tonguesam/manifest.json',route=>route.fulfill({status:404,body:'Baseline unavailable'}));
  await page.goto(url);await expect.poll(()=>run(w=>w.check?.().diagnostic.reason),{timeout:10000}).toBe('Tongue baseline is unavailable');
  expect((await run(w=>w.check())).diagnostic).toEqual({state:'lost',reason:'Tongue baseline is unavailable',abstained:false});
  await expect(page.getByRole('button',{name:'Freeze frame & label tip'})).toBeEnabled();await page.getByRole('button',{name:'Freeze frame & label tip'}).click();await page.getByRole('button',{name:'Mark tip hidden / not identifiable'}).click();
  const missingPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export images + labels + predictions'}).click();
  const missing=JSON.parse(await readFile((await(await missingPromise).path())!,'utf8'));
  expect(Object.hasOwn(missing.samples[0],'regionPrediction')).toBe(false);expect(missing.samples[0].label).toBeNull();
  await expect(page.locator('.side-anatomy-panel footer span')).toHaveText('SHARED CAMERA MOTION');
  expect(await run(w=>w.check().tongue)).toBeUndefined();
  await run(w=>w.stop());await page.unroute('**/models/tonguesam/manifest.json');
  // Manifest present but weights absent, as when the binary is not fetched yet.
  expectedMissing.push('/models/tonguesam/detector.onnx');
  await page.route('**/models/tonguesam/detector.onnx',route=>route.fulfill({status:404,body:'Weights unavailable'}));
  await page.goto(url);await expect.poll(()=>run(w=>w.check?.().diagnostic.reason),{timeout:10000}).toBe('Tongue baseline weights are unavailable');
  expect(await run(w=>w.check().tongue)).toBeUndefined();await expect(page.getByRole('button',{name:'Freeze frame & label tip'})).toBeEnabled();
  await run(w=>w.stop());
  expect(errors).toEqual([]);
 }finally{await page.close();await vite.close();}
});

test('phone snapshots keep a region box out of tongue landmarks on the real server',async({request})=>{
 const pair=await request.post('/api/pair',{data:{}});expect(pair.status()).toBe(201);
 const {sessionId,token}=await pair.json();
 const post=(extra:Record<string,unknown>)=>request.post(`/api/pair/${sessionId}/snapshots?token=${token}`,{data:{stepId:'tongue',capturedAt:new Date().toISOString(),width:2,height:2,imageDataUrl:'data:image/png;base64,iVBORw0KGgo=',evidence:{kind:'browser-rgb-bootstrap'},...extra}});
 const region={trackingMode:'region',box:[.3,.4,.7,1],observedAt:1200,confidence:.96};
 const refused=await post({landmarks:{face:[],pose:[],tongue:{...region,x:.5,y:.6,lateral:0,lift:0,visibleFraction:0},timestamp:1}});
 expect(refused.status()).toBe(400);expect((await refused.json()).error).toBe('A tongue landmark must be a tip observation; send a region box as visibleTongueRegion');
 expect((await post({landmarks:{face:[],pose:[],tongue:{box:[.3,.4,.7,.8]},timestamp:1}})).status()).toBe(400);
 for(const invalid of [{...region,box:[.7,.4,.3,.8]},{...region,lateral:0},{...region,trackingMode:'tip'},{...region,confidence:null}])expect((await post({landmarks:{face:[],pose:[],tongue:null,timestamp:1},visibleTongueRegion:invalid})).status()).toBe(400);
 const saved=await post({landmarks:{face:[],pose:[],tongue:null,timestamp:1},visibleTongueRegion:region});
 expect(saved.status()).toBe(201);const {snapshot}=await saved.json();
 expect(snapshot.landmarks.tongue).toBeNull();expect(snapshot.visibleTongueRegion).toEqual(region);
 const tip=await post({landmarks:{face:[],pose:[],tongue:{trackingMode:'tip',x:.5,y:.6,lateral:.1,lift:0,visibleFraction:0},timestamp:1}});
 expect(tip.status()).toBe(201);expect((await tip.json()).snapshot.visibleTongueRegion).toBeNull();
});
