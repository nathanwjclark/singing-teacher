import {test,expect} from '@playwright/test';
const url=process.env.VISUAL_QA_URL;
// Runs against an isolated real app/worker with an encoded development recording
// and native baseline. Seed with tests/fixtures/prepare_visual_browser.py using
// PYTHONPATH=.:science/src, then start the app and shared worker against that
// private data root with VISUAL_LIKELIHOOD_ENABLED=1. Use a fresh root per run.
// Numerical coordinates label the synthetic fixture; no human anatomy is implied.
// No visual endpoint or successful result is intercepted.
for(const missing of [true,false])test(`original-frame declaration freezes then scores ${missing?'missing':'visible'} target without changing baseline`,async({page,request})=>{
 test.skip(!url,'Set VISUAL_QA_URL to an isolated prepared native app/worker.');test.setTimeout(120000);
 const before=await (await request.get(url+'/api/visual/status')).json();expect(before.enabled).toBe(true);expect(before.currentModelId).toBeTruthy();
 await page.route('**/api/science/status',route=>route.fulfill({status:503,json:{error:'Baseline registered directly for isolated visual QA; no voice fit display receipt'}}));
 await page.route('**/api/astra/**',route=>route.fulfill({status:503,json:{error:'No paid calls during visual QA'}}));
 await page.goto(url!,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const panel=page.getByRole('region',{name:'Conditional visual likelihood'});
 await expect(panel.getByRole('button',{name:'Calibrate and freeze visual forecast'})).toHaveCount(0);
 await panel.getByRole('button',{name:'Index original video frames'}).click();
 await expect(panel.getByAltText('Original decoded motion frame')).toBeVisible({timeout:30000});
 const freeze=panel.getByRole('button',{name:'Calibrate and freeze visual forecast'});await expect(freeze).toBeDisabled();
 const canvas=panel.getByLabel('Annotate original outer-lip pixels');await expect(canvas).toBeVisible();const box=(await canvas.boundingBox())!;
 await canvas.click({position:{x:box.width*.2697,y:box.height*.2067}});
 await panel.getByLabel('Outer lip to annotate').selectOption('lower');
 await canvas.click({position:{x:box.width*.2667,y:box.height*.1788}});
 await panel.getByLabel('Later target frame (image withheld until forecast is frozen)').selectOption(missing?'1':'2');
 await panel.getByLabel('Assumed jaw angle (degrees)').fill('-2');await panel.getByLabel('Calibration tolerance (pixels)').fill('2');await panel.getByLabel('Declared scale (pixels per meter)').fill('1000');
 await panel.getByLabel('I declare these experimental correspondences and camera/jaw assumptions.').check();
 const accepted=page.waitForResponse(response=>response.url().endsWith('/api/visual/freeze'));await freeze.click();expect((await accepted).status()).toBe(202);
 await expect(panel.getByRole('button',{name:'Open frozen target frame'})).toBeEnabled({timeout:60000});
 const frozenState=await (await request.get(url+'/api/visual/status')).json(),id=frozenState.latestResult.forecastId;
 expect(frozenState.visualForecasts[id].status).toBe('committed');expect(frozenState.currentModelId).toBe(before.currentModelId);
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await panel.getByRole('button',{name:'Open frozen target frame'}).click();
 const target=panel.getByRole('group',{name:'Later target annotation'});await expect(target.getByAltText('Original decoded motion frame')).toBeVisible({timeout:30000});
 if(missing)await target.getByLabel('Target visibility').selectOption('occluded');
 else {const targetCanvas=target.getByLabel('Annotate original outer-lip pixels');const targetBox=(await targetCanvas.boundingBox())!;await targetCanvas.click({position:{x:targetBox.width*.2697,y:targetBox.height*.2067}});await target.getByLabel('Outer lip to annotate').selectOption('lower');await targetCanvas.click({position:{x:targetBox.width*.2667,y:targetBox.height*.1788}});}
 await target.getByLabel('These are my later annotations of the declared outer-lip correspondences.').check();
 const scored=page.waitForResponse(response=>response.url().endsWith('/api/visual/score'));await target.getByRole('button',{name:'Score frozen visual forecast'}).click();expect((await scored).status()).toBe(202);
 await expect(panel).toContainText(`Held-out visual result: ${missing?'missing_required_evidence':'scored'}`,{timeout:60000});await expect(panel).toContainText('Baseline model unchanged');
 const after=await (await request.get(url+'/api/visual/status')).json();expect(after.currentModelId).toBe(before.currentModelId);expect(after.visualForecasts[id].artifact).toEqual(frozenState.visualForecasts[id].artifact);expect(after.visualForecasts[id].score_result.artifact.missing_frame_ids).toHaveLength(missing?1:0);if(!missing){expect(after.visualForecasts[id].score_result.artifact.scores[0].heldout_rms_px).toBeLessThan(2);}
});
