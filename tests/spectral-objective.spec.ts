import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';

// Runs only under tests/spectral-objective.config.ts: the real app server and real
// scientific worker, seeded with a generated native capture (synthetic evidence, not a
// person). No route is intercepted; the config starts the server with no OpenAI key or
// key file, so Astra cannot make a paid call.
test('the selected spectral objective runs the real capture pipeline end to end',async({page,request})=>{
 // Pre-existing console noise outside this feature, reported separately rather than fixed here:
 // the learning-memory and session-export routes answer 409 until a scored outcome exists
 // (the app polls the former), and the audio panel creates an AudioContext before a gesture.
 const known=[/^error: Failed to load resource: the server responded with a status of 409 \(Conflict\) http:\/\/127\.0\.0\.1:\d+\/api\/(learning\/memory|session-export)$/,
  /^warning: The AudioContext was not allowed to start\./];
 const problems:string[]=[];
 page.on('console',message=>{const text=`${message.type()}: ${message.text()} ${message.location().url}`;if(['error','warning'].includes(message.type())&&!known.some(pattern=>pattern.test(text)))problems.push(text)});
 page.on('pageerror',error=>problems.push(error.message));
 await page.goto('/');
 await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const panel=page.locator('.scientific-model');
 await expect(panel.getByText('Model: not-run')).toBeVisible();
 const selector=panel.getByLabel('Scoring objective');
 await expect(selector).toHaveValue('canonical-coarse-v1');
 await expect(selector.locator('option')).toHaveText([/^Coarse descriptors \(default\)/,/^Multi-resolution spectrum \(experimental\)/]);
 await selector.selectOption('multires-log-spectrum-v1');
 await panel.getByLabel(/This latest recording contains only/).check();
 await page.screenshot({path:'test-results/spectral-objective-selected.png',fullPage:true});
 const started=page.waitForResponse(response=>response.url().endsWith('/api/science/run'));
 await panel.getByRole('button',{name:'Fit latest iPhone capture'}).click();
 const run=await started;
 expect(run.status()).toBe(202);
 expect(run.request().postDataJSON()).toEqual({objective:'multires-log-spectrum-v1'});
 await expect(selector).toBeDisabled();
 await expect.poll(async()=>(await (await request.get('/api/science/status')).json()).status,{timeout:240_000,intervals:[2000]}).toBe('succeeded');
 // On success the app applies the fitted geometry and returns to the studio view.
 await expect(page.getByRole('button',{name:'Studio',exact:true})).toHaveAttribute('aria-pressed','true',{timeout:30_000});
 await expect(page.locator('.model-adjustment-controls summary')).toHaveText('Model applied');
 // The processing notice polls status every few seconds and then clears itself.
 await expect(page.getByRole('status',{name:'Recording processing'})).toHaveCount(0,{timeout:15_000});
 await page.screenshot({path:'test-results/spectral-objective-studio.png',fullPage:true});
 await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(panel.getByText('Model: succeeded')).toBeVisible();
 await expect(panel).toContainText('Scoring objective: Multi-resolution spectrum (experimental)');
 const status=await (await request.get('/api/science/status')).json();
 expect(status.objective).toBe('multires-log-spectrum-v1');
 const result=status.result;
 expect(result.objective).toBe('multires-log-spectrum-v1');
 expect(result.objectivePolicy.config.version).toBe('multires-log-spectrum-v1');
 expect(result.forecast.objective).toBe('multires-log-spectrum-v1');
 expect(result.forecast.objective_policy).toEqual(result.objectivePolicy);
 expect(result.forecast.scorer_implementation_pin.version).toBe('pcm-scorer-pin-1');
 expect(result.anatomyValidated).toBe(false);
 // The fit really used spectral scoring on exact-frame observations from the capture.
 const fit=await (await request.get(`/api/science/asset?run=${result.runId}&name=fit.json`)).json();
 expect(fit.objective).toBe('multires-log-spectrum-v1');
 expect(fit.source_artifact_bytes_verified).toBe(false);
 const scored=fit.joint.candidates.filter((row:{status:string})=>row.status==='scored');
 expect(scored.length).toBeGreaterThan(0);
 for(const row of scored)for(const prediction of row.predictions)expect(prediction.objective_components.components).toHaveProperty('spectral_shape');
 await panel.scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/spectral-objective-result.png',fullPage:true});
 // A later capture of the selected vowel is scored against the sealed spectral forecast.
 const selected=result.forecast.rankings.find((row:{experiment:{experiment_id:string}})=>row.experiment.experiment_id===result.forecast.selected_experiment_id)?.experiment;
 expect(selected,'the spectral forecast selected a separating experiment').toBeTruthy();
 execFileSync('science/.venv/bin/python',['tests/fixtures/prepare_voice_browser.py',process.env.SPECTRAL_E2E_DATA!,'--later',selected.pose],{env:{...process.env,PYTHONPATH:'.:science/src'}});
 await panel.getByLabel(/The latest capture is a new/).check();
 await panel.getByRole('button',{name:'Score latest iPhone capture'}).click();
 await expect.poll(async()=>(await (await request.get('/api/science/outcome')).json()).status,{timeout:180_000,intervals:[2000]}).toBe('succeeded');
 await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(panel.locator('.scientific-outcome')).toContainText('Scientific result:');
 await expect(panel.locator('.scientific-outcome')).toContainText('Scored with: Multi-resolution spectrum (experimental)');
 await expect(panel.locator('.scientific-outcome')).toContainText('Scoring code: same version that froze the forecast');
 const session=(await (await request.get(`/api/science/sessions/${result.sessionId}/state`)).json()).state;
 const update=[...session.jobs].reverse().find((job:{request:{operation:string}})=>job.request.operation==='update_pcm').result;
 expect(update.objective).toBe('multires-log-spectrum-v1');
 expect(update.scorer_pin_status).toBe('verified');
 expect(update.observation_receipt.spectral_observation.frame_sha256).toBe(update.observation_receipt.frame_sha256);
 for(const score of update.scores)expect(score.objective_components.components).toHaveProperty('spectral_shape');
 await panel.locator('.scientific-outcome').scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/spectral-objective-outcome.png',fullPage:true});
 expect(problems).toEqual([]);
});
