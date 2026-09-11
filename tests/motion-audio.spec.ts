import {test,expect,type Page} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
async function syntheticMotion(page:Page){
 const bytes=Buffer.from(await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
  const context=canvas.getContext('2d')!;context.fillStyle='#245566';context.fillRect(0,0,96,64);
  const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks:BlobPart[]=[];
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
  const done=new Promise<Blob>(resolve=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}))});
  recorder.start();await new Promise(resolve=>setTimeout(resolve,220));recorder.stop();const blob=await done;stream.getTracks().forEach(track=>track.stop());return [...new Uint8Array(await blob.arrayBuffer())];
 }));
 const id=randomUUID(),sha256=createHash('sha256').update(bytes).digest('hex');
 const record={schemaVersion:'1.0.0',kind:'motion-observation',id,createdAt:new Date().toISOString(),provenance:{kind:'development-fixture',producer:'browser-motion-persistence-qa',producerVersion:'1',sourceIds:['generated-canvas'],sourceHashes:[sha256]},attemptId:id,cueId:'software-fixture',cueVersion:'1',context:{gesture:'Generated canvas; no human movement',description:'Persistence QA only'},samples:[],markers:[{captureMs:0,repetition:1,phase:'neutral',type:'task-start',source:'protocol',note:'Generated canvas starts'},{captureMs:220,repetition:1,phase:'neutral',type:'task-end',source:'protocol',note:'No measured landmarks'}],coordinateFrame:'normalized-image-and-outer-eye-relative-2d',timebase:{clock:'browser-performance',originMs:0,syncUncertaintyMs:null},visibility:'No human landmarks',uncertainty:'unquantified-image-estimates',observedEnvelope:[],media:{filename:`motion-${id}.webm`,mimeType:'video/webm',startedAtMs:0,syncUncertaintyMs:null,sha256,byteLength:bytes.length},missing:{depth:'not-supported',internalGeometry:'not-observed',calibratedHeadPose:'not-captured'},interpretation:'observed-visible-motion-not-anatomical-limits'};
 return {record,bytes,json:Buffer.from(JSON.stringify(record,null,2))};
}

async function open(page:Page){
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'No paid provider calls during browser QA'}}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 return page.locator('.motion-capture');
}
const nativeData=process.env.MOTION_AUDIO_E2E_DATA;

test('optional decoder or missing baseline explains unavailability and retains saved motion downloads',async({page,request})=>{
 test.skip(Boolean(nativeData),'Empty-data check runs in the default suite.');
 let panel=await open(page);const fixture=await syntheticMotion(page);
 const imported=await request.post('/api/motion/import',{multipart:{record:{name:'motion.json',mimeType:'application/json',buffer:fixture.json},media:{name:fixture.record.media.filename,mimeType:'video/webm',buffer:fixture.bytes}}});expect(imported.ok()).toBe(true);
 const capture=(await imported.json()).capture;
 await page.reload();panel=await open(page);const group=panel.getByRole('group',{name:'Motion audio analysis'}),button=group.getByRole('button',{name:'Analyze saved audio once'});
 await expect(button).toBeDisabled();const response=await request.get('/api/motion/analysis?captureId='+capture.id);expect(response.ok()).toBe(true);const status=await response.json();expect(status.currentModelId).toBeNull();
 await group.getByLabel('This saved audio contains my declared vowel with no external sound or played probe.').check();
 if(!status.availability.available){await expect(group).toContainText('Optional audio decoding is unavailable');await expect(button).toBeDisabled();}
 else {await expect(button).toBeEnabled();const failed=page.waitForResponse(r=>r.url().endsWith('/api/motion/analyze'));await button.click();expect((await failed).status()).toBe(503);await expect(group).toContainText('Complete a voice model fit');await expect(group).toContainText('Saved motion replay and downloads remain available');}
 await expect(panel.getByRole('link',{name:'Download saved motion JSON'})).toBeVisible();await expect(panel.getByRole('link',{name:'Download saved video'})).toBeVisible();
 const original=await request.get('/api/motion/media?id='+capture.id);expect(original.ok()).toBe(true);expect(await original.body()).toEqual(fixture.bytes);
});

