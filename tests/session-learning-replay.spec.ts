import {test,expect,type Page,type Download} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const cue='Keep a comfortable ah and imagine a gentle silver thread.',sensation='A light buzz near the lips, without extra effort.';
const memory={kind:'subjective-cue-memory',scope:'subjective_not_physiological_evidence',sessionId:'session-qa',entries:[{id:'memory-qa',attemptId:'attempt-qa',modelId:'model-qa',runId:'run-qa',designId:'design-qa',text:sensation,createdAt:'2026-09-10T12:00:00Z',decisionId:'decision-qa',cue}]};
const replay={schemaVersion:'singing-session-export/1',exportedAt:'2026-09-10T12:00:00Z',runId:'run-qa',sessionId:'session-qa',status:'partial',summary:{modelId:'model-qa',sessionVersion:7,eventCount:9,decisionCount:2,attemptCount:3,scoreCount:1,probeFitCount:0},missing:[{source:'worker-ledger',reason:'Worker session unavailable'}],replay:null,artifacts:[{source:'decision',sha256:'a'.repeat(64),byteLength:42,data:{requestId:'decision-qa',cue}}],omissions:[{path:'captures/audio.raw',reason:'Raw media omitted'}],limits:{rawMediaIncluded:false,scientificAccuracyValidated:false},workerLedgerSha256:null};
async function json(download:Download){return JSON.parse(await readFile((await download.path())!,'utf8'))}
async function open(page:Page){
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'No paid calls in browser QA'}}));
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'not-run'}}));
 await page.route('**/api/learning/memory',r=>r.fulfill({json:memory}));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
}

test('session replay preserves partial counts, missing sources and media omissions in download',async({page})=>{
 let fail=false;const problems:string[]=[];
 // Expected: the 503s this spec stubs (Astra disabled, the failing export) and the audio
 // panel's pre-existing AudioContext warning before a gesture.
 const known=[/^error: Failed to load resource: the server responded with a status of 503 \(Service Unavailable\) http:\/\/127\.0\.0\.1:\d+\/api\/(astra\/status|session-export)$/,/^warning: The AudioContext was not allowed to start\./];
 page.on('console',message=>{const text=`${message.type()}: ${message.text()} ${message.location().url}`;if(['error','warning'].includes(message.type())&&!known.some(pattern=>pattern.test(text)))problems.push(text)});page.on('pageerror',error=>problems.push(error.message));
 await page.route('**/api/session-export',r=>r.fulfill(fail?{status:503,json:{error:'Worker export unavailable'}}:{json:replay}));await open(page);
 const panel=page.getByRole('region',{name:'Scientific session replay'}),button=panel.getByRole('button',{name:'Download session replay JSON'});
 // The recompute route is the real server's: with no baseline model it reports that plainly.
 await expect(panel.getByLabel('Numerical score verification').getByRole('status')).toHaveText('Numerical verification: unavailable. Complete a baseline voice model first');
 await expect(panel.getByRole('button',{name:'Download verification report'})).toBeDisabled();
 await expect(panel).toContainText('Export: partial');await expect(panel).toContainText('9 session events · 2 decisions · 3 attempts · 1 scores · 0 probe fits');await expect(panel).toContainText('worker-ledger: Worker session unavailable');await expect(panel).toContainText('worker ledger is unavailable');
 await panel.getByText('Included evidence and export omissions',{exact:true}).click();await expect(panel).toContainText('Omitted captures/audio.raw: Raw media omitted');
 const downloaded=page.waitForEvent('download');await button.click();const artifact=await downloaded;expect(artifact.suggestedFilename()).toBe('tractstar-session-replay.json');expect(await json(artifact)).toEqual(replay);
 fail=true;await panel.getByRole('button',{name:'Refresh session replay'}).click();await expect(panel.getByRole('alert')).toContainText('Worker export unavailable');await expect(button).toBeDisabled();await expect(panel).not.toContainText('9 session events');
 fail=false;await panel.getByRole('button',{name:'Refresh session replay'}).click();await expect(button).toBeEnabled();
 await panel.getByLabel('Numerical score verification').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/session-replay-recompute-unavailable.png',fullPage:true});
 expect(problems).toEqual([]);
});

test('saved Astra cue requires review, freezes lineage and hides local assistance during recall',async({page})=>{
 await page.route('**/api/session-export',r=>r.fulfill({json:replay}));await open(page);const panel=page.getByRole('region',{name:'Teaching and learning lab'});
 await panel.getByText('Use a saved Astra cue and sensation',{exact:true}).click();await panel.getByRole('button',{name:'Load saved scientific cue memory'}).click();await panel.getByRole('combobox',{name:'Saved report',exact:true}).selectOption('memory-qa');
 const use=panel.getByRole('button',{name:'Use saved cue as review candidate'});await expect(use).toBeDisabled();await panel.getByLabel('This exact cue is for a comfortable sustained ah task, not another maneuver.').check();await use.click();await expect(panel).toContainText(cue);await expect(panel).toContainText(sensation);
 await panel.getByRole('button',{name:'Freeze reviewed protocol'}).click();await expect(panel).not.toContainText('Protocol frozen.');
 await panel.getByText('Record actual teacher / voice-specialist review',{exact:true}).click();await panel.getByLabel('Reviewer name',{exact:true}).fill('Fictional QA reviewer');await panel.getByLabel('Reviewer role',{exact:true}).fill('Software test reviewer');await panel.getByLabel('Review reference / notes',{exact:true}).fill('Controlled browser fixture; review workflow only, no clinical approval.');
 await panel.getByRole('button',{name:'Freeze reviewed protocol'}).click();await expect(panel).toContainText('Protocol frozen.');await panel.getByRole('combobox',{name:'Comparison arm',exact:true}).selectOption('variant');await expect(panel.locator('.coach-action')).toHaveText(cue);await expect(panel).toContainText(sensation);
 const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Export protocol, reports & scores'}).click();const saved=await json(await download);
 expect(saved.protocol.cue.lineage).toMatchObject({sessionId:'session-qa',runId:'run-qa',modelId:'model-qa',designId:'design-qa',decisionId:'decision-qa',attemptId:'attempt-qa',memoryId:'memory-qa',sensation});expect(saved.protocol.cue.variant).toBe(cue);expect(saved.kit.records).toHaveLength(2);expect(saved.kit.records[1].provenance.sourceIds).toContain('decision-qa');
 await panel.getByRole('combobox',{name:'Stage',exact:true}).selectOption('recall');await expect(panel.locator('.coach-action')).toContainText('from memory');await expect(panel).not.toContainText(cue);await expect(panel).not.toContainText(sensation);
 await expect(page.getByRole('region',{name:'Personal cue memory'})).toBeHidden();
 await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click();await expect(panel.getByRole('combobox',{name:'Stage',exact:true})).toHaveValue('recall');await expect(panel).not.toContainText(cue);await expect(panel).not.toContainText(sensation);
 await expect(page.getByRole('region',{name:'Personal cue memory'})).toBeHidden();await expect(page.getByRole('button',{name:'Studio',exact:true})).toBeDisabled();
 await panel.getByRole('combobox',{name:'Stage',exact:true}).selectOption('prompted');await expect(page.getByRole('region',{name:'Personal cue memory'})).toBeVisible();await expect(page.getByRole('button',{name:'Studio',exact:true})).toBeEnabled();await expect(panel.locator('.coach-action')).toHaveText(cue);
});
