import {test,expect} from '@playwright/test';

const result={runId:'ui-test',sessionId:'session-test',modelId:'model-before',nativeCalls:6,calibrationWindows:2,
 sourceCaptureId:null,fitDiscrepancy:2,baselineDiscrepancy:null,anatomy:{},referenceAnatomy:{},jobs:[],
 forecast:{selected_experiment_id:'vowel-a',rankings:[{experiment:{experiment_id:'vowel-a',pose:'a'},predictions:[]}]},
 forecastRole:'Software interface test',interpretation:'No anatomical validation',files:{}};

test('Astra rest disables scoring and capture event submissions',async({page})=>{
 let submitted=0;
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'succeeded',runId:'ui-test',result:{...result,recordingAllowed:false,restDecision:{sessionId:'session-test',decisionId:'rest',createdAt:'2026-09-10T12:00:00Z'},recordingMessage:'Astra selected rest. Ask for a new recording decision.'}}}));
 await page.route('**/api/science/outcome',r=>r.fulfill({json:{status:'not-run'}}));
 await page.route('**/api/science/use-latest-capture',r=>{submitted++;return r.fulfill({json:{prepared:true}})});
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(page.locator('.scientific-outcome')).toContainText('Astra selected rest');
 await expect(page.getByRole('button',{name:'Score latest iPhone capture'})).toBeDisabled();
 await expect(page.getByLabel(/The latest capture is a new/)).toBeDisabled();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('singing:process-capture',{detail:{purpose:'outcome',pose:'a'}})));
 await expect(page.locator('.scientific-model')).toContainText('Ask for a new recording decision');
 expect(submitted).toBe(0);
 await expect(page.locator('.scientific-model')).toContainText('Selected experiment: vowel-a');
});

test('interrupted outcome resumes the existing recording without preparing another capture',async({page})=>{
 let preparations=0,resumes=0;
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'succeeded',runId:'ui-test',result:{...result,recordingAllowed:false,recordingMessage:'A scientific job is updating this session.'}}}));
 await page.route('**/api/science/outcome',r=>{
  if(r.request().method()==='POST'){resumes++;return r.fulfill({status:202,json:{status:'running',outcomeId:'outcome-same'}})}
  return r.fulfill({json:{status:resumes?'running':'interrupted',outcomeId:'outcome-same'}});
 });
 await page.route('**/api/science/use-latest-capture',r=>{preparations++;return r.fulfill({json:{prepared:true}})});
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(page.getByRole('button',{name:'Score latest iPhone capture'})).toBeDisabled();
 await page.getByRole('button',{name:'Resume interrupted scoring'}).click();
 await expect.poll(()=>resumes).toBe(1);
 expect(preparations).toBe(0);
});

test('capture preparation failure is visible and never starts a model job',async({page})=>{
 let runs=0;
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'not-run'}}));
 await page.route('**/api/science/use-latest-capture',r=>r.fulfill({status:409,json:{error:'Pull a saved voice capture from the iPhone first.'}}));
 await page.route('**/api/science/run',r=>{runs++;return r.fulfill({json:{status:'running'}})});
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await page.getByLabel(/This latest recording contains only/).check();
 await page.getByRole('button',{name:'Fit latest iPhone capture'}).click();
 await expect(page.locator('.scientific-model')).toContainText('Pull a saved voice capture');
 expect(runs).toBe(0);
});

test('app prepares captures and displays actual outcome scores without backend input',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let fitted=false,scored=false;const declarations:unknown[]=[];
 await page.route('**/api/science/status',r=>r.fulfill({json:fitted?{status:'succeeded',runId:'ui-test',result}:{status:'not-run'}}));
 await page.route('**/api/science/use-latest-capture',r=>{declarations.push(r.request().postDataJSON());return r.fulfill({json:{prepared:true}})});
 await page.route('**/api/science/run',r=>{expect(r.request().postDataJSON()).toEqual({objective:'canonical-coarse-v1'});fitted=true;return r.fulfill({status:202,json:{status:'running'}})});
 await page.route('**/api/science/outcome',r=>{
  if(r.request().method()==='POST'){expect(r.request().postData()).toBeNull();scored=true;return r.fulfill({status:202,json:{status:'running'}})}
  return r.fulfill({json:scored?{status:'succeeded',outcomeId:'outcome-test',result:{status:'succeeded',scientificStatus:'model_mismatch',modelUpdated:true,modelId:'model-after',sessionId:'session-test',scores:[{hypothesis_id:'h1',standardized_rms:4.125}],retainedHypotheses:2,previousHypotheses:2}}:{status:'not-run'}});
 });
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await page.getByLabel(/This latest recording contains only/).check();
 await page.getByRole('button',{name:'Fit latest iPhone capture'}).click();
 await expect(page.getByRole('heading',{name:'Test the frozen prediction'})).toBeVisible();
 await page.getByLabel(/The latest capture is a new/).check();
 await page.getByRole('button',{name:'Score latest iPhone capture'}).click();
 await expect(page.locator('.scientific-outcome')).toContainText('model_mismatch');
 await expect(page.locator('.scientific-outcome')).toContainText('4.125');
 await expect(page.locator('.scientific-outcome')).toContainText('model-before → model-after');
 expect(declarations).toEqual([{purpose:'calibration',pose:'a',contains_external_excitation:false},{purpose:'outcome',pose:'a',contains_external_excitation:false}]);
 expect(errors).toEqual([]);
});

test('process success does not conceal a stopped outcome and polling refreshes changed results',async({page})=>{
 let inner={status:'stopped_without_model_update',modelUpdated:false,reasons:[] as string[]};
 let outcomeRun='prior-run';
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'succeeded',runId:'ui-test',result}}));
 await page.route('**/api/science/outcome',r=>r.fulfill({json:{status:'succeeded',runId:outcomeRun,outcomeId:'same',result:inner}}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(page.locator('.scientific-outcome')).toContainText('Outcome processing: not-run');
 outcomeRun='ui-test';
 await expect(page.locator('.scientific-outcome')).toContainText('stopped_without_model_update');
 await expect(page.locator('.scientific-outcome')).toContainText('No model update was applied');
 inner={status:'ineligible',modelUpdated:false,reasons:['Recording was clipped']};
 await expect(page.locator('.scientific-outcome')).toContainText('Recording was clipped',{timeout:10000});
});