// Real app and scientific worker (tests/motion-audio.config.ts) over the data seeded by
// tests/fixtures/prepare_motion_timeline.py: the baseline is fitted through the app from a
// generated native voice capture, then the encoded native motion recording is imported.
// Synthetic evidence only. No successful result or motion endpoint is intercepted.
test('prepared native motion audio runs from declaration to actual scientific result',async({page,request})=>{
 test.skip(!nativeData,'Run with -c tests/motion-audio.config.ts');
 expect((await request.post('/api/science/use-latest-capture',{data:{purpose:'calibration',pose:'a',contains_external_excitation:false}})).ok()).toBe(true);
 expect((await request.post('/api/science/run')).status()).toBe(202);
 await expect.poll(async()=>(await (await request.get('/api/science/status')).json()).status,{timeout:240_000,intervals:[1000]}).toBe('succeeded');
 const record=await readFile(join(nativeData!,'fixture','motion.json')),media=await readFile(join(nativeData!,'fixture','motion.webm'));
 const imported=await request.post('/api/motion/import',{multipart:{record:{name:'motion.json',mimeType:'application/json',buffer:record},media:{name:'motion.webm',mimeType:'video/webm',buffer:media}}});expect(imported.ok()).toBe(true);
 const nativeCapture=(await imported.json()).capture.id;
 const panel=await open(page),group=panel.getByRole('group',{name:'Motion audio analysis'});const before=await request.get('/api/motion/analysis?captureId='+nativeCapture);expect((await before.json()).availability.available).toBe(true);
 const declaration=group.getByLabel('This saved audio contains my declared vowel with no external sound or played probe.'),button=group.getByRole('button',{name:'Analyze saved audio once'});
 await expect(button).toBeDisabled();await declaration.check();await expect(button).toBeEnabled();
 const accepted=page.waitForResponse(r=>r.url().endsWith('/api/motion/analyze'));await button.click();const started=await accepted;expect(started.status()).toBe(202);expect(started.request().postDataJSON()).toMatchObject({captureId:nativeCapture,pose:'a',containsExternalExcitation:false});
 await expect(group.getByRole('button',{name:'Analyzing saved audio…'})).toBeDisabled();await expect(group).toContainText('Analysis: succeeded',{timeout:240_000});
 const final=await (await request.get('/api/motion/analysis?captureId='+nativeCapture)).json();expect(final.result).not.toBeNull();expect(final.result.captureId).toBe(nativeCapture);expect(final.result.actualSynthesisCalls).toBeGreaterThan(0);expect(final.result.modelUpdated).toBe(false);
 await expect(group).toContainText(`Numerical result: ${final.result.status}`);await expect(group).toContainText(`${final.result.actualSynthesisCalls} synthesis calls`);await expect(group).toContainText('Baseline model unchanged; visual synchronization unknown');await expect(group).toContainText(`Used ${final.result.hypothesisSubset.selectedIds.length} of ${final.result.hypothesisSubset.totalRetained}`);
 await group.getByText('Model subset and fixed simulation assumptions',{exact:true}).click();await expect(group).toContainText(final.result.modelId);
 await group.getByText('Conditional temporal comparison',{exact:true}).click();
 await expect(group).toContainText('Anatomy stays fixed across the recording');
 if(final.result.temporalAnalysis.sensitivity.length){await group.getByText('Fixed-anatomy comparison without smoothing',{exact:true}).click();await expect(group).toContainText('acoustic cost');}
 await expect(panel.getByRole('link',{name:'Download saved video'})).toBeVisible();expect(await (await request.get('/api/motion/media?id='+nativeCapture)).body()).toEqual(media);
});
