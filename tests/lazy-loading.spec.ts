import {test,expect,type Page} from '@playwright/test';

// The studio loads most Experiments panels as separate chunks after its own code. These checks hold every
// chunk except the entry and the studio's own App chunk back, so studio behaviour that waits on a lazily
// loaded panel shows up here rather than only on a slow network.
const holdLazyChunks=(page:Page,ms:number)=>page.route(/\/assets\/(?!index-|App-)[^/]+\.js$/,async route=>{await new Promise(resolve=>setTimeout(resolve,ms));await route.continue();});
const noAstra=(page:Page)=>page.route('**/api/astra*',route=>route.fulfill({status:503,json:{error:'No paid calls in browser QA'}}));
type Frame={shown:boolean;studioTabDisabled:boolean};

test('after a reload in cue-free recall the studio and its cues are hidden on every frame',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await noAstra(page);await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const lab=page.getByRole('region',{name:'Teaching and learning lab'});
 await lab.getByText('Record actual teacher / voice-specialist review',{exact:true}).click();
 await lab.getByLabel('Reviewer name',{exact:true}).fill('Test Reviewer');await lab.getByLabel('Reviewer role',{exact:true}).fill('Software test reviewer');await lab.getByLabel('Review reference / notes',{exact:true}).fill('Fixture only.');
 await lab.getByRole('button',{name:'Freeze reviewed protocol'}).click();await expect(lab.getByText('Protocol frozen.')).toBeVisible();
 await lab.getByRole('combobox',{name:'Stage',exact:true}).selectOption('recall');
 // Sample every animation frame from the first one after the reload.
 await context.addInitScript(()=>{const frames:Frame[]=[];(window as unknown as {studioFrames:Frame[]}).studioFrames=frames;const tick=()=>{const studio=document.querySelector('.app-shell > main:not(.research-workspace)');const tab=[...document.querySelectorAll('nav[aria-label=Workspace] button')].find(button=>button.textContent==='Studio') as HTMLButtonElement|undefined;if(studio)frames.push({shown:studio.checkVisibility(),studioTabDisabled:!!tab?.disabled});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 await holdLazyChunks(page,1500);await page.reload();
 await expect(lab.getByRole('combobox',{name:'Stage',exact:true})).toHaveValue('recall');
 // Past the moment the held chunks arrive.
 await expect(page.getByRole('region',{name:'Scientific session replay',includeHidden:true})).toBeAttached({timeout:15_000});await page.waitForTimeout(500);
 const frames=await page.evaluate(()=>(window as unknown as {studioFrames:Frame[]}).studioFrames);
 expect(frames.length).toBeGreaterThan(30);
 expect(frames.filter(frame=>frame.shown)).toEqual([]);
 expect(frames.at(-1)?.studioTabDisabled).toBe(true);
 expect(errors).toEqual([]);
});
