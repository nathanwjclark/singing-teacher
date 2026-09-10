import type { PhonationMetadata, PhonationObservation, CapabilityStatus } from './types.ts'

export const PHONATION_FRESHNESS_MS = 1500
export type LivePhonationState = { status: CapabilityStatus; reason: string | null; evidenceAt: string; observation: PhonationObservation | null }
type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
type RuntimeOptions = { createWorker?: () => WorkerLike; createContext?: () => AudioContext; intervalMs?: number; deadlineMs?: number }

/** Owns only the optional analysis graph: the caller continues to own every media track. */
export function startPhonationMonitor(stream: MediaStream, emit: (state: LivePhonationState) => void, options: RuntimeOptions = {}): () => void {
  let stopped = false, worker: WorkerLike | null = null, context: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null, analyser: AnalyserNode | null = null
  let poll: ReturnType<typeof setInterval> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined
  let pending: { id: string; evidenceAt: string } | null = null
  const track = stream.getAudioTracks()[0]
  const sessionId = crypto.randomUUID(), clockId = `live-audio-${sessionId}`
  const publish = (status: CapabilityStatus, reason: string | null, observation: PhonationObservation | null = null, evidenceAt = new Date().toISOString()) => {
    if (!stopped) emit({ status, reason, observation, evidenceAt })
  }
  const clear = () => {
    clearInterval(poll); clearTimeout(deadline); clearTimeout(expiry)
    worker?.terminate(); worker = null
    source?.disconnect(); analyser?.disconnect()
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    track?.removeEventListener('ended', ended); track?.removeEventListener('mute', muted)
    if (context) context.onstatechange = null
  }
  const stop = () => { if (!stopped) { stopped = true; clear() } }
  const fail = (status: CapabilityStatus, reason: string) => { publish(status, reason); stop() }
  const ended = () => fail('unsupported', 'Microphone stream ended. Existing app features remain available.')
  const muted = () => { clearTimeout(expiry); publish('insufficient-quality', 'Microphone is muted; tone comparisons are suspended.') }
  if (!track || track.readyState !== 'live') { publish('unsupported', 'Start the app microphone to use optional acoustic feedback.'); return stop }
  publish('insufficient-quality', 'Waiting for a comfortable sustained vowel.')
  try {
    context = options.createContext ? options.createContext() : new AudioContext()
    if (![44100, 48000, 96000].includes(context.sampleRate)) { fail('unsupported', 'This microphone sample rate is not supported by the phonation extractor.'); return stop }
    worker = options.createWorker ? options.createWorker() : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    source = context.createMediaStreamSource(stream)
    analyser = context.createAnalyser()
    analyser.fftSize = context.sampleRate === 96000 ? 8192 : 4096
    source.connect(analyser)
    track.addEventListener('ended', ended); track.addEventListener('mute', muted)
    context.onstatechange = () => { if (context?.state !== 'running') muted() }
    worker.onerror = () => fail('failed', 'Optional analysis failed. Toggle it off and on to retry.')
    worker.onmessage = (event: MessageEvent) => {
      if (stopped || event.data?.id !== pending?.id) return
      clearTimeout(deadline)
      const evidenceAt = pending!.evidenceAt
      pending = null
      if (event.data.error) { fail('failed', 'Optional analysis failed. Toggle it off and on to retry.'); return }
      const observation = event.data.observation as PhonationObservation | undefined
      if (!observation || observation.schemaVersion !== 'phonation-observation-1.0.0' || !observation.capabilities?.measurement) { fail('failed', 'Optional analysis returned an invalid observation.'); return }
      if (track.muted || track.readyState !== 'live' || context?.state !== 'running') { muted(); return }
      const remaining = PHONATION_FRESHNESS_MS - (Date.now() - Date.parse(evidenceAt))
      if (remaining <= 0) { publish('timed-out', 'Acoustic evidence expired; tone comparisons are suspended.'); return }
      clearTimeout(expiry)
      const measurement = observation.capabilities.measurement
      if (measurement.status === 'failed' || measurement.status === 'timed-out' || measurement.status === 'unsupported') {
        fail(measurement.status, `${measurement.reason ?? 'Optional measurement unavailable.'} Reset analysis to retry.`)
        return
      }
      publish(measurement.status, measurement.reason, observation, evidenceAt)
      expiry = setTimeout(() => publish('timed-out', 'Acoustic evidence expired; tone comparisons are suspended.', null, evidenceAt), remaining)
    }
    const capture = () => {
      if (stopped || pending || !context || !analyser || !worker) return
      if (track.readyState !== 'live') { ended(); return }
      if (track.muted || context.state !== 'running') { muted(); return }
      const pcm = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(pcm)
      const evidenceAt = new Date().toISOString(), id = crypto.randomUUID(), settings = track.getSettings()
      const metadata: PhonationMetadata = { observationId: id, sessionId, attemptId: sessionId, artifactId: `live-frame-${id}`, sourceHashes: [], evidenceAt,
        windowStartSample: Math.max(0, Math.round(context.currentTime * context.sampleRate) - pcm.length), clockId, syncUncertaintyMs: null,
        sourceKind: 'human-observation', processing: { automaticGainControl: settings.autoGainControl ?? null, noiseSuppression: settings.noiseSuppression ?? null, echoCancellation: typeof settings.echoCancellation === 'boolean' ? settings.echoCancellation : null } }
      pending = { id, evidenceAt }
      deadline = setTimeout(() => fail('timed-out', 'Optional analysis exceeded its deadline. Toggle it off and on to retry.'), options.deadlineMs ?? 1000)
      try { worker.postMessage({ id, pcm, sampleRate: context.sampleRate, metadata }, [pcm.buffer]) }
      catch { fail('failed', 'Optional analysis could not start. Toggle it off and on to retry.') }
    }
    // Copy one bounded frame; DSP runs in the worker and never in a React render.
    poll = setInterval(capture, options.intervalMs ?? 750)
    void context.resume().then(() => { if (!stopped) capture() }).catch(() => fail('unsupported', 'Audio analysis could not start. Enable the microphone and retry.'))
  } catch { fail('unsupported', 'Optional audio analysis is unavailable in this browser.') }
  return stop
}
