import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Real app and scientific worker (tests/motion-timeline.config.ts). The baseline is
// fitted through the app from a generated native voice capture; the motion audio is
// generated native vowel audio with a silent gap, a pitch rise across two bank anchors and one octave jump.
// Synthetic evidence only: the timeline shows software behaviour, not human anatomy.
test('motion audio timeline shows the time course, gaps with reasons and ambiguous alternatives',async({page,request})=>{
 const fixture=process.env.MOTION_E2E_FIXTURE;
 test.skip(!fixture,'Run with -c tests/motion-timeline.config.ts');
 const errors:string[]=[];
 // Known unrelated app behaviour: learning memory answers 409 until a recorded outcome exists (no outcome is recorded here).
 const unrelated=(text:string,url:string)=>url.endsWith('/api/learning/memory')&&text.includes('409');
 page.on('console',message=>{if(message.type()==='error'&&!unrelated(message.text(),message.location().url))errors.push(message.text()+' '+message.location().url);});page.on('pageerror',error=>errors.push(error.message));
 // The server has no provider credential, so Astra cannot make a paid call; no route is intercepted.
 expect((await (await request.get('/api/astra/status')).json()).provider.available).toBe(false);

 expect((await request.post('/api/science/use-latest-capture',{data:{purpose:'calibration',pose:'a',contains_external_excitation:false}})).ok()).toBe(true);
 expect((await request.post('/api/science/run')).status()).toBe(202);
 await expect.poll(async()=>(await (await request.get('/api/science/status')).json()).status,{timeout:240_000,intervals:[1000]}).toBe('succeeded');

 const record=await readFile(join(fixture!,'motion.json')),media=await readFile(join(fixture!,'motion.webm'));
 const imported=await request.post('/api/motion/import',{multipart:{record:{name:'motion.json',mimeType:'application/json',buffer:record},media:{name:'motion.webm',mimeType:'video/webm',buffer:media}}});
 expect(imported.ok()).toBe(true);const captureId=(await imported.json()).capture.id;

 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const group=page.locator('.motion-capture').getByRole('group',{name:'Motion audio analysis'});
 await group.getByLabel('This saved audio contains my declared vowel with no external sound or played probe.').check();
 await group.getByRole('button',{name:'Analyze saved audio once'}).click();
 await expect(group).toContainText('Analysis: succeeded',{timeout:240_000});
 const result=(await (await request.get('/api/motion/analysis?captureId='+captureId)).json()).result;
 const temporal=result.temporalAnalysis;
 expect(result.status).toBe('available');expect(result.modelUpdated).toBe(false);expect(temporal.status).toBe('available');
 await expect(group).toContainText(`Selection: top-3-by-frozen-snapshot-rank (${result.hypothesisSubset.rankingBasis}), fixed before the audio was scored.`);
 // The app's fit records its objective (coarse by default), so the analysis states it matches.
 expect(result.objective).toMatchObject({rescoring:'canonical-coarse-v1',baseline:'canonical-coarse-v1',baselineDeclared:true,matchesBaseline:true});
 await expect(group).toContainText('Scored with the canonical-coarse-v1 objective; the baseline model was fitted with canonical-coarse-v1.');
 for(const warning of result.warnings)await expect(group.getByRole('note').filter({hasText:warning.message})).toBeVisible();

 await group.getByText('Conditional temporal comparison',{exact:true}).click();
 const timeline=group.getByRole('region',{name:'Audio trajectory sensitivity'});
 await expect(timeline.getByRole('img',{name:'Time course of conditional jaw angle hypotheses with missing windows'})).toBeVisible();
 const smoothed=temporal.sensitivity.find((row:{lambda:number})=>row.lambda===.1);
 // Time course: one orange mark per path window, lines only inside linked segments.
 await expect(timeline.locator('circle[fill="#de8d33"]')).toHaveCount(smoothed.alternatives[0].path.length);
 const links=temporal.segments.reduce((sum:number,segment:{positions:number[]})=>sum+segment.positions.length-1,0);
 await expect(timeline.locator('line[stroke="#de8d33"]')).toHaveCount(links);

 // Gaps: every excluded window is drawn and listed with its time and reason; both gap kinds are present.
 const excluded:Array<{position:number;startSeconds:number;reason:string}>=temporal.excludedWindows;
 expect(new Set(excluded.map(row=>row.reason))).toEqual(new Set(['Unvoiced or invalid canonical window','Measured pitch outside the one-semitone bank support']));
 await expect(timeline.locator('[data-missing-window]')).toHaveCount(excluded.length);
 const gaps=group.getByRole('list',{name:'Linked segments and missing windows'});
 for(const row of excluded)await expect(gaps).toContainText(`Missing window ${row.position+1} at ${row.startSeconds.toFixed(2)} s: ${row.reason}`);
 expect(temporal.segments.length).toBeGreaterThan(1);

 // Ambiguity: the table lists every measured window's admissible JA and gain sets.
 await timeline.getByText('Window and transition ambiguity',{exact:true}).click();
 const rows=timeline.locator('tbody tr');await expect(rows).toHaveCount(smoothed.uncertainty.length);
 const ambiguous=smoothed.uncertainty.filter((row:{JASet:number[];gainSet:number[];anatomyCount:number})=>row.JASet.length>1||row.gainSet.length>1||row.anatomyCount>1);
 expect(ambiguous.length).toBeGreaterThan(0);
 for(const row of ambiguous)await expect(rows.nth(smoothed.uncertainty.indexOf(row))).toContainText(row.JASet.join(', '));
 const comparison=smoothed.constantComparison;
 await expect(timeline).toContainText(comparison.admissible?`At λ 0.1 the improvement over the best constant control (JA ${comparison.JA}°, digital gain ${comparison.gain}) is within the tolerance ${comparison.tolerance.toPrecision(3)} (0.01 per window)`:`At λ 0.1 the best path improves on the best constant control (JA ${comparison.JA}°, digital gain ${comparison.gain}) by ${comparison.improvement.toPrecision(3)}, more than the tolerance ${comparison.tolerance.toPrecision(3)} (0.01 per window)`);
 // Pitch-bank anchors: the rise to 200 Hz switches banks; the switch is drawn and path changes there are named.
 expect(result.trajectoryBank.pitchAnchorsHz.length).toBe(2);
 const switches=smoothed.uncertainty.filter((row:{bankIndex:number},i:number)=>i&&row.bankIndex!==smoothed.uncertainty[i-1].bankIndex).length;
 expect(switches).toBeGreaterThan(0);await expect(timeline.locator('[data-pitch-bank-switch]')).toHaveCount(switches);
 await expect(timeline).toContainText(smoothed.pathChangesAtPitchBankSwitch.length?`${smoothed.pathChangesAtPitchBankSwitch.length} of the path's control changes at λ 0.1 coincide with a switch`:'No control change of the path at λ 0.1 coincides with a switch.');
 await timeline.getByRole('img').screenshot({path:'test-results/motion-timeline/timeline-lambda-0.1.png'});
 await group.getByText('Numerical result:',{exact:false}).scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/motion-timeline/analysis-lambda-0.1.png'});

 // Switching regularization redraws the path and the constant-path comparison for that setting.
 await timeline.getByLabel('Transition regularization').selectOption('0');
 const plain=temporal.sensitivity[0];
 await expect(rows).toHaveCount(plain.uncertainty.length);
 await expect(timeline.locator('circle[fill="#de8d33"]')).toHaveCount(plain.alternatives[0].path.length);
 await expect(timeline).toContainText(plain.constantComparison.admissible?'At λ 0 the improvement over the best constant control':'At λ 0 the best path improves on the best constant control');
 await expect(timeline).toContainText(plain.pathChangesAtPitchBankSwitch.length?`${plain.pathChangesAtPitchBankSwitch.length} of the path's control changes at λ 0 coincide with a switch`:'No control change of the path at λ 0 coincides with a switch.');
 await timeline.getByRole('img').screenshot({path:'test-results/motion-timeline/timeline-lambda-0.png'});
 await page.setViewportSize({width:390,height:844});
 await timeline.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/motion-timeline/timeline-narrow.png'});
 expect(errors).toEqual([]);
});
