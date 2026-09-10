import {test,expect,type Page,type Download} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

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
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'Paid provider disabled in browser QA'}}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 return page.locator('.motion-capture');
}
async function downloadedBytes(download:Download){return readFile((await download.path())!)}

test('real app retains verified motion originals across reload and rejects mismatched companion bytes',async({page})=>{
 const panel=await open(page),fixture=await syntheticMotion(page);
 await panel.getByLabel('Replay JSON').setInputFiles({name:`motion-${fixture.record.id}.json`,mimeType:'application/json',buffer:fixture.json});
 const save=panel.getByRole('button',{name:'Save motion to app',exact:true}),exportLocal=panel.getByRole('button',{name:'Export motion JSON + video'});
 await expect(save).toBeDisabled();
 const wrong=Buffer.from(fixture.bytes);wrong[wrong.length-1]^=1;
 await panel.getByLabel('Replay companion video').setInputFiles({name:fixture.record.media.filename,mimeType:'video/webm',buffer:wrong});
 await expect(panel.getByRole('alert')).toContainText('SHA-256');await expect(save).toBeDisabled();await expect(exportLocal).toBeEnabled();
 const localDownload=page.waitForEvent('download');await exportLocal.click();expect(JSON.parse((await downloadedBytes(await localDownload)).toString())).toEqual(fixture.record);
 await panel.getByLabel('Replay companion video').setInputFiles({name:fixture.record.media.filename,mimeType:'video/webm',buffer:fixture.bytes});
 await expect(panel).toContainText('Companion video verified');await expect(save).toBeEnabled();
 const actualResponse=page.waitForResponse(response=>response.url().endsWith('/api/motion/import')&&response.request().method()==='POST');await save.click();const response=await actualResponse;expect(response.ok()).toBe(true);const receipt=await response.json();
 expect(receipt.capture).toMatchObject({observationId:fixture.record.id,recordSha256:createHash('sha256').update(fixture.json).digest('hex'),mediaSha256:fixture.record.media.sha256,mediaByteLength:fixture.bytes.length,includedInPhysicalFit:false});
 await expect(panel.getByRole('heading',{name:'Latest motion saved in the app'})).toBeVisible();await expect(panel).toContainText('not included in a physical fit');
 await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click();await expect(panel.getByRole('heading',{name:'Latest motion saved in the app'})).toBeVisible();
 const jsonDownload=page.waitForEvent('download');await panel.getByRole('link',{name:'Download saved motion JSON'}).click();expect(await downloadedBytes(await jsonDownload)).toEqual(fixture.json);
 const videoDownload=page.waitForEvent('download');await panel.getByRole('link',{name:'Download saved video'}).click();expect(await downloadedBytes(await videoDownload)).toEqual(fixture.bytes);
});

test('real server rejection preserves verified local motion and downloadable export',async({page})=>{
 const panel=await open(page),fixture=await syntheticMotion(page);
 fixture.record.media.mimeType='application/octet-stream';fixture.json=Buffer.from(JSON.stringify(fixture.record,null,2));
 await panel.getByLabel('Replay JSON').setInputFiles({name:`motion-${fixture.record.id}.json`,mimeType:'application/json',buffer:fixture.json});
 await panel.getByLabel('Replay companion video').setInputFiles({name:fixture.record.media.filename,mimeType:'video/webm',buffer:fixture.bytes});
 await expect(panel).toContainText('Companion video verified');
 const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/motion/import')&&response.request().method()==='POST');
 await panel.getByRole('button',{name:'Save motion to app',exact:true}).click();const response=await responsePromise;expect(response.status()).toBe(400);
 await expect(panel).toContainText('Only recorded WebM or MP4');
 await expect(panel.getByRole('button',{name:'Export motion JSON + video'})).toBeEnabled();await expect(panel.locator('video')).toBeVisible();
 const downloads:Download[]=[];page.on('download',value=>downloads.push(value));await panel.getByRole('button',{name:'Export motion JSON + video'}).click();await expect.poll(()=>downloads.length).toBe(2);
 const manifest=downloads.find(value=>value.suggestedFilename().endsWith('.json'))!,video=downloads.find(value=>value.suggestedFilename().endsWith('.webm'))!;
 expect(JSON.parse((await downloadedBytes(manifest)).toString())).toEqual(fixture.record);expect(await downloadedBytes(video)).toEqual(fixture.bytes);
});
