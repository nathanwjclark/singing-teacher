import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';

// Real app and scientific worker (tests/lidar-runtime.config.ts) with LIDAR_FUSION_ENABLED,
// over the app/worker data that tests/fixtures/prepare_lidar_runtime.py leaves by running
// test_app_lidar_runtime.py. No successful API result or geometry is intercepted.
test('retained native LiDAR geometry applies and survives a rejected duplicate scan',async({page,request})=>{
 test.skip(!process.env.LIDAR_E2E_DATA,'Run with -c tests/lidar-runtime.config.ts');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'Paid provider disabled during browser QA'}}));
 const status=await (await request.get('/api/lidar/status')).json();
 expect(status.enabled).toBe(true);expect(status.busy).toBe(false);
 const adopted=status.lastSuccessfulResult||status.result;
 expect(adopted.adoption.model_updated).toBe(true);expect(adopted.geometry.modelId).toBe(status.currentModelId);
 const asset=await request.get(`/api/lidar/artifact?fitId=${adopted.fitId}&name=space-diff.json`);
 expect(asset.ok()).toBe(true);const bytes=await asset.body();
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(adopted.geometry.files['space-diff.json'].sha256);
 const diff=JSON.parse(bytes.toString());
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const panel=page.getByRole('region',{name:'Experimental rear LiDAR comparison'});
 await expect(panel).toContainText('Current adopted geometry uses hypothesis '+adopted.geometry.hypothesisId);
 const canvas=panel.getByLabel('Original depth pixel selection');await expect(canvas).toBeVisible({timeout:20000});
 expect(await canvas.getAttribute('width')).toBe('2');
 // This retained original has no RGB artifact; the UI must not invent an image.
 await expect(panel.getByAltText('Original rear RGB reference, not a depth pixel map')).toHaveCount(0);
 await panel.getByText('Original frame calibration metadata',{exact:true}).click();
 await expect(panel).toContainText('intrinsics_row_major');
 const downloaded=page.waitForResponse(r=>r.url().includes('/api/lidar/artifact?')&&r.url().includes('space-diff.json'));
 await panel.getByRole('button',{name:'Apply depth-ranked model preview'}).click();
 expect((await downloaded).ok()).toBe(true);
 await page.getByText('Model applied',{exact:true}).click();
 const controls=page.locator('.model-adjustment-controls');
 await expect(controls.getByRole('button',{name:'Clear model'})).toBeVisible();
 await expect(controls.getByLabel('Green added / red removed space')).toBeChecked();
 for(const [key,value] of Object.entries(diff.anatomy) as [string,number][]){
  if(Math.abs(value-diff.referenceAnatomy[key])>1e-6)await expect(controls).toContainText(`${key.replaceAll('_',' ')}: ${diff.referenceAnatomy[key].toFixed(2)} → ${value.toFixed(2)}`);
 }
 await expect(page.getByRole('region',{name:'Interactive anatomical movement model'})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('lidar-applied-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Compare with and without LiDAR'})).toBeDisabled();
 await canvas.click({position:{x:.4,y:.4}});
 await panel.getByLabel('Point to mark').selectOption('lower');await canvas.click({position:{x:1.4,y:.4}});
 await expect(panel).toContainText('Upper depth pixel: 0, 0 · Lower depth pixel: 1, 0');
 await panel.getByLabel('Declared evidence source').selectOption('development-fixture');
 await panel.getByLabel('Depth-to-calibration-reference matrix').fill('1 0 0 0 1 0 0 0 1');
 for(const label of ['Evidence for that pixel mapping','Evidence and assumptions behind these uncertainties','Why these visible points correspond','Why a same-frame rigid-distance comparison'])await panel.getByLabel(label).fill('Explicit synthetic software fixture; not a physically calibrated human measurement.');
 await panel.getByLabel('Measurement uncertainty (meters)',{exact:true}).fill('0.0002');
 await panel.getByLabel('Model discrepancy uncertainty (meters)').fill('0.0002');
 await panel.getByLabel('I declare these experimental assumptions').check();
 const submission=page.waitForResponse(r=>r.url().endsWith('/api/lidar/fit'));
 await panel.getByRole('button',{name:'Compare with and without LiDAR'}).click();
 const accepted=await submission;expect(accepted.status()).toBe(202);
 expect(accepted.request().postDataJSON().annotation.sourceKind).toBe('development-fixture');
 const fitId=(await accepted.json()).fitId;
 await expect.poll(async()=>{const current=await (await request.get('/api/lidar/status')).json();return !current.busy&&current.result?.fitId===fitId&&current.result.status==='rejected'},{timeout:60000}).toBe(true);
 await expect(panel).toContainText('Numerical result: rejected',{timeout:60000});
 await expect(panel).toContainText('The latest attempt did not replace this saved geometry.');
 const after=await (await request.get('/api/lidar/status')).json();
 expect(after.currentModelId).toBe(status.currentModelId);expect(after.result.includedInFit).toBe(false);
 expect(after.lastSuccessfulResult.geometry).toEqual(adopted.geometry);
 const stale=await request.post('/api/lidar/fit',{data:{...accepted.request().postDataJSON(),requestId:randomUUID(),expectedModelId:adopted.parentModelId}});
 expect(stale.status()).toBe(400);
 await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Apply depth-ranked model preview'})).toBeVisible();
 await expect(canvas).toBeVisible({timeout:20000});
 await page.setViewportSize({width:390,height:844});
 const bounds=await panel.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(391);
 expect(await panel.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
 await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:test.info().outputPath('lidar-rejected-mobile.png')});
 expect(errors).toEqual([]);
});
