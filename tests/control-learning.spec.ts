import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';

// Real built app (the default config's web server builds dist/), real app routes and a real
// scientific worker over a seeded session: generated native captures and seeded software
// Astra decisions, so no provider is called. The fixture serves its own app on a free port.
test('delivered cue is frozen, repeated verbatim, scored and learned after three matched attempts',async({page,request})=>{
 test.setTimeout(300_000);
 const repo=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'control-browser-')),data=join(temporary,'data');
 const child=spawn(process.env.SINGING_PYTHON||join(repo,'science/.venv/bin/python'),[resolve('science/tests/control_browser_fixture.py'),data],{cwd:repo,env:{...process.env,PYTHONPATH:[repo,join(repo,'science/src'),join(repo,'science/tests')].join(':')},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',value=>{stderr=(stderr+value).slice(-4000);});const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 // Pre-existing polling noise outside this feature: learning memory answers
 // 409 until a baseline outcome exists, and the audio panel creates an AudioContext before a gesture.
 const known=[/Failed to load resource: the server responded with a status of 409 \(Conflict\) http:\/\/127\.0\.0\.1:\d+\/api\/learning\/memory$/,/The AudioContext was not allowed to start/];
 const problems:string[]=[];
 const tolerated:string[]=[];
 page.on('console',message=>{const text=`${message.type()}: ${message.text()} ${message.location().url}`;if(!['error','warning'].includes(message.type()))return;if(known.some(pattern=>pattern.test(text)))tolerated.push(text);else problems.push(text);});
 page.on('pageerror',error=>problems.push(error.message));
 const flag=async(name:string,done:string)=>{await writeFile(join(data,name),'go');await expect.poll(async()=>{try{await access(join(data,done));return true;}catch{return false;}},{timeout:60000}).toBe(true);};
 try{
  let port=0;while(!port){const line=await lines.next();if(line.done)throw Error('Fixture exited: '+stderr);try{port=JSON.parse(line.value).port||0;}catch{/* Native engine output is not a readiness signal. */}}
  const base=`http://127.0.0.1:${port}`;
  await expect.poll(async()=>{try{return (await request.get(base+'/api/status')).ok();}catch{return false;}},{timeout:30000}).toBe(true);
  const status=async()=>(await request.get(base+'/api/control/status')).json();
  const settle=async(phase:string)=>{await expect.poll(async()=>{const s=await status();return s.running?'running':s[phase]?.status;},{timeout:120000,intervals:[500,1000]}).toBe('succeeded');};
  await page.setViewportSize({width:1280,height:1600});
  await page.goto(base+'/');
  await page.getByRole('button',{name:'Experiments',exact:true}).click();
  const panel=page.getByRole('region',{name:'Cue-execution learning'});
  await expect(panel).toContainText('Current Astra cue: Sing an easy, comfortable ah.');
  await expect(panel).toContainText('No cue has been frozen yet.');
  await panel.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:'test-results/control-learning-start.png'});
  for(let round=0;round<4;round++){
   if(round>0){await flag(`decide-${round}`,`decided-${round}`);await panel.getByRole('button',{name:'Refresh'}).click();}
   await expect(panel.getByRole('button',{name:'Freeze prediction for this cue'})).toBeEnabled({timeout:15000});
   await panel.getByRole('button',{name:'Freeze prediction for this cue'}).click();
   await settle('forecast');
   await panel.getByRole('button',{name:'Refresh'}).click();
   await expect(panel.getByText('Record one attempt using exactly this wording',{exact:false})).toBeVisible({timeout:15000});
   await expect(panel.locator('.control-binding')).toHaveCount(1);
   await expect(panel.locator('.control-cue')).toHaveText('“Sing an easy, comfortable ah.”');
   if(round===3)break;
   await expect(panel.getByRole('cell',{name:`${round} of 3 matched attempts`}).first()).toBeVisible();
   await flag(`publish-${round}`,`published-${round}`);
   await panel.getByLabel('The latest pulled capture is a new attempt recorded after this prediction.').check();
   await panel.getByRole('button',{name:'Score latest capture'}).click();
   await settle('score');
   await panel.getByRole('button',{name:'Refresh'}).click();
   await expect(panel.getByRole('cell',{name:new RegExp(`^${round+1} of 3 matched attempts`)}).first()).toBeVisible({timeout:15000});
  }
  const learned=await status();
  const [binding]=learned.bindings;
  expect(learned.bindings).toHaveLength(1);expect(binding.deliveredCue).toBe('Sing an easy, comfortable ah.');
  expect(binding.latestForecast.anatomies.every((row:{supportStatus:string})=>row.supportStatus==='empirical')).toBe(true);
  expect(learned.modelUpdated).toBe(false);
  await expect(panel.getByRole('cell',{name:'3 of 3 matched attempts'})).toHaveCount(2);
  await expect(panel).not.toContainText('Uniform until 3 matched attempts');
  const residuals=panel.getByLabel('Microphone residual calibration');
  await expect(residuals).toContainText('empirical, 3 attempts');
  await expect(residuals).toContainText('never changes the weights or predictions above');
  await panel.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:'test-results/control-learning-learned.png'});
  await panel.getByRole('button',{name:'Record attempt as stopped'}).click();
  await settle('stop');
  await panel.getByRole('button',{name:'Refresh'}).click();
  await expect(panel).toContainText('3 scored, 0 unscorable, 1 stopped, 0 failed');
  await expect(panel.getByRole('button',{name:'Score latest capture'})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await panel.locator('.control-binding').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:'test-results/control-learning-mobile.png'});
  expect(problems).toEqual([]);
  console.log('Tolerated pre-existing console messages:',JSON.stringify(tolerated));
 }finally{
  await writeFile(join(data,'quit'),'quit').catch(()=>{});
  await new Promise(done=>{const timer=setTimeout(()=>{child.kill('SIGKILL');done(null);},15000);child.once('exit',()=>{clearTimeout(timer);done(null);});});
  await rm(temporary,{recursive:true,force:true});
 }
});
