import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('actual generated microphone → MediaRecorder → decoded pitch → frozen melody score and recall hiding',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{
    // Development fixture: explicit generated microphone PCM, never a human recording.
    let context:AudioContext|null=null, destination:MediaStreamAudioDestinationNode|null=null
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async(constraints:MediaStreamConstraints)=>{
      if(!constraints.audio)throw new DOMException('No video in melody software fixture','NotFoundError')
      context??=new AudioContext();destination??=context.createMediaStreamDestination();await context.resume();return destination.stream
    }})
    Object.assign(window,{playMelodyFixture:async(notes:{hz:number;durationMs:number}[])=>{
      if(!context||!destination)throw Error('Generated microphone has not connected')
      await context.resume();let time=context.currentTime+.4
      for(const note of notes){const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=note.hz;oscillator.connect(gain);gain.connect(destination);gain.gain.setValueAtTime(.16,time);oscillator.start(time);time+=note.durationMs/1000;oscillator.stop(time)}
      return (time-context.currentTime+.6)*1000
    }})
  })
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Unavailable during generated microphone software QA; no paid calls'}}))
  await page.goto('/');await page.getByRole('button',{name:'Experiments',exact:true}).click()
  const panel=page.getByRole('region',{name:'Teaching and learning lab'})
  await panel.getByText('Record actual teacher / voice-specialist review',{exact:true}).click()
  await panel.getByLabel('Reviewer name',{exact:true}).fill('Fictional software reviewer')
  await panel.getByLabel('Reviewer role',{exact:true}).fill('QA fixture')
  await panel.getByLabel('Review reference / notes',{exact:true}).fill('Generated oscillator input for software verification. No voice or clinical approval.')
  await panel.getByLabel('Use a short melody for phrase transfer').check()
  await panel.getByLabel('Note 2 Hz',{exact:true}).fill('330');await panel.getByLabel('Note 3 Hz',{exact:true}).fill('275')
  await panel.getByRole('button',{name:'Freeze reviewed protocol',exact:true}).click()
  await expect(panel).toContainText('Protocol frozen.')
  await expect(panel.getByLabel('Frozen transfer melody')).toContainText('330 Hz for 1000 ms')
  async function capture(notes:{hz:number;durationMs:number}[]){
    await panel.getByRole('checkbox',{name:/I will use the frozen context/}).check()
    await panel.getByRole('button',{name:'Start attempt recording',exact:true}).click()
    await expect(panel.getByRole('button',{name:'Stop recording',exact:true})).toBeVisible()
    const duration=await page.evaluate(notes=>(window as unknown as {playMelodyFixture:(notes:{hz:number;durationMs:number}[])=>Promise<number>}).playMelodyFixture(notes),notes)
    await page.waitForTimeout(duration)
    await panel.getByRole('button',{name:'Stop recording',exact:true}).click()
    await panel.getByLabel('Your sensation, in your words').fill('Development fixture: generated audio, no human sensation.')
    await panel.getByRole('button',{name:'Save attempt & sensation',exact:true}).click()
    await expect(panel).toContainText('Attempt retained')
  }
  await capture([{hz:220,durationMs:1200}])
  await panel.getByRole('combobox',{name:'Stage',exact:true}).selectOption('transfer')
  await expect(panel.getByLabel('Frozen transfer melody')).toHaveCount(0)
  await expect(panel.locator('.coach-action')).toContainText('from memory')
  await expect(page.getByRole('region',{name:'Personal cue memory'})).toBeHidden()
  await capture([{hz:220,durationMs:1000},{hz:330,durationMs:1000},{hz:275,durationMs:1000}])
  await capture([{hz:220,durationMs:1000},{hz:440,durationMs:1000},{hz:275,durationMs:1000}])
  const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:'Export protocol, reports & scores',exact:true}).click()
  const evidence=JSON.parse(await readFile((await(await downloaded).path())!,'utf8'))
  await testInfo.attach('generated-microphone-evidence.json',{body:JSON.stringify(evidence,null,2),contentType:'application/json'})
  expect(evidence.attempts).toHaveLength(3);expect(evidence.attempts.every((a:{artifactHash:string})=>/^[a-f0-9]{64}$/.test(a.artifactHash))).toBe(true)
  expect(evidence.scores[0].passed).toBe(true)
  expect(evidence.scores[1].melody).toMatchObject({passed:true,missingSamples:0,rejectedSamples:0})
  expect(evidence.scores[1].melody.notes.every((n:{errorCents:number})=>n.errorCents<10)).toBe(true)
  expect(evidence.scores[2].passed).toBe(false);expect(evidence.scores[2].melody.notes[1].errorCents).toBeGreaterThan(450)
  expect(evidence.kit.records.filter((r:{kind:string})=>r.kind==='transfer-evaluation')).toHaveLength(2)
  await page.reload();await page.getByRole('button',{name:'Experiments',exact:true}).click()
  await expect(panel.getByRole('combobox',{name:'Stage',exact:true})).toHaveValue('transfer')
  await expect(panel.getByLabel('Frozen transfer melody')).toHaveCount(0)
  await panel.getByRole('combobox',{name:'Stage',exact:true}).selectOption('prompted')
  await panel.getByText(/baseline · transfer · scored/).first().click()
  await expect(panel.getByRole('table',{name:'Per-note melody scores'}).first()).toBeVisible()
  await page.setViewportSize({width:390,height:844});await expect(panel).toBeVisible()
  expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})
