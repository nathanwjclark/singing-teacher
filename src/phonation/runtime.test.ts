import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startPhonationMonitor, PHONATION_FRESHNESS_MS } from './runtime.ts'
import type { LivePhonationState } from './runtime.ts'
import { measurePhonation } from './measure.ts'
import type { PhonationMetadata } from './types.ts'
import { addReferenceSample, compareToReference, referenceForProcessing } from './trends.ts'
import type { Reference } from './trends.ts'
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function fixture(mode: 'measure' | 'hang' | 'error' | 'extractor-timeout' = 'measure') {
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, getSettings: () => ({}), stop: () => { throw Error('Must not stop caller track') } })
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream
  let terminated = false, closed = false, disconnected = false, zero = false
  const worker = { onmessage: null as Worker['onmessage'], onerror: null as Worker['onerror'], terminate: () => { terminated = true },
    postMessage: (data: { id: string; pcm: Float32Array; sampleRate: number; metadata: PhonationMetadata }) => {
      if (mode === 'hang') return
      if (mode === 'error') { queueMicrotask(() => worker.onerror?.call(worker as unknown as Worker, {} as ErrorEvent)); return }
      void measurePhonation(data.pcm, data.sampleRate, data.metadata, { deadlineMs: mode === 'extractor-timeout' ? .0001 : 200 }).then(observation => worker.onmessage?.call(worker as unknown as Worker, { data: { id: data.id, observation } } as MessageEvent))
    } }
  const context = { state: 'running', sampleRate: 48000, currentTime: 1, onstatechange: null,
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => { disconnected = true } }),
    createAnalyser: () => ({ fftSize: 4096, disconnect: () => {}, getFloatTimeDomainData: (pcm: Float32Array) => {
      for (let i = 0; i < pcm.length; i++) { pcm[i] = 0; if (!zero) for (let h = 1; h <= 10; h++) pcm[i] += .03 / h * Math.sin(2 * Math.PI * h * 180 * i / 48000) }
    } }), resume: async () => {}, close: async () => { closed = true } }
  const states: LivePhonationState[] = []
  const start = (intervalMs = 40, deadlineMs = 500) => startPhonationMonitor(stream, state => states.push(state), { createWorker: () => worker as unknown as Worker, createContext: () => context as unknown as AudioContext, intervalMs, deadlineMs })
  return { start, states, track, worker, silence: () => { zero = true }, resources: () => ({ terminated, closed, disconnected }) }
}

test('live PCM passes the canonical extractor, and disable closes only owned resources', async () => {
  const f = fixture(), stop = f.start()
  await wait(100)
  try { const result = f.states.find(state => state.status === 'available'); assert.ok(result); assert.ok(result.observation?.frameSha256); assert.equal(result.observation?.capabilities.sourceInference.status, 'unsupported') }
  finally { stop() }
  assert.deepEqual(f.resources(), { terminated: true, closed: true, disconnected: true })
  const count = f.states.length; await wait(80); assert.equal(f.states.length, count)
})
test('silence invalidates current comparison and mic mute/end suppress immediately', async () => {
  const f = fixture(), stop = f.start(); await wait(90)
  try {
    f.silence(); await wait(90); assert.equal(f.states.at(-1)?.status, 'insufficient-quality')
    f.track.muted = true; f.track.dispatchEvent(new Event('mute')); assert.equal(f.states.at(-1)?.observation, null)
    f.track.readyState = 'ended'; f.track.dispatchEvent(new Event('ended')); assert.equal(f.states.at(-1)?.status, 'unsupported'); assert.equal(f.resources().terminated, true)
  } finally { stop() }
})
test('hung worker times out once, terminates, and cannot publish a late result', async () => {
  const f = fixture('hang'), stop = f.start(5, 20); await wait(60)
  try { assert.equal(f.states.at(-1)?.status, 'timed-out'); assert.equal(f.resources().terminated, true); const count = f.states.length; await wait(30); assert.equal(f.states.length, count) } finally { stop() }
})
test('worker error disables only optional analysis', async () => {
  const f = fixture('error'), stop = f.start(); await wait(20)
  try { assert.equal(f.states.at(-1)?.status, 'failed'); assert.equal(f.resources().closed, true) } finally { stop() }
})
test('extractor-reported timeout stops polling rather than retrying indefinitely', async () => {
  const f = fixture('extractor-timeout'), stop = f.start(5); await wait(40)
  try { assert.equal(f.states.at(-1)?.status, 'timed-out'); assert.equal(f.resources().terminated, true); const count = f.states.length; await wait(30); assert.equal(f.states.length, count) } finally { stop() }
})
test('disable while audio startup is pending prevents future observations', async () => {
  const f = fixture(), stop = f.start(); stop(); const count = f.states.length
  await wait(50); assert.equal(f.states.length, count); assert.equal(f.resources().closed, true)
})
test('evidence expiration removes the observation without waiting for another frame', async () => {
  const f = fixture(), stop = f.start(10000)
  try { await wait(PHONATION_FRESHNESS_MS + 50); assert.equal(f.states.at(-1)?.status, 'timed-out'); assert.equal(f.states.at(-1)?.observation, null) } finally { stop() }
})
test('reference requires repeated pitch-matched evidence and accounts for variability', () => {
  const sample = { pitch: 180, periodicity: .95, flatness: .01, slope: -8 }
  let reference: Reference = { samples: [sample] }
  assert.match(compareToReference(reference, sample), /Building/)
  assert.equal(addReferenceSample(reference, { ...sample, pitch: 360 }).samples.length, 1)
  for (let i = 0; i < 4; i++) reference = addReferenceSample(reference, sample)
  assert.match(compareToReference(reference, sample), /within your reference variation/)
  assert.match(compareToReference(reference, { ...sample, pitch: 360 }), /Match the reference pitch/)
  assert.match(compareToReference(reference, { ...sample, periodicity: .88 }), /less periodic/)
  const established = { ...reference, processingKey: 'AGC-off' }
  assert.equal(referenceForProcessing(established, 'AGC-off'), established)
  assert.deepEqual(referenceForProcessing(established, 'AGC-on').samples, [])
})
