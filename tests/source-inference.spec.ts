import {test,expect,type Page} from '@playwright/test';
const empty={enabled:true,running:false,fit:{status:'not-run'},forecast:{status:'not-run'},score:{status:'not-run'},sessionId:'source-session',runId:'source-run'};
const fit={status:'succeeded',result:{status:'completed',actual_synthesis_calls:12,source_model_version:'software-test',joint:{best:{score:1.2},candidates:[{candidate_id:'h1',status:'scored',score:1.2,predictions:[{controls:{PS:800,F0:180,JA:-3,gain:1}}],anatomy:{palate_depth:3.6}},{candidate_id:'h2',status:'scored',score:1.4,predictions:[{controls:{PS:900,F0:180,JA:-3,gain:1}}],anatomy:{palate_depth:3.8}}]},fixed_source:{best:{score:2}},fixed_anatomy:{best:{score:2.2}},identifiability:'Competing explanations remain; no anatomy validation'}};
const forecast=(id='target-1')=>({status:'succeeded',current:true,authoritativeStatus:'committed',result:{sha256:id==='target-1'?'a'.repeat(64):'b'.repeat(64),forecast:{target_id:id,status:'available',sealed_at:'2026-09-10T12:00:00Z',controls:{F0:180,PS:800,JA:-3,gain:1}}}});
async function open(page:Page){
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'Provider disabled for browser QA'}}));
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'not-run'}}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
}

test('optional source flow presents alternatives and requires frozen prediction confirmation before scoring',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let state:Record<string,unknown>={...empty};const actions:string[]=[];let release!:()=>void;
 await page.route('**/api/source/status',r=>r.fulfill({json:state}));
 await page.route('**/api/source/analyze',async r=>{actions.push('analyze');expect(r.request().postDataJSON()).toEqual({});await new Promise<void>(resolve=>{release=resolve});state={...state,fit};await r.fulfill({status:202,json:{accepted:true}})});
 await page.route('**/api/source/forecast',r=>{actions.push('forecast');state={...state,forecast:forecast()};return r.fulfill({status:202,json:{accepted:true}})});
 await page.route('**/api/source/score',r=>{actions.push('score');state={...state,score:{status:'succeeded',result:{status:'model_mismatch',score:4.2,model_updated:false}}};return r.fulfill({status:202,json:{accepted:true}})});
 await open(page);const panel=page.getByRole('region',{name:'Optional source and tract inference'});
 const enable=panel.getByLabel('Enable optional source experiments'),analyze=panel.getByRole('button',{name:'Analyze latest capture for source hypotheses'}),freeze=panel.getByRole('button',{name:'Freeze optional prediction'});
 await expect(enable).not.toBeChecked();await expect(analyze).toBeDisabled();await expect(freeze).toBeDisabled();
 await enable.check();await analyze.click();await expect(panel).toContainText('Optional scientific jobs are running');await expect(enable).toBeDisabled();release();
 await expect(freeze).toBeEnabled();await panel.getByText('Competing source and tract hypotheses (2)',{exact:true}).click();await expect(panel).toContainText('PS: 800.000');await expect(panel).toContainText('not measurements of vocal-fold contact');
 await expect(panel.getByRole('button',{name:'Score later capture against source prediction'})).toHaveCount(0);
 await freeze.click();const score=panel.getByRole('button',{name:'Score later capture against source prediction'});await expect(score).toBeDisabled();await expect(panel).toContainText('Record a new attempt after the prediction');
 await panel.getByLabel('The latest pulled capture is a new comfortable a vowel attempt recorded after this prediction.').check();await score.click();await expect(panel).toContainText('Scientific result: model_mismatch');await expect(panel).toContainText('No model update was applied; the baseline is retained');expect(actions).toEqual(['analyze','forecast','score']);expect(errors).toEqual([]);
});

test('disabled service and failed optional actions leave baseline interface available and permit retry',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 let state:Record<string,unknown>={...empty,enabled:false};let attempts=0;
 await page.route('**/api/source/status',r=>r.fulfill({json:state}));
 await page.route('**/api/source/analyze',r=>{attempts++;if(attempts===1)return r.fulfill({status:409,json:{error:'Original capture is not supported'}});state={...state,fit};return r.fulfill({status:202,json:{accepted:true}})});
 await open(page);const panel=page.getByRole('region',{name:'Optional source and tract inference'}),analyze=panel.getByRole('button',{name:'Analyze latest capture for source hypotheses'});
 await panel.getByLabel('Enable optional source experiments').check();await expect(panel).toContainText('Optional source service is unavailable or disabled');await expect(analyze).toBeDisabled();await expect(page.getByRole('heading',{name:'Scientific model',exact:true})).toBeVisible();
 state={...state,enabled:true};await panel.getByRole('button',{name:'Refresh optional status'}).click();await expect(analyze).toBeEnabled();await analyze.click();await expect(panel.getByRole('alert')).toContainText('Original capture is not supported');await expect(analyze).toBeEnabled();await analyze.click();await expect(panel.getByText('Competing source and tract hypotheses (2)',{exact:true})).toBeVisible();expect(attempts).toBe(2);const bounds=await panel.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(391);
});

test('a newly polled forecast cannot inherit acknowledgement for the previous prediction',async({page})=>{
 let state={...empty,fit,forecast:forecast()};await page.route('**/api/source/status',r=>r.fulfill({json:state}));
 await open(page);const panel=page.getByRole('region',{name:'Optional source and tract inference'});
 await panel.getByLabel('Enable optional source experiments').check();const confirmation=panel.getByLabel('The latest pulled capture is a new comfortable a vowel attempt recorded after this prediction.');await confirmation.check();
 const score=panel.getByRole('button',{name:'Score later capture against source prediction'});await expect(score).toBeEnabled();
 state={...state,forecast:forecast('target-2')};await panel.getByRole('button',{name:'Refresh optional status'}).click();await panel.getByText('Optional experiment lineage',{exact:true}).click();await expect(panel).toContainText('Prediction: target-2');
 await expect(confirmation).not.toBeChecked();await expect(score).toBeDisabled();
});


test('stale and unsupported forecasts cannot instruct a new recording or accept scoring',async({page})=>{
 let state:Record<string,unknown>={...empty,fit,forecast:{...forecast(),current:false,authoritativeStatus:'stale'}};
 await page.route('**/api/source/status',r=>r.fulfill({json:state}));await open(page);
 const panel=page.getByRole('region',{name:'Optional source and tract inference'});await panel.getByLabel('Enable optional source experiments').check();
 await expect(panel).not.toContainText('Record a new attempt after the prediction');
 const score=panel.getByRole('button',{name:'Score later capture against source prediction'});
 expect(await score.count()===0 || await score.isDisabled()).toBe(true);
 const saved=forecast();state={...state,forecast:{...saved,reason:'insufficient-quality',result:{...saved.result,forecast:{...saved.result.forecast,status:'insufficient-quality'}}}};
 await panel.getByRole('button',{name:'Refresh optional status'}).click();
 await expect(panel).toContainText('insufficient-quality');await expect(panel).not.toContainText('Record a new attempt after the prediction');
 expect(await score.count()===0 || await score.isDisabled()).toBe(true);
});
