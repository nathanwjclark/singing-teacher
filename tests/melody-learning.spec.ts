import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'

type Part = { hz: number | null; durationMs: number }
const melody: Part[] = [{hz:220,durationMs:800},{hz:277.18,durationMs:800},{hz:246.94,durationMs:800},{hz:220,durationMs:800}]

test('generated microphone → MediaRecorder → decoded pitch → frozen melody: practice, recall, transfer pass/fail/incomplete and export', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  // Expected resource errors only: Astra is routed to 503 (no paid calls), and with no model run in the isolated data
  // directory the real server answers cue memory and session export with 409. Any other console error fails.
  const expected = ['/api/astra/', '/api/learning/memory', '/api/session-export']
  page.on('console', m => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && expected.some(path => new URL(m.location().url).pathname.startsWith(path)))) errors.push(`${m.text()} ${m.location().url}`) })
  await page.addInitScript(() => {
    // Development fixture: generated microphone PCM, never a human recording. A zero-valued source keeps the
    // stream delivering samples between notes, as a real microphone does; without it Chrome's
    // MediaStreamAudioDestinationNode stops producing frames and MediaRecorder drops the silence.
    let context: AudioContext | null = null, destination: MediaStreamAudioDestinationNode | null = null
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints: MediaStreamConstraints) => {
      if (!constraints.audio) throw new DOMException('No camera in melody software fixture', 'NotFoundError')
      if (!context) {
        context = new AudioContext(); destination = context.createMediaStreamDestination()
        const floor = context.createConstantSource(); floor.offset.value = 0; floor.connect(destination); floor.start()
        void context.resume(); document.addEventListener('click', () => { void context!.resume() }, { capture: true })
      }
      return destination!.stream
    } })
    Object.assign(window, { singFixture: (parts: { hz: number | null; durationMs: number }[]) => {
      if (!context || !destination) throw Error('Generated microphone has not connected')
      let time = context.currentTime+.4
      for (const part of parts) {
        const end = time+part.durationMs/1000
        if (part.hz !== null) { const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.frequency.value = part.hz; gain.gain.value = .16; oscillator.connect(gain).connect(destination); oscillator.start(time); oscillator.stop(end) }
        time = end
      }
      return (time-context.currentTime+.7)*1000
    } })
  })
  await page.route('**/api/astra/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable during generated microphone software QA; no paid calls' } }))
  await page.goto('/'); await page.getByRole('button', { name: 'Experiments', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Teaching and learning lab' })
  await panel.getByText('Record actual teacher / voice-specialist review', { exact: true }).click()
  await panel.getByLabel('Reviewer name', { exact: true }).fill('Fictional software reviewer')
  await panel.getByLabel('Reviewer role', { exact: true }).fill('QA fixture')
  await panel.getByLabel('Review reference / notes', { exact: true }).fill('Generated oscillator input for software verification. No voice or clinical approval.')
  await panel.getByLabel('Use a short melody for practice and phrase transfer').check()
  await expect(panel.getByLabel('Declared melody')).toHaveText('A3 0.8 s → C♯4 0.8 s → B3 0.8 s → A3 0.8 s')
  await panel.getByLabel('Comfortable target Hz', { exact: true }).fill('196')
  await expect(panel.getByLabel('Declared melody')).toHaveText('G3 0.8 s → B3 0.8 s → A3 0.8 s → G3 0.8 s')
  await panel.getByLabel('Comfortable target Hz', { exact: true }).fill('220')
  const setupReference = panel.getByRole('button', { name: /^(Play reference|Playing…)$/ })
  await setupReference.click(); await expect(setupReference).toHaveText('Playing…'); await expect(setupReference).toBeDisabled()
  await expect(setupReference).toHaveText('Play reference', { timeout: 10_000 }); await expect(setupReference).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('01-declare-melody.png'), fullPage: false })
  // Unsupported declaration: a repeated note cannot be located in the pitch track, so freezing is refused.
  await panel.getByLabel(/^Note 2 Hz/).fill('220')
  await panel.getByRole('button', { name: 'Freeze reviewed protocol', exact: true }).click()
  await expect(panel.getByRole('status').last()).toContainText('Adjacent notes must differ by at least 100 cents')
  await expect(panel.getByRole('button', { name: 'Freeze reviewed protocol', exact: true })).toBeVisible()
  await panel.getByLabel(/^Note 2 Hz/).fill('277.18')
  await panel.getByRole('button', { name: 'Freeze reviewed protocol', exact: true }).click()
  await expect(panel).toContainText('Protocol frozen.')
  const practise = panel.getByLabel('Melody to practise')
  await expect(practise).toContainText('A3 0.8 s → C♯4 0.8 s → B3 0.8 s → A3 0.8 s')
  async function capture(parts: Part[], duringRecording?: () => Promise<void>) {
    await panel.getByRole('checkbox', { name: /I will use the frozen context/ }).check()
    await panel.getByRole('button', { name: 'Start attempt recording', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    const duration = await page.evaluate(parts => (window as unknown as { singFixture: (parts: Part[]) => number }).singFixture(parts), parts)
    await duringRecording?.()
    await page.waitForTimeout(duration)
    await panel.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await panel.getByLabel('Your sensation, in your words').fill('Development fixture: generated audio, no human sensation.')
    await panel.getByRole('button', { name: 'Save attempt & sensation', exact: true }).click()
    await expect(panel).toContainText('Attempt retained')
  }
  await capture(melody, async () => { await expect(practise.getByRole('button', { name: 'Play reference' })).toBeDisabled() })
  await page.screenshot({ path: testInfo.outputPath('02-prompted-melody.png'), fullPage: false })
  await panel.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('recall')
  await expect(practise).toHaveCount(0)
  // Single-note scoring needs 30% of the whole recording voiced; 3 s keeps that true when a loaded host delays Stop by seconds.
  await capture([{ hz: 220, durationMs: 3000 }])
  await panel.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('transfer')
  await expect(practise).toHaveCount(0); await expect(panel).not.toContainText('C♯4')
  await expect(panel.locator('.coach-action')).toContainText('from memory')
  await expect(page.getByRole('region', { name: 'Personal cue memory' })).toBeHidden()
  await capture([{ hz: 180, durationMs: 200 }, { hz: null, durationMs: 300 }, ...melody])
  await capture(melody.map((part,i) => i === 1 ? { ...part, hz: 330 } : part))
  await capture(melody.slice(0,3))
  await page.screenshot({ path: testInfo.outputPath('03-transfer-hidden.png'), fullPage: false })
  const downloaded = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Export protocol, reports & scores', exact: true }).click()
  const evidence = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'))
  const summary = evidence.scores.map((s: { status: string; passed: boolean; reasons: string[]; melody?: { onsetMs: number; transitionErrorMs: number | null; durationErrorMs: number | null; frames: unknown; notes: { errorCents: number | null; transitionErrorMs: number | null }[] } }, i: number) => ({ phase: evidence.attempts[i].phase, status: s.status, passed: s.passed, reasons: s.reasons, recordedMs: Date.parse(evidence.attempts[i].endedAt)-Date.parse(evidence.attempts[i].startedAt), samples: evidence.attempts[i].pitches.length, voicedSamples: evidence.attempts[i].pitches.filter((p: { hz: number | null }) => p.hz !== null).length, ...(s.melody ? { onsetMs: s.melody.onsetMs, transitionErrorMs: s.melody.transitionErrorMs, durationErrorMs: s.melody.durationErrorMs, noteErrorCents: s.melody.notes.map(n => n.errorCents), noteStartErrorMs: s.melody.notes.map(n => n.transitionErrorMs), frames: s.melody.frames } : {}) }))
  await writeFile(testInfo.outputPath('melody-metrics.json'), JSON.stringify(summary, null, 2))
  await testInfo.attach('generated-microphone-evidence.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
  expect(evidence.attempts).toHaveLength(5)
  expect(evidence.attempts.every((a: { artifactHash: string }) => /^[a-f0-9]{64}$/.test(a.artifactHash))).toBe(true)
  expect(summary.map((s: { phase: string; status: string; passed: boolean }) => [s.phase, s.status, s.passed])).toEqual([['prompted','scored',true],['recall','scored',true],['transfer','scored',true],['transfer','scored',false],['transfer','failed',false]])
  const [prompted,,correct,wrong,forgot] = evidence.scores
  for (const score of [prompted, correct]) {
    expect(score.melody).toMatchObject({ anchor: 'note-1', offsetObserved: true, missingSamples: 0, rejectedSamples: 0 })
    expect(score.melody.notes.every((n: { errorCents: number }) => n.errorCents < 10)).toBe(true)
    expect(score.melody.transitionErrorMs).toBeLessThan(100); expect(score.melody.durationErrorMs).toBeLessThan(150)
    expect(score.melody.frames.rawPitchAccuracy).toBeGreaterThan(.9); expect(score.melody.frames.voicingRecall).toBeGreaterThan(.95)
  }
  expect(evidence.scores[1].melody).toBeUndefined()
  expect(wrong.melody.notes[1].errorCents).toBeGreaterThan(250); expect(wrong.errorCents).toBe(wrong.melody.notes[1].errorCents); expect(wrong.melody.failures.join()).toMatch(/Note 2: pitch error/)
  expect(forgot.reasons.join()).toMatch(/Note 4 not sung/)
  const kinds = evidence.kit.records.filter((r: { kind: string }) => r.kind === 'transfer-evaluation').map((r: { stage: string; outcome: string }) => [r.stage, r.outcome])
  expect(kinds).toEqual([['cue-free-recall','scored'],['phrase-transfer','scored'],['phrase-transfer','scored'],['phrase-transfer','failed']])
  expect(evidence.kit.records.filter((r: { kind: string }) => r.kind === 'sensation-report')).toHaveLength(5)
  await page.reload(); await page.getByRole('button', { name: 'Experiments', exact: true }).click()
  await expect(panel.getByRole('combobox', { name: 'Stage', exact: true })).toHaveValue('transfer')
  await expect(practise).toHaveCount(0)
  await panel.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('prompted')
  await panel.getByText(/baseline · transfer · failed/).first().click()
  await expect(panel.getByRole('table', { name: 'Per-note melody scores' }).first()).toContainText('B3')
  await expect(panel).toContainText('Note 4 not sung')
  await page.getByRole('table', { name: 'Per-note melody scores' }).first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('04-scores.png'), fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 }); await expect(panel).toBeVisible()
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('table', { name: 'Per-note melody scores' }).first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('05-mobile.png'), fullPage: false })
  expect(errors).toEqual([])
})
