import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('all mechanisms render with keyboard scrubbing, paused animation and reduced-motion static views',async()=>{
 const server=await createServer({optimizeDeps:{include:['react','react-dom/client']},server:{host:'127.0.0.1',port:0},plugins:[{name:'teaching-test-page',configureServer(s){s.middlewares.use('/teaching-preview',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/teaching-preview',`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from 'react';
 import {createRoot} from 'react-dom/client';
 import {MechanismIllustration} from '/src/teaching/MechanismIllustration.tsx';
 createRoot(document.getElementById('root')).render(React.createElement(MechanismIllustration,{demonstrationId:new URLSearchParams(location.search).get('id')||'cricothyroid-pitch'}));
 </script></body></html>`));});}}]});
 await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:900,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const base=`http://127.0.0.1:${server.httpServer.address().port}/teaching-preview`;
  for(const id of ['cricothyroid-pitch','soft-palate-coupling','tongue-jaw-vowels','source-filter']){await page.goto(base+'?id='+id);await page.getByRole('img').first().waitFor();assert.equal(await page.getByRole('img').count(),2);assert.ok(await page.getByText('This schematic is not a measurement of your anatomy.').isVisible());if(process.env.TEACHING_SCREENSHOTS)await page.screenshot({path:`${process.env.TEACHING_SCREENSHOTS}/${id}.png`,fullPage:true});}
  await page.goto(base+'?id=cricothyroid-pitch');await page.getByRole('button',{name:'Show one view'}).click();const slider=page.getByRole('slider');await slider.focus();await slider.press('Home');let previousLength=0;
  for(let step=0;step<=100;step++){if(step)await slider.press('ArrowRight');const geometry=await page.locator('.mechanism-fold').last().evaluate(path=>{const numbers=path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);const svg=path.ownerSVGElement;const attachment=svg.querySelector('g .mechanism-attachment');const point=svg.createSVGPoint();point.x=Number(attachment.getAttribute('cx'));point.y=Number(attachment.getAttribute('cy'));const transformed=point.matrixTransform(attachment.parentElement.transform.baseVal.consolidate().matrix);return {length:Math.hypot(numbers[2]-numbers[0],numbers[3]-numbers[1]),error:Math.hypot(numbers[2]-transformed.x,numbers[3]-transformed.y)};});if(step)assert.ok(geometry.length>previousLength);assert.ok(geometry.error<.001);previousLength=geometry.length;}
  assert.equal(await slider.inputValue(),'100');assert.equal(await page.getByRole('img').count(),1);
  await page.getByRole('button',{name:'Replay illustration'}).click();await page.waitForTimeout(160);await page.getByRole('button',{name:'Pause illustration'}).click();const paused=await slider.inputValue();await page.waitForTimeout(160);assert.equal(await slider.inputValue(),paused);
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByText('Reduced motion is on.',{exact:false}).waitFor();assert.equal(await page.getByRole('img').count(),2);assert.ok(await page.getByRole('button',{name:'Play slow illustration'}).isDisabled());
  await page.setViewportSize({width:360,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
