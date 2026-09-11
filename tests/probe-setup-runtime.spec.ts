import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('actual browser uploads original calibration, rejects invalid evidence and reimports verified settings',async({page})=>{
 const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));
 const fixture=JSON.parse(await readFile(resolve('.local-data/probe-setup-qa.json'),'utf8'));
 await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const probe=page.getByRole('region',{name:'Native probe analysis and fitting'});
 await expect(probe.getByRole('button',{name:'Analyze latest probe'})).toBeEnabled();
 await probe.getByRole('button',{name:'Analyze latest probe'}).click();
 await expect(probe).toContainText('Review available; fitting prerequisite not met');
 await probe.getByText('Calibration setup',{exact:true}).click();
 const setup=page.getByRole('region',{name:'Probe calibration setup'});
 await expect(setup).toContainText('Generated software evidence; not a human or device measurement');
 await setup.getByLabel('Calibration package JSON').setInputFiles(resolve(fixture.root,'calibration-package.json'));
 await setup.getByLabel('Coordinate frame',{exact:true}).fill('fixture-metres');
 await setup.getByLabel('Held-quiet pose',{exact:true}).fill('a');
 await setup.getByLabel('Declared jaw control').fill('-3');
 for(const [key,label] of [['source_m','Loudspeaker position (m)'],['microphone_m','Microphone position (m)'],['mouth_m','Mouth position (m)']] as const){
  for(let i=0;i<3;i++)await setup.getByRole('spinbutton',{name:`${label} ${'XYZ'[i]}`,exact:true}).fill(String(fixture.placement[key][i]));
 }
 await page.setViewportSize({width:390,height:844});
 for(const input of await setup.locator('input').all()){
  const bounds=await input.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(391);
 }
 await setup.screenshot({path:resolve(fixture.root,'browser-form-mobile.png')});
 await expect(setup.getByRole('button',{name:'Verify and save calibration setup'})).toBeDisabled();
 await setup.getByLabel('Original calibration evidence files').setInputFiles({name:'calibration-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('incorrect original evidence')});
 await setup.getByRole('checkbox').check();await setup.getByRole('button',{name:'Verify and save calibration setup'}).click();
 await expect(setup.getByRole('alert')).toContainText('SHA-256');
 await setup.getByLabel('Original calibration evidence files').setInputFiles(resolve(fixture.root,'calibration-evidence.txt'));
 await setup.getByRole('checkbox').check();await setup.getByRole('button',{name:'Verify and save calibration setup'}).click();
 await expect(setup).toContainText('Calibration setup saved');
 await expect(probe).toContainText('Review available; fitting prerequisite not met');
 await probe.getByRole('button',{name:'Analyze latest probe'}).click();
 await expect(probe).toContainText('Eligible for scientific fitting');
 await expect(probe.getByRole('button',{name:'Fit probe with voice model'})).toBeDisabled();
 await expect(probe).toContainText('A current scientific model and worker are required');
 const status=await (await page.request.get('/api/probe/status')).json();
 expect(status.import.setupId).toBe(status.setup.setup.setupId);
 expect(status.setup.setup.calibrationAuthenticityVerified).toBe(false);
 expect(status.measurement.includedInFit.value).toBe(false);
 await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click();
 await expect(probe).toContainText('Eligible for scientific fitting');
 await probe.getByText('Calibration setup',{exact:true}).click();
 await setup.getByText('Saved setup and evidence lineage',{exact:true}).click();
 await expect(setup).toContainText(status.setup.setup.configurationSha256);
 await page.setViewportSize({width:390,height:844});
 const box=await setup.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(391);
 await setup.screenshot({path:resolve(fixture.root,'browser-mobile.png')});
 expect(failures).toEqual([]);
});
