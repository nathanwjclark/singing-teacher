import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,access,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {createServer} from 'vite';

test('native teaching API → matched geometry/audio → recorded outcome, historical and educational views',async({page})=>{
 test.setTimeout(180000);
 const repo=process.env.TEACHING_RUNTIME_REPO||process.cwd(),temporary=await mkdtemp(join(tmpdir(),'teaching-browser-'));
 const child=spawn(process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python'),[resolve('science/tests/teaching_browser_fixture.py'),join(temporary,'data')],{cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src'),join(repo,'science/tests')].join(':')},stdio:['pipe','pipe','pipe']});
 let stderr='';child.stderr.on('data',value=>stderr+=value);const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();
 const next=async()=>{const result=await iterator.next();if(result.done)throw Error('Native fixture exited: '+stderr);return result.value;};
 let vite:Awaited<ReturnType<typeof createServer>>|undefined;
 try{
  let port=0;while(!port){const line=await next();try{port=JSON.parse(line).port||0;}catch{/* Native engine output is not a readiness signal. */}}
  const upstream=`http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++){try{if((await fetch(upstream+'/api/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  vite=await createServer({root:repo,optimizeDeps:{include:['react','react-dom/client']},server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:upstream,changeOrigin:true}}},plugins:[{name:'teaching-runtime-entry',configureServer(server){server.middlewares.use('/teaching-runtime',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/teaching-runtime',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import TeachingPanel from'/src/teaching/TeachingPanel.tsx';createRoot(document.getElementById('root')).render(React.createElement(TeachingPanel));</script></body></html>`));});}}]});await vite.listen();
  const address=vite.httpServer!.address();if(!address||typeof address==='string')throw Error('Vite address unavailable');const base=`http://127.0.0.1:${address.port}`;
  // API origin remains the local upstream after Vite proxy rewriting.
  await page.route('**/api/**',async route=>{const response=await page.request.fetch(upstream+new URL(route.request().url()).pathname+new URL(route.request().url()).search,{method:route.request().method(),data:route.request().postData()||undefined,headers:{'Content-Type':route.request().headers()['content-type']||'application/json',Origin:upstream}});await route.fulfill({response});});
  const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));await page.goto(base+'/teaching-runtime');
  await expect(page.getByText('Current Astra instruction',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:'Your model’s prediction'}).check();const prepared=page.waitForResponse(r=>r.url().includes('/api/teaching/prepare'));await page.getByRole('button',{name:'Prepare this model comparison'}).click();const preparation=await prepared;expect(preparation.status(),await preparation.text()).toBe(202);
  await expect(page.getByRole('button',{name:'Load Before: model geometry'})).toBeVisible({timeout:90000});
  await page.getByRole('button',{name:'Load Before: model geometry'}).click();await page.getByRole('button',{name:'Load After: model geometry'}).click();
  await expect(page.getByRole('img',{name:'Before: model geometry;',exact:false})).toBeVisible();await expect(page.getByRole('img',{name:'After: model geometry;',exact:false})).toBeVisible();
  expect(await page.locator('audio').count()).toBe(0);await page.getByRole('button',{name:'Load A: model sound before'}).click();await page.getByRole('button',{name:'Load B: model sound after'}).click();
  await expect(page.locator('audio')).toHaveCount(2);expect(await page.locator('audio').evaluateAll(elements=>elements.every(e=>(e as HTMLAudioElement).paused))).toBe(true);
  const audio=page.locator('audio').first();await audio.evaluate(async element=>{await(element as HTMLAudioElement).play();});await expect.poll(()=>audio.evaluate(element=>(element as HTMLAudioElement).error?.message||null)).toBe(null);
  await writeFile(join(temporary,'data/score'),'score');await expect.poll(async()=>{try{await access(join(temporary,'data/scored'));return true;}catch{return false;}},{timeout:60000}).toBe(true);
  await page.getByRole('button',{name:'Refresh teaching view'}).click();await page.getByRole('radio',{name:'Your recorded result'}).check();await expect(page.getByText('Recorded acoustic differences do not confirm',{exact:false})).toBeVisible({timeout:15000});await expect(page.getByText('Historical comparison:',{exact:false})).toBeVisible();
  await page.getByRole('radio',{name:'General explanation',exact:true}).check();await page.getByRole('combobox').selectOption('cricothyroid-pitch');await page.getByText('See before and after',{exact:true}).click();await expect(page.locator('.mechanism-drawing')).toHaveCount(2);
  await page.getByRole('combobox').selectOption('soft-palate-coupling');await expect(page.getByText('Nasal pathway',{exact:true}).first()).toBeVisible();await page.emulateMedia({reducedMotion:'reduce'});await expect(page.getByText('Reduced motion is on.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Play slow illustration'})).toBeDisabled();
  await page.setViewportSize({width:375,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(failures).toEqual([]);
  // The fixture registers a native candidate but does not manufacture an app fitting summary.
  // Archive its narrow teaching pointer before exercising the complete app empty state.
  await rename(join(temporary,'data/science-current.json'),join(temporary,'data/science-current.teaching-fixture.json'));
  await page.goto(base+'/');await page.getByRole('button',{name:'Experiments',exact:true}).click();await expect(page.getByRole('heading',{name:'Understand your singing cue'})).toBeVisible();await expect(page.getByRole('radio',{name:'General explanation',exact:true})).toBeChecked();expect(failures).toEqual([]);
 }catch(error){console.error('PRIMARY TEST FAILURE',error);throw error;}finally{await page.unrouteAll({behavior:'wait'}).catch(()=>{});await page.close().catch(()=>{});const exited=new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',()=>resolve());});child.kill('SIGTERM');await exited;lines.close();await vite?.close();await rm(temporary,{recursive:true,force:true,maxRetries:3});if(stderr)console.log(stderr);}
});
