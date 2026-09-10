import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { chooseRecordingMime, describeTrack, finishRecording, recordingTracks } from '../../lib/recording'
import type { Ref } from 'react'
import type { FinishedRecording, RecordingManifest } from '../../lib/recording'
import './RecordingControls.css'
import { RecordedPitch } from './RecordedPitch'

export interface RecordingController { start: () => void; stop: () => Promise<FinishedRecording> }
interface Props {
  controllerRef?: Ref<RecordingController>
  videoStream?: MediaStream | null
  audioStream?: MediaStream | null
  profileId?: string
  onRecording?: (recording: FinishedRecording) => void
  transformRecording?: (recording: FinishedRecording) => FinishedRecording
}
interface ActiveRecording { recorder: MediaRecorder; cancel: () => void; stop: (reason: RecordingManifest['stopReason']) => void }

export function RecordingControls({ videoStream, audioStream, profileId = 'local-participant', onRecording, controllerRef, transformRecording }: Props) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'saving'>('idle')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [result, setResult] = useState<FinishedRecording | null>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [manifestUrl, setManifestUrl] = useState('')
  const [replay, setReplay] = useState(false)
  const pending = useRef<{resolve:(value:FinishedRecording)=>void;reject:(error:Error)=>void}|null>(null)
  const lastResult=useRef<FinishedRecording|null>(null)
  const active = useRef<ActiveRecording | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.cancel() } }, [])
  const urls = useRef<string[]>([])
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)) }, [])

  const start = () => {
    if (active.current || status !== 'idle') return false
    setError('')
    if (typeof MediaRecorder === 'undefined') { setError('Recording is unavailable in this browser.'); return false }
    const sourceTracks = recordingTracks(videoStream, audioStream)
    if (!sourceTracks.length) { setError('Start the camera or microphone first.'); return false }
    // Clones let cleanup release only recorder-owned tracks, preserving live analysis.
    const clones = sourceTracks.map(track => track.clone())
    const stream = new MediaStream(clones)
    let recorder: MediaRecorder
    try {
      const mimeType = chooseRecordingMime(clones.some(track => track.kind === 'video'))
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (cause) { clones.forEach(track => track.stop()); setError(String(cause)); return false }
    const started = performance.now()
    const startedAt = new Date().toISOString()
    const tracks = sourceTracks.map(describeTrack)
    const chunks: Blob[] = []
    const chunkEvents: RecordingManifest['chunkEvents'] = []
    const interruptions: string[] = []
    let reason: RecordingManifest['stopReason'] = 'user'
    let cancelled = false
    let observedStop = started
    let stoppedAt = startedAt
    let byteLength = 0
    const stop = (nextReason: RecordingManifest['stopReason']) => {
      if (recorder.state === 'inactive') return
      reason = nextReason
      observedStop = performance.now()
      stoppedAt = new Date().toISOString()
      if (mounted.current) setStatus('saving')
      recorder.stop()
    }
    const ended = () => { interruptions.push('A source track ended; capture stopped.'); stop('track-ended') }
    sourceTracks.forEach(track => track.addEventListener('ended', ended))
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((performance.now() - started) / 1000))
      if (sourceTracks.some(track => track.readyState === 'ended')) ended()
      if (performance.now() - started >= 10 * 60_000) stop('limit')
    }, 250)
    const cleanup = () => {
      window.clearInterval(timer)
      sourceTracks.forEach(track => track.removeEventListener('ended', ended))
      clones.forEach(track => track.stop())
      active.current = null
    }
    recorder.ondataavailable = event => {
      if (!event.data.size) return
      chunks.push(event.data)
      byteLength += event.data.size
      chunkEvents.push({ observedAtMs: performance.now() - started, byteLength: event.data.size })
      if (byteLength > 256 * 1024 * 1024) stop('limit')
    }
    recorder.onerror = () => { interruptions.push('MediaRecorder reported an error.'); stop('error') }
    recorder.onstop = async () => {
      // Some browser errors stop the recorder before our stop handler runs.
      if (observedStop === started) { observedStop = performance.now(); stoppedAt = new Date().toISOString() }
      cleanup()
      if (cancelled || !mounted.current) return
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || '' })
        if (!blob.size) throw new Error('The browser returned an empty recording. Please try again.')
        const raw = await finishRecording(blob, {
          id: `recording-${crypto.randomUUID()}`, profileId, startedAt, stoppedAt,
          observedDurationMs: observedStop - started, stopReason: reason, tracks, chunkEvents,
          timing: { clock: 'performance.now', sourcePresentationTimestamps: null, syncUncertaintyMs: null, notes: 'Start/stop and chunk delivery times are observed browser times, not sensor presentation timestamps. Audio/video clock offset and drift have not been measured.' },
          quality: { actualDepth: false, cameraCalibration: null, droppedFrames: null, interruptions },
        })
        const finished=transformRecording?.(raw)??raw
        if (!mounted.current) return
        urls.current.forEach(url => URL.revokeObjectURL(url))
        const media = URL.createObjectURL(finished.blob)
        const manifest = URL.createObjectURL(new Blob([JSON.stringify(finished.manifest, null, 2)], { type: 'application/json' }))
        urls.current = [media, manifest]
        setMediaUrl(media)
        setManifestUrl(manifest)
        setResult(finished)
        if (reason !== 'user') setError(reason === 'limit' ? 'Recording stopped at the 10-minute / 256 MB limit.' : 'Source interrupted. Saved the captured portion.')
        lastResult.current=finished
        onRecording?.(finished)
        pending.current?.resolve(finished);pending.current=null
      } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));pending.current?.reject(cause instanceof Error?cause:new Error(String(cause)));pending.current=null }
      finally { if (mounted.current) setStatus('idle') }
    }
    active.current = { recorder, stop, cancel: () => { cancelled = true; stop('user'); cleanup() } }
    try { recorder.start(1000); setSeconds(0); setStatus('recording'); setReplay(false) }
    catch (cause) { cleanup(); setError(String(cause)); setStatus('idle');return false }
    return true
  }

  useImperativeHandle(controllerRef,()=>({
    start(){if(!start())throw new Error('Recording could not start. Check camera/microphone access.');lastResult.current=null},
    stop(){if(!active.current)return lastResult.current?Promise.resolve(lastResult.current):Promise.reject(new Error('No recording is active'));return new Promise<FinishedRecording>((resolve,reject)=>{pending.current={resolve,reject};active.current!.stop('user')})},
  }))
  return <div className="recording-controls">
    <button type="button" className={status === 'recording' ? 'recording-active' : ''} disabled={status === 'saving'} onClick={() => status === 'recording' ? active.current?.stop('user') : start()} title="Records available camera and microphone locally. Recording is off until you press Start.">
      {status === 'recording' ? `■ Stop ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : status === 'saving' ? 'Saving…' : '● Start recording'}
    </button>
    {result && <button type="button" onClick={() => setReplay(true)}>Last recording</button>}
    {error && <span className="recording-error" role="status">{error}</span>}
    {replay && result && <div className="recording-backdrop" onClick={() => setReplay(false)}>
      <section className="recording-dialog" role="dialog" aria-modal="true" aria-label="Last recording" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setReplay(false) }}>
        <div className="recording-dialog-heading"><strong>Last recording</strong><button autoFocus type="button" onClick={() => setReplay(false)}>Close</button></div>
        {result.manifest.tracks.some(track => track.kind === 'video') ? <video src={mediaUrl} controls playsInline /> : <audio src={mediaUrl} controls />}
        <p>{Math.round(result.manifest.observedDurationMs / 1000)} seconds · {(result.blob.size / 1024 / 1024).toFixed(1)} MB · Stored in this tab until replaced or closed.</p>
        <div className="recording-downloads"><a href={mediaUrl} download={result.filename}>Download recording</a><a href={manifestUrl} download={`${result.manifest.id}.json`}>Download manifest</a></div>
        <RecordedPitch key={result.manifest.id} recording={result} />
        <p className="recording-note">Browser audio/video capture. Sensor timestamps, measured depth and camera calibration are unavailable; synchronization uncertainty is unknown. Keep both downloads together for replay and analysis.</p>
      </section>
    </div>}
  </div>
}
