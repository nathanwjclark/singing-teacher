import {test,expect,type Page} from '@playwright/test';

// Generated browser audio only. Production capture and canonical Worker remain real.
async function generatedMicrophone(page:Page){
 await page.addInitScript(()=>{
  type QAWindow=Window & {phonationWorkerCount:number;phonationQA?:{context:AudioContext;gain:GainNode;stream:MediaStream;silence:()=>void;tone:()=>void;failWorker:()=>void}};
  const owner=window as QAWindow;owner.phonationWorkerCount=0;
  const ActualWorker=window.Worker;
  let activeWorker:Worker|null=null;
  window.Worker=class extends ActualWorker{
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);activeWorker=this;owner.phonationWorkerCount++;}
  };
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async(constraints:MediaStreamConstraints)=>{
   if(!constraints.audio)throw new DOMException('Camera excluded from generated-audio QA','NotAllowedError');
   if(owner.phonationQA)return owner.phonationQA.stream;
   const context=new AudioContext({sampleRate:48000}),gain=context.createGain(),destination=context.createMediaStreamDestination();
   gain.gain.value=.25;gain.connect(destination);
   const oscillator=context.createOscillator();oscillator.frequency.value=180;
   const real=new Float32Array(9),imag=new Float32Array(9);for(let h=1;h<9;h++)imag[h]=1/h;
   oscillator.setPeriodicWave(context.createPeriodicWave(real,imag));oscillator.connect(gain);oscillator.start();void context.resume();
   document.addEventListener('click',()=>{void context.resume()},{capture:true});
   owner.phonationQA={context,gain,stream:destination.stream,silence:()=>{gain.gain.value=0},tone:()=>{gain.gain.value=.25},failWorker:()=>{activeWorker?.dispatchEvent(new ErrorEvent('error',{message:'Generated worker failure for QA'}))}};
   return destination.stream;
  }});
 });
 await page.route('**/api/astra/**',r=>r.fulfill({status:503,json:{error:'No provider calls in browser QA'}}));
 await page.route('**/api/science/status',r=>r.fulfill({json:{status:'not-run'}}));
}

test('optional real-worker analysis suppresses silence and disabling leaves microphone usable',async({page})=>{
 await generatedMicrophone(page);await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>Boolean((window as Window & {phonationQA?:unknown}).phonationQA))).toBe(true);
 await page.getByRole('button',{name:'Studio',exact:true}).click();
 const audioResume=page.getByRole('button',{name:'Enable audio',exact:true});
 if(await audioResume.isVisible())await audioResume.click();
 await expect(page.getByRole('button',{name:'Stop microphone',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Experiments',exact:true}).click();
 const panel=page.getByRole('region',{name:'Optional phonation acoustics'});
 await expect(panel.getByLabel('Enable local acoustic feedback')).not.toBeChecked();
 await expect(panel).toContainText('Disabled — existing coaching and scientific modeling continue');
 expect(await page.evaluate(()=>(window as Window & {phonationWorkerCount:number}).phonationWorkerCount)).toBe(0);
 
 const enableAudio=page.getByRole('button',{name:'Enable audio',exact:true});if(await enableAudio.isVisible())await enableAudio.click();
 await expect(page.getByRole('button',{name:'Stop microphone',exact:true,includeHidden:true})).toHaveCount(1);
 await panel.getByLabel('Enable local acoustic feedback').check();
 await panel.getByLabel('I will keep this vowel, pitch, comfortable level and microphone position consistent.').check();
 await expect(panel.locator('.phonation-capabilities')).toContainText('Live measurement: available',{timeout:15000});
 await expect(panel.locator('dl')).toContainText('180.');
 await expect(panel.locator('.phonation-cue')).toBeVisible();
 await page.evaluate(()=>{(window as Window & {phonationQA:{silence:()=>void}}).phonationQA.silence()});
 await expect(panel.locator('.phonation-capabilities')).toContainText('Live measurement: insufficient-quality',{timeout:5000});
 await expect(panel.locator('.phonation-cue')).toHaveCount(0);await expect(panel.locator('dl')).toHaveCount(0);
 await page.evaluate(()=>{(window as Window & {phonationQA:{tone:()=>void}}).phonationQA.tone()});
 await expect(panel.locator('.phonation-capabilities')).toContainText('Live measurement: available',{timeout:5000});
 await panel.getByLabel('Enable local acoustic feedback').uncheck();
 await expect(panel.locator('.phonation-cue')).toHaveCount(0);await expect(panel.locator('dl')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as Window & {phonationQA:{stream:MediaStream}}).phonationQA.stream.getAudioTracks()[0].readyState)).toBe('live');
 await expect(page.getByRole('button',{name:'Stop microphone',exact:true,includeHidden:true})).toHaveCount(1);
});

test('optional worker failure removes current cues without stopping shared microphone',async({page})=>{
 await generatedMicrophone(page);await page.goto('/');
 await expect.poll(()=>page.evaluate(()=>Boolean((window as Window & {phonationQA?:unknown}).phonationQA))).toBe(true);
 await page.getByRole('button',{name:'Studio',exact:true}).click();
 const audioResume=page.getByRole('button',{name:'Enable audio',exact:true});
 if(await audioResume.isVisible())await audioResume.click();
 await expect(page.getByRole('button',{name:'Stop microphone',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Experiments',exact:true}).click();
 
 const enableAudio=page.getByRole('button',{name:'Enable audio',exact:true});if(await enableAudio.isVisible())await enableAudio.click();
 const panel=page.getByRole('region',{name:'Optional phonation acoustics'});
 await panel.getByLabel('Enable local acoustic feedback').check();
 await panel.getByLabel('I will keep this vowel, pitch, comfortable level and microphone position consistent.').check();
 await expect(panel.locator('.phonation-capabilities')).toContainText('Live measurement: available',{timeout:15000});
 await page.evaluate(()=>{(window as Window & {phonationQA:{failWorker:()=>void}}).phonationQA.failWorker()});
 await expect(panel.locator('.phonation-capabilities')).toContainText('Live measurement: failed');
 await expect(panel.locator('.phonation-cue')).toHaveCount(0);await expect(panel.locator('dl')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Stop microphone',exact:true,includeHidden:true})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as Window & {phonationQA:{stream:MediaStream}}).phonationQA.stream.getAudioTracks()[0].readyState)).toBe('live');
});
