import {expect,type APIRequestContext} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Fit the baseline through the app from the seeded native voice capture, then import the
 * encoded native motion recording that tests/fixtures/prepare_motion_timeline.py wrote to
 * `fixture`. Returns the imported capture id and the original media bytes. */
export async function fitBaselineAndImportMotion(request:APIRequestContext,fixture:string){
 expect((await request.post('/api/science/use-latest-capture',{data:{purpose:'calibration',pose:'a',contains_external_excitation:false}})).ok()).toBe(true);
 expect((await request.post('/api/science/run')).status()).toBe(202);
 await expect.poll(async()=>(await (await request.get('/api/science/status')).json()).status,{timeout:240_000,intervals:[1000]}).toBe('succeeded');
 const record=await readFile(join(fixture,'motion.json')),media=await readFile(join(fixture,'motion.webm'));
 const imported=await request.post('/api/motion/import',{multipart:{record:{name:'motion.json',mimeType:'application/json',buffer:record},media:{name:'motion.webm',mimeType:'video/webm',buffer:media}}});
 expect(imported.ok()).toBe(true);
 return {captureId:(await imported.json()).capture.id as string,media};
}
