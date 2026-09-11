import {test,expect,type Page} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProbeSetupFixture} from './helpers/probe-setup-fixture.mjs';

// Real server, real Python import and real setup verification. The spec seeds only input data:
// generated probe archives in the server's data folder plus calibration package files.
const dataRoot=process.env.E2E_DATA_DIR!;
const seeded=['probe-current.json','probe-imports','probe-setups','probe-setup-current.json','native-pull-latest.json','usb-imports'];
const labels={source_m:'Loudspeaker position (m)',microphone_m:'Microphone position (m)',mouth_m:'Mouth position (m)'} as const;
async function withinPhoneWidth(page:Page,region:ReturnType<Page['getByRole']>){
 await page.setViewportSize({width:390,height:844});
 for(const element of [region,...await region.locator('input').all()]){const box=await element.boundingBox();if(box){expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);}}
}

test('browser freezes a probe setup per capture, analyzes after saving and keeps human recordings ineligible',async({page})=>{
 test.setTimeout(180_000);expect(dataRoot).toBeTruthy();
 const roots:string[]=[];const fixture=async(manifest={})=>{const root=await mkdtemp(join(tmpdir(),'probe-setup-e2e-'));roots.push(root);return {root,...await createProbeSetupFixture(root,{dataRoot,manifest})};};
 const failures:string[]=[],imports:string[]=[];
 page.on('pageerror',error=>failures.push(error.message));
 // Expected failed requests only: the deliberately wrong evidence file below, and other Experiments panels
 // reporting services this isolated server lacks (Astra disabled, no learning session to export).
 const expected:Record<string,number>={'/api/probe/setup':400,'/api/astra/status':503,'/api/learning/memory':409,'/api/session-export':409};
 page.on('console',message=>{if(message.type()!=='error')return;const path=new URL(message.location().url||'http://x/').pathname;if(!message.text().includes(`status of ${expected[path]} `))failures.push(`${message.text()} ${message.location().url}`);});
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/probe/import'))imports.push(request.url());});
 try{
  const first=await fixture();
  await page.route('**/api/astra/**',route=>route.fulfill({status:503,json:{error:'Provider deliberately disabled in browser test'}}));
  await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click();
  const probe=page.getByRole('region',{name:'Native probe analysis and fitting'}),setup=page.getByRole('region',{name:'Probe calibration setup'});
  await probe.getByRole('button',{name:'Analyze latest probe'}).click();
  await expect(probe).toContainText('Review available; fitting prerequisite not met');
  await expect(setup).toContainText('Each probe capture needs its own setup');await expect(setup).toContainText('Hashing is not measurement');
  await expect(setup).toContainText('Generated software evidence; not a human or device measurement');
  await setup.getByLabel('Calibration package JSON').setInputFiles(join(first.root,'calibration-package.json'));
  await expect(setup).toContainText('declared calibration kind: synthetic-fixture');
  await setup.getByLabel('Coordinate frame',{exact:true}).fill('fixture-metres');
  await setup.getByLabel('Held-quiet pose',{exact:true}).fill('a');
  await setup.getByLabel('Declared jaw control').fill('-3');
  for(const [key,label] of Object.entries(labels))for(let i=0;i<3;i++)await setup.getByRole('spinbutton',{name:`${label} ${'XYZ'[i]}`,exact:true}).fill(String(first.placement[key as keyof typeof labels][i]));
  await withinPhoneWidth(page,setup);await setup.screenshot({path:'test-results/probe-setup-form-mobile.png'});
  await page.setViewportSize({width:1280,height:900});
  const save=setup.getByRole('button',{name:'Verify and save calibration setup'});
  await expect(save).toBeDisabled();
  await setup.getByLabel('Original calibration evidence files').setInputFiles({name:'calibration-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('incorrect original evidence')});
  await setup.getByRole('checkbox').check();await save.click();
  await expect(setup.getByRole('alert')).toContainText('SHA-256');
  await setup.getByLabel('Original calibration evidence files').setInputFiles(join(first.root,'calibration-evidence.txt'));
  await setup.getByRole('checkbox').check();await save.click();
  await expect(setup).toContainText('Calibration setup saved');
  // Saving starts the analysis itself; nobody presses Analyze again.
  await expect(probe).toContainText('Eligible for scientific fitting');expect(imports).toHaveLength(2);
  await expect(probe.getByRole('button',{name:'Fit probe with voice model'})).toBeDisabled();
  await expect(probe).toContainText('A current scientific model and worker are required');
  const status=await (await page.request.get('/api/probe/status')).json();
  expect(status.import.setupId).toBe(status.setup.setup.setupId);expect(status.setup.setup.calibrationAuthenticityVerified).toBe(false);expect(status.measurement.includedInFit.value).toBe(false);
  await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click();
  await expect(probe).toContainText('Eligible for scientific fitting');
  await setup.getByText('Saved setup and evidence lineage',{exact:true}).click();await expect(setup).toContainText(status.setup.setup.configurationSha256);
  await withinPhoneWidth(page,setup);await setup.screenshot({path:'test-results/probe-setup-saved-mobile.png'});
  await page.setViewportSize({width:1280,height:900});

  // A second capture on the same rig: the old setup does not carry over, but its values are filled in.
  await fixture({captureId:'22345678-1234-1234-1234-123456789abc'});
  await probe.getByRole('button',{name:'Analyze latest probe'}).click();
  await expect(probe).toContainText('belongs to a different capture; each probe capture needs its own setup');
  await expect(setup).toContainText(`The saved setup ${status.setup.setup.setupId} belongs to an earlier capture`);
  await setup.getByLabel('Calibration package JSON').setInputFiles(join(first.root,'calibration-package.json'));
  for(const [key,label] of Object.entries(labels))for(let i=0;i<3;i++)await expect(setup.getByRole('spinbutton',{name:`${label} ${'XYZ'[i]}`,exact:true})).toHaveValue(String(first.placement[key as keyof typeof labels][i]));
  await expect(setup.getByLabel('Declared jaw control')).toHaveValue('-3');await expect(setup.getByLabel('Coordinate frame',{exact:true})).toHaveValue('fixture-metres');
  await setup.getByLabel('Original calibration evidence files').setInputFiles(join(first.root,'calibration-evidence.txt'));
  await setup.getByRole('checkbox').check();await save.click();
  await expect(probe).toContainText('Eligible for scientific fitting');expect(imports).toHaveLength(4);

  // A human recording cannot be made eligible by any package, so the form is not offered.
  await fixture({captureId:'32345678-1234-1234-1234-123456789abc',provenance:'human-recording'});
  await probe.getByRole('button',{name:'Analyze latest probe'}).click();
  await expect(setup).toContainText('Capture: 32345678-1234-1234-1234-123456789abc · human-recording');
  await expect(setup.getByRole('note')).toContainText('A calibration package is declared, not measured');
  await expect(probe).toContainText('Review available; fitting prerequisite not met');
  await expect(probe).toContainText('Before fitting: Human recordings cannot be fitted until calibration is derived from measurement recordings');
  await expect(setup.getByLabel('Calibration package JSON')).toHaveCount(0);
  await withinPhoneWidth(page,setup);await setup.screenshot({path:'test-results/probe-setup-human-mobile.png'});
  expect(failures).toEqual([]);
 }finally{
  await Promise.all([...roots.map(root=>rm(root,{recursive:true,force:true})),...seeded.map(name=>rm(join(dataRoot,name),{recursive:true,force:true}))]);
 }
});
