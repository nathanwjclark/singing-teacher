import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';

// Runs only under tests/session-recompute.config.ts: the real app server and real
// scientific worker, seeded with a generated native capture (synthetic evidence, not a
// person). No route is intercepted; the server has no OpenAI key, so Astra cannot make
// a paid call. The recompute route, its Python verifier and the worker replay are real.
const data=()=>process.env.RECOMPUTE_E2E_DATA!;
// Everything the app and worker retain, except the recompute attempt's own outputs.
// A SQLite reader may create a -shm index and an empty -wal beside a database; those
// hold no data. A -wal with content would be a write and is compared like any file.
async function retained(){
 const files:Record<string,string>={};
 async function walk(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),name=relative(data(),path);
  if(name==='replay-verifications'||name==='session-recompute-current.json'||name.endsWith('.sqlite3-shm'))continue;
  if(entry.isDirectory())await walk(path);
  else if(entry.isFile()){const bytes=await readFile(path);if(!(name.endsWith('.sqlite3-wal')&&bytes.length===0))files[name]=createHash('sha256').update(bytes).digest('hex');}}}
 await walk(data());return files;
}
async function worker(request:APIRequestContext,sessionId:string){return (await request.get(`/api/science/sessions/${sessionId}/replay`)).json()}
async function recomputeStatus(request:APIRequestContext){return (await request.get('/api/session-recompute/status')).json()}
async function experiments(page:Page){await page.getByRole('button',{name:'Experiments',exact:true}).click()}

