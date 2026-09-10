import {test,expect,type Page} from '@playwright/test';
const initial={busy:false,currentModelId:null as string|null,canFit:false,fitBlockedReason:'Analyze a probe and fit a voice model first.',import:null as unknown,fit:null as unknown,measurement:null,error:null};
async function open(page:Page){
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'Provider deliberately disabled in browser test'}}));
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'not-run'}}));
 await page.route('**/api/learning/**',r=>r.fulfill({status:409,json:{error:'No session in controlled browser test'}}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
}

test('original probe analysis requires calibration and a current model before displaying actual contribution',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let state={...initial};let release!:()=>void;const fits:unknown[]=[];
 await page.route('**/api/probe/status',r=>r.fulfill({json:state}));
 await page.route('**/api/probe/import',async r=>{expect(Object.keys(r.request().postDataJSON())).toEqual(['requestId']);await new Promise<void>(resolve=>{release=resolve});state={...state,import:{importId:'import-qa',eligible:false,reasons:['Measured source calibration is required'],archiveSha256:'a'.repeat(64),includedInFit:false},fitBlockedReason:'Measured source calibration is required'};await r.fulfill({status:202,json:{accepted:true}})});
 await page.route('**/api/probe/fit',r=>{fits.push(r.request().postDataJSON());state={...state,fit:{importId:'import-qa',modelId:'candidate-qa',parentModelId:'model-qa',status:'succeeded',includedInFit:true,probeRecords:[{id:'response-qa',included_in_fit:true,reason:'Supported calibrated frequency bands'}],score:{joint_discrepancy:1.25},baselineScore:null,nativeCalls:12,adoptionStatus:'not_adopted'}};return r.fulfill({status:202,json:{accepted:true}})});
 await open(page);const panel=page.getByRole('region',{name:'Native probe analysis and fitting'}),fit=panel.getByRole('button',{name:'Fit probe with voice model'});
 await expect(fit).toBeDisabled();await panel.getByRole('button',{name:'Analyze latest probe'}).click();
 await expect(panel).toContainText('Processing original probe evidence');await expect(fit).toBeDisabled();release();
 await expect(panel).toContainText('Review available; fitting prerequisite not met');await expect(panel).toContainText('Measured source calibration is required');await expect(fit).toBeDisabled();
 state={...state,import:{importId:'import-qa',eligible:true,reasons:[],archiveSha256:'a'.repeat(64),includedInFit:false},fitBlockedReason:'Fit a voice model first'};
 await panel.getByRole('button',{name:'Refresh probe status'}).click();await expect(panel).toContainText('Fit a voice model first');await expect(fit).toBeDisabled();
 state={...state,currentModelId:'model-qa',canFit:true,fitBlockedReason:''};await panel.getByRole('button',{name:'Refresh probe status'}).click();await expect(fit).toBeEnabled();await fit.click();
 await expect(panel).toContainText('Included in this fit');await expect(panel).toContainText('Model adoption: not_adopted');await expect(panel).toContainText('Candidate discrepancy: 1.250');await expect(panel).toContainText('Baseline discrepancy: Unavailable');
 expect(fits).toHaveLength(1);expect(fits[0]).toMatchObject({importId:'import-qa',expectedModelId:'model-qa'});await expect(panel).toContainText('They do not establish correct internal anatomy');expect(errors).toEqual([]);
});

test('probe errors remain visible and browser JSON review never submits a scientific fit',async({page})=>{
 await page.setViewportSize({width:390,height:844});let submissions=0;
 await page.route('**/api/probe/status',r=>r.fulfill({json:initial}));
 await page.route('**/api/probe/import',r=>r.fulfill({status:409,json:{error:'No original probe archive is available'}}));
 await page.route('**/api/probe/fit',r=>{submissions++;return r.fulfill({status:409,json:{error:'Unexpected fit'}})});
 await open(page);const connected=page.getByRole('region',{name:'Native probe analysis and fitting'}),mapping=page.getByRole('region',{name:'Acoustic mapping',exact:true});
 await connected.getByRole('button',{name:'Analyze latest probe'}).click();await expect(connected.getByRole('alert')).toContainText('No original probe archive is available');
 const hash='a'.repeat(64),review={schemaVersion:'probe-records-1.0.0',kind:'acoustic-probe-measurement',id:'review-qa',captureId:'capture-qa',provenance:'software-fixture',captured:{value:true,reason:'Generated test capture'},responseUsable:{value:true,reason:'Generated response'},includedInFit:{value:false,reason:'Review only',operatorVersion:null},units:'recorded-PCM-per-digital-drive',sourceHashes:{manifest:hash,drive:hash,received:hash},extractor:{version:'qa',configuration:{}},timing:{support:'unknown',uncertaintySeconds:null,method:'Unknown'},phaseUsable:false,quality:{repeats:1,clippedSamples:0,snrDb:null,flags:[],validBandHz:[100,200]},response:{frequencyHz:[100,200],real:[1,1],imag:[0,0],magnitude:[1,1],coherence:[null,null],relativeStd:[null,null],valid:[true,true]},artifacts:{response:{path:'response.json',sha256:hash,byteCount:1},impulse:{path:'impulse.raw',sha256:hash,byteCount:1}},calibration:{},interpretation:'Software browser fixture, not human evidence'};
 await mapping.locator('input[type=file]').setInputFiles({name:'probe-measurement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(review))});
 await expect(mapping).toContainText('Review retained privately on this browser');await expect(mapping).toContainText('Included in fit · No');await expect(connected.getByRole('button',{name:'Fit probe with voice model'})).toBeDisabled();
 await expect(mapping).toContainText('Importing a review below only changes this browser’s comparison view');expect(submissions).toBe(0);
 const bounds=await connected.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(391);
 await mapping.locator('input[type=file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"includedInFit":true}')});await expect(mapping).toContainText('Import failed:');expect(submissions).toBe(0);
});
