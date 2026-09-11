import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const source='https://raw.githubusercontent.com/cshan-github/TongueSAM/3f6e8c620e4d89e669a92a22f3be3d007932ce45/data/test_in/1.jpg';
const exampleSha='53e1c1a4aa44db507a2584ba5567a1679a2255442ecb4be56b2f135d286ce2ff';
const entry=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import TongueLab from'/src/components/TongueLab.tsx';
import{loadTongueNetwork,createNeuralTongueTracker}from'/src/lib/tongueNeural.ts';import{createAnatomyMotion}from'/src/lib/anatomyState.ts';
const canvas=document.createElement('canvas');canvas.width=canvas.height=448;const context=canvas.getContext('2d',{willReadFrequently:true});
const video=document.createElement('video');video.muted=true;video.srcObject=canvas.captureStream(30);
const frame={current:{face:[],pose:[],timestamp:0,metrics:{mouthOpen:1,headTilt:0,shoulderTilt:0,brightness:1,motion:0},tongueSearch:{x:0,y:0,width:1,height:1}}};
let tracker,raf;const face=Array.from({length:309},()=>({x:.5,y:.5}));
window.setup=async()=>{const image=new Image();image.src='/public-example';await image.decode();context.drawImage(image,0,0,448,448);await video.play();
 createRoot(document.getElementById('root')).render(React.createElement(TongueLab,{video:{current:video},frame,close:()=>{document.getElementById('root').textContent='Closed';}}));
 tracker=createNeuralTongueTracker();const tick=now=>{frame.current.timestamp=now;const pixels=context.getImageData(0,0,448,448).data;frame.current.tongue=tracker(pixels,448,448,face,now);frame.current.tongueDiagnostic=tracker.diagnostics();frame.current.tongueStatus=frame.current.tongueDiagnostic.reason;raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
};
window.check=()=>({diagnostic:tracker.diagnostics(),tongue:frame.current.tongue,motion:createAnatomyMotion().update(frame.current,false,performance.now()).tongue});
window.calibrate=()=>tracker.resetMotionReference();
window.holdObservation=()=>cancelAnimationFrame(raf);
window.stop=()=>{cancelAnimationFrame(raf);tracker.close();video.srcObject.getTracks().forEach(track=>track.stop());};
window.grayInference=async()=>{const network=await loadTongueNetwork();try{const pixels=new Uint8ClampedArray(448*448*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=128;pixels[i+3]=255;}const start=performance.now(),result=await network.infer(pixels,448,448);return{kind:network.kind,result,milliseconds:performance.now()-start};}finally{await network.close();}};
await window.setup();
</script></body></html>`;

test('real public detector → independent lab labels/export, calibration and missing-model fallback',async({page},testInfo)=>{
 test.setTimeout(90000);
 const example=process.env.TONGUE_PUBLIC_FIXTURE?await readFile(process.env.TONGUE_PUBLIC_FIXTURE):Buffer.from(await(await fetch(source)).arrayBuffer());
 expect(createHash('sha256').update(example).digest('hex')).toBe(exampleSha);
 const vite=await createServer({root:process.cwd(),optimizeDeps:{include:['react','react-dom/client']},server:{host:'127.0.0.1',port:0},plugins:[{name:'tongue-runtime-entry',configureServer(server){
  server.middlewares.use('/api/tongue-neural',(_req,res)=>{res.statusCode=404;res.end('No personal model installed');});
  server.middlewares.use('/public-example',(_req,res)=>{res.setHeader('Content-Type','image/jpeg');res.end(example);});
  server.middlewares.use('/tongue-runtime',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/tongue-runtime',entry));});
 }}]});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await vite.listen();const address=vite.httpServer!.address();if(!address||typeof address==='string')throw Error('No Vite address');
  const url=`http://127.0.0.1:${address.port}/tongue-runtime`;
  await page.goto(url);
  await expect.poll(()=>page.evaluate(()=>window.check?.().tongue?.trackingMode),{timeout:30000}).toBe('region');
  const observed=await page.evaluate(()=>window.check());
  expect(observed.tongue.tip).toBeUndefined();expect(observed.tongue.tip3D).toBeUndefined();expect(observed.tongue.extension).toBeUndefined();expect(observed.motion.visible).toBe(false);expect(observed.motion.extension).toBe(0);
  await page.evaluate(()=>window.calibrate());
  await expect.poll(()=>page.evaluate(()=>window.check().tongue?.trackingMode),{timeout:10000}).toBe('region');
  const calibrated=await page.evaluate(()=>window.check());expect(calibrated.tongue.elevation).toBeUndefined();expect(calibrated.tongue.extension).toBeUndefined();
  // Hold the same public image and its actual observation while labeling it; inference latency may otherwise expire a result between browser actions.
  await expect.poll(()=>page.evaluate(()=>{if(window.check().tongue?.trackingMode!=='region')return false;window.holdObservation();return true;}),{timeout:10000}).toBe(true);
  await page.getByRole('button',{name:'Freeze frame & label tip'}).click();
  await page.getByLabel('Label mode').selectOption('surface');
  const canvas=page.locator('canvas'),bounds=await canvas.boundingBox();if(!bounds)throw Error('Missing lab canvas');
  for(const [x,y] of [[.2,.2],[.8,.2],[.8,.8],[.2,.8]])await page.mouse.click(bounds.x+bounds.width*x,bounds.y+bounds.height*y);
  await page.getByRole('button',{name:'Save visible outline'}).click();await page.getByRole('button',{name:'Mark tip hidden / not identifiable'}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export images + labels + predictions'}).click();
  const download=await downloadPromise;const data=JSON.parse(await readFile((await download.path())!,'utf8'));
  expect(data.samples[0].prediction).toBeUndefined();expect(data.samples[0].regionPrediction).toHaveLength(4);expect(data.samples[0].surface).toHaveLength(4);expect(data.samples[0].label).toBeNull();expect(data.samples[0].predictionObservedAt).toBeGreaterThan(0);expect(data.sessionId).toBeTruthy();
  await page.setViewportSize({width:390,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('tongue-labels-mobile.png'),fullPage:true});
  await page.evaluate(()=>window.stop());
  const gray=await page.evaluate(()=>window.grayInference());expect(gray.kind).toBe('region');expect(gray.result.box).toBeNull();console.log('Public tongue detector:',{confidence:observed.tongue.confidence,grayInferenceMilliseconds:gray.milliseconds});
  await page.route('**/models/tonguesam/manifest.json',route=>route.fulfill({status:404,body:'Baseline unavailable'}));
  await page.goto(url);await expect.poll(()=>page.evaluate(()=>window.check?.().diagnostic.reason),{timeout:10000}).toBe('Tongue baseline is unavailable');
  await expect(page.getByRole('button',{name:'Freeze frame & label tip'})).toBeEnabled();await page.getByRole('button',{name:'Freeze frame & label tip'}).click();await page.getByRole('button',{name:'Mark tip hidden / not identifiable'}).click();
  expect(await page.evaluate(()=>window.check().tongue)).toBeUndefined();expect(errors).toEqual([]);
  await page.evaluate(()=>window.stop());
 }finally{await page.close();await vite.close();}
});
