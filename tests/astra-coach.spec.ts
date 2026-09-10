import {test,expect,type Page} from '@playwright/test';
const status={provider:{configured:true,available:true,provider:'test-provider',model:'test-model'},runId:'qa-run',sessionId:'qa-session',remainingCalls:3,callBudget:4,running:false,latest:null as unknown};
const emptyMemory={kind:'subjective-cue-memory',scope:'subjective_not_physiological_evidence',sessionId:'qa-session',entries:[] as unknown[]};
async function open(page:Page){
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'not-run'}}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
}
function receipt(action:'rest'|'record',requestId:string){return {status:'succeeded',requestId,sessionId:'qa-session',runId:'qa-run',decision:{action,experimentId:action==='record'?'exp':null,cue:action==='record'?'Record a comfortable i vowel.':'Pause and rest your voice.',explanation:'Controlled UI test decision.'},designId:action==='record'?'design':null,provider:'test-provider',model:'test-model',completedAt:'2026-09-10T12:00:00Z'}}

test('Experiments shows pending decision, committed recording and rest without console errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let latest:unknown=null,release!:()=>void;let count=0;
 await page.route('**/api/astra/status',r=>r.fulfill({json:{...status,latest}}));
 await page.route('**/api/learning/memory',r=>r.fulfill({json:emptyMemory}));
 await page.route('**/api/astra/decide',async r=>{const body=r.request().postDataJSON();expect(body.goal).toBe('Comfortable brightness');count++;if(count===1)await new Promise<void>(resolve=>{release=resolve});latest=receipt(count===1?'record':'rest',body.requestId);await r.fulfill({json:latest})});
 await open(page);const coach=page.getByRole('region',{name:'Astra experiment coach'});
 await expect(coach).toContainText('Calls remaining: 3 / 4');
 await coach.getByLabel('Your singing goal').fill('Comfortable brightness');
 await coach.getByRole('button',{name:'Ask Astra for the next experiment'}).click();
 await expect(coach.getByRole('button',{name:'Astra is choosing an experiment…'})).toBeDisabled();
 await expect(coach).toContainText('Waiting for the server');release();
 await expect(coach.getByRole('heading',{name:'Next recording',exact:true})).toBeVisible();
 await expect(coach).toContainText('The prediction is committed');
 await coach.getByRole('button',{name:'Ask Astra for the next experiment'}).click();
 await expect(coach.getByRole('heading',{name:'Rest',exact:true})).toBeVisible();
 await expect(coach).not.toContainText('The prediction is committed');expect(errors).toEqual([]);
});

test('provider failure retains goal and retries the identical request; unavailable disables spend',async({page})=>{
 let latest:unknown=null;const attempts:unknown[]=[];
 await page.route('**/api/astra/status',r=>r.fulfill({json:{...status,latest}}));
 await page.route('**/api/learning/memory',r=>r.fulfill({json:emptyMemory}));
 await page.route('**/api/astra/decide',r=>{const body=r.request().postDataJSON();attempts.push(body);if(attempts.length===1)return r.fulfill({status:503,json:{error:'Provider temporarily unavailable'}});latest=receipt('rest',body.requestId);return r.fulfill({json:latest})});
 await open(page);const coach=page.getByRole('region',{name:'Astra experiment coach'});
 await coach.getByLabel('Your singing goal').fill('Keep it comfortable');
 await coach.getByRole('button',{name:'Ask Astra for the next experiment'}).click();
 await expect(coach.getByRole('alert')).toContainText('Provider temporarily unavailable');
 await expect(coach.getByLabel('Your singing goal')).toHaveValue('Keep it comfortable');
 await expect(coach.getByLabel('Your singing goal')).toBeDisabled();
 await coach.getByRole('button',{name:'Retry Astra request'}).click();
 await expect(coach.getByRole('heading',{name:'Rest',exact:true})).toBeVisible();expect(attempts[1]).toEqual(attempts[0]);
 await page.route('**/api/astra/status',r=>r.fulfill({json:{...status,provider:{...status.provider,available:false,reason:'No provider configured'}}}));
 await coach.getByRole('button',{name:'Refresh connection'}).click();
 await expect(coach).toContainText('No provider configured');await expect(coach.getByRole('button',{name:'Ask Astra for the next experiment'})).toBeDisabled();
});

test('mobile sensation failure retains draft, successful save retains report after reload',async({page})=>{
 await page.setViewportSize({width:390,height:844});let memory={...emptyMemory};let saves=0;
 await page.route('**/api/astra/status',r=>r.fulfill({json:status}));
 await page.route('**/api/learning/memory',r=>r.fulfill({json:memory}));
 await page.route('**/api/learning/sensation',r=>{saves++;const {text}=r.request().postDataJSON();if(saves===1)return r.fulfill({status:409,json:{error:'Recording still pending'}});memory={...emptyMemory,entries:[{id:'report',attemptId:'attempt',modelId:'model',runId:'qa-run',designId:'design',text,createdAt:'2026-09-10T12:00:00Z',decisionId:null,cue:null}]};return r.fulfill({json:memory})});
 await open(page);const panel=page.getByRole('region',{name:'Personal cue memory'}),draft=panel.getByLabel('Your sensation or reminder, in your own words');
 await draft.fill('A relaxed buzz near my lips');await panel.getByRole('button',{name:'Save sensation for latest outcome'}).click();
 await expect(panel).toContainText('Recording still pending');await expect(draft).toHaveValue('A relaxed buzz near my lips');
 await panel.getByRole('button',{name:'Save sensation for latest outcome'}).click();
 await expect(draft).toHaveValue('');await expect(panel).toContainText('1 saved reports');await expect(panel).toContainText('A relaxed buzz near my lips');
 await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click();await expect(panel).toContainText('A relaxed buzz near my lips');
 const bounds=await panel.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(391);
});