test('a retained spectral recording is recomputed read-only through the real app',async({page,request})=>{
 // Pre-existing console noise outside this feature (see spectral-objective.spec.ts): the
 // learning-memory and session-export routes answer 409 until a scored outcome exists,
 // and the audio panel creates an AudioContext before a gesture.
 const known=[/^error: Failed to load resource: the server responded with a status of 409 \(Conflict\) http:\/\/127\.0\.0\.1:\d+\/api\/(learning\/memory|session-export)$/,
  /^warning: The AudioContext was not allowed to start\./];
 const problems:string[]=[];
 page.on('console',message=>{const text=`${message.type()}: ${message.text()} ${message.location().url}`;if(['error','warning'].includes(message.type())&&!known.some(pattern=>pattern.test(text)))problems.push(text)});
 page.on('pageerror',error=>problems.push(error.message));
 await page.goto('/');await experiments(page);
 const replayPanel=page.getByRole('region',{name:'Scientific session replay'}),verification=replayPanel.getByLabel('Numerical score verification');
 // Mounted route, no model yet: a plain unavailable state rather than a 404.
 await expect(verification.getByRole('status')).toHaveText('Numerical verification: unavailable. Complete a baseline voice model first');
 await expect(verification.getByRole('button',{name:'Recompute retained scores'})).toBeDisabled();
 await verification.scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/session-recompute-unavailable.png',fullPage:true});
 // Fit a baseline with the spectral objective, then score a later capture against it.
 const science=page.locator('.scientific-model');
 await science.getByLabel('Scoring objective').selectOption('multires-log-spectrum-v1');
 await science.getByLabel(/This latest recording contains only/).check();
 await science.getByRole('button',{name:'Fit latest iPhone capture'}).click();
 await expect.poll(async()=>(await (await request.get('/api/science/status')).json()).status,{timeout:240_000,intervals:[2000]}).toBe('succeeded');
 // On success the app applies the fitted geometry and returns to the studio view.
 await expect(page.getByRole('button',{name:'Studio',exact:true})).toHaveAttribute('aria-pressed','true',{timeout:30_000});
 const result=(await (await request.get('/api/science/status')).json()).result;
 const selected=result.forecast.rankings.find((row:{experiment:{experiment_id:string}})=>row.experiment.experiment_id===result.forecast.selected_experiment_id)?.experiment;
 expect(selected,'the spectral forecast selected a separating experiment').toBeTruthy();
 execFileSync('science/.venv/bin/python',['tests/fixtures/prepare_voice_browser.py',data(),'--later',selected.pose],{env:{...process.env,PYTHONPATH:'.:science/src'}});
 await experiments(page);
 await science.getByLabel(/The latest capture is a new/).check();
 await science.getByRole('button',{name:'Score latest iPhone capture'}).click();
 await expect.poll(async()=>(await (await request.get('/api/science/outcome')).json()).status,{timeout:180_000,intervals:[2000]}).toBe('succeeded');
 // Everything the recompute must leave untouched, captured after the last scientific action.
 const beforeFiles=await retained(),beforeReplay=await worker(request,result.sessionId);
 const update=[...beforeReplay.state.jobs].reverse().find((job:{request:{operation:string}})=>job.request.operation==='update_pcm');
 expect(update.result.objective).toBe('multires-log-spectrum-v1');
 await experiments(page);
 await replayPanel.getByRole('button',{name:'Refresh session replay'}).click();
 await expect(replayPanel).toContainText('Export: ');
 await expect(verification.getByRole('status')).toHaveText('Numerical verification: not-run');
 await verification.getByRole('button',{name:'Recompute retained scores'}).click();
 await expect(verification.getByRole('status')).toHaveText('Numerical verification: completed',{timeout:240_000});
 const status=await recomputeStatus(request),report=status.report,counts=report.counts;
 // The retained outcome frame reproduces the recorded spectral score under its pinned scoring code.
 const row=report.operations.find((item:{jobId:string})=>item.jobId===update.job_id);
 expect([row.outcome,row.status,row.numericalAgreement,row.policyVerification,row.details.objective]).toEqual(['matched','verified',true,'verified','multires-log-spectrum-v1']);
 expect(row.details.canonical_extractions).toBe(1);
 expect([counts.failed,counts.unavailable,counts.skipped,counts.legacyVersionUnverified]).toEqual([0,0,0,0]);
 expect(counts.matched+counts.unsupported).toBe(counts.total);
 expect(counts.policyVerified).toBe(counts.matched);
 for(const item of report.operations.filter((o:{outcome:string})=>o.outcome==='unsupported'))expect(item.status).toBe('unsupported_operation');
 expect(report.budget.synthesisCalls+report.budget.geometryCalls).toBe(0);
 expect([report.modelUpdated,report.rawMediaIncluded,report.workerLedgerSha256]).toEqual([false,false,beforeReplay.ledger_sha256]);
 await expect(verification).toContainText(`Of ${counts.total} retained operations: ${counts.matched} matched · 0 failed · 0 unavailable · ${counts.unsupported} unsupported · 0 skipped by budget.`);
 await expect(verification).toContainText(`Matched with pinned scoring code: ${counts.matched}. Matched without a scoring-code pin (legacy, not verified): 0.`);
 const table=verification.getByRole('table',{name:'Each retained operation and its verification outcome'});
 await expect(table.getByRole('row')).toHaveCount(counts.total+1);
 const updateRow=table.getByRole('row').filter({hasText:update.job_id});
 await expect(updateRow.getByRole('cell')).toHaveText([/^update_pcm/,'Matched','Agrees','Pinned code matches']);
 await verification.scrollIntoViewIfNeeded();
 await page.screenshot({path:'test-results/session-recompute-completed.png',fullPage:true});
 const download=page.waitForEvent('download');await verification.getByRole('button',{name:'Download verification report'}).click();
 const saved=await download;expect(saved.suggestedFilename()).toBe('tractstar-score-verification.json');
 const downloaded=await readFile((await saved.path())!,'utf8');
 expect(JSON.parse(downloaded)).toEqual(report);expect(downloaded).not.toContain('"pcm"');
 // Read-only: the worker ledger, the historical forecast and every retained file are byte-identical.
 expect(await worker(request,result.sessionId)).toEqual(beforeReplay);
 expect((await (await request.get('/api/science/status')).json()).result.forecast).toEqual(result.forecast);
 expect(await retained()).toEqual(beforeFiles);
 // The session export carries the bound report with the same separate counts.
 const exported=await (await request.get('/api/session-export')).json();
 const artifact=exported.artifacts.find((item:{binding?:{role:string}})=>item.binding?.role==='read-only-score-recomputation');
 expect(artifact.binding).toEqual({sessionId:result.sessionId,role:'read-only-score-recomputation',modelUpdated:false,current:true});
 expect(artifact.data.counts).toEqual(counts);
 // A second attempt on the unchanged ledger reproduces the same outcomes.
 // The button's name changes while it runs, so locate it by position, not by name.
 const start=verification.getByRole('button').first();
 await expect(start).toHaveText('Recompute retained scores');await start.click();await expect(start).toHaveText('Recomputing scores…');
 await expect.poll(async()=>{const next=await recomputeStatus(request);return next.attemptId!==status.attemptId&&next.status},{timeout:240_000,intervals:[1000]}).toBe('completed');
 await expect(verification.getByRole('status')).toHaveText('Numerical verification: completed',{timeout:30_000});
 const again=(await recomputeStatus(request)).report;
 expect(again.counts).toEqual(counts);expect(again.workerLedgerSha256).toBe(report.workerLedgerSha256);
 expect(await retained()).toEqual(beforeFiles);
 expect(problems).toEqual([]);
});
