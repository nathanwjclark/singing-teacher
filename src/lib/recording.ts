import { CONTRACT_VERSION, assertRecord, sha256 } from '../contracts'
import type { ObservationBundle, ObservationStream } from '../contracts'

export interface RecordingTrack {
  kind: string
  label: string
  settings: Record<string, string | number | boolean>
}
export interface RecordingManifest {
  schema: 'singing-teacher/browser-recording/1'
  id: string
  profileId: string
  startedAt: string
  stoppedAt: string
  observedDurationMs: number
  stopReason: 'user' | 'track-ended' | 'error' | 'limit'
  tracks: RecordingTrack[]
  chunkEvents: { observedAtMs: number; byteLength: number }[]
  timing: { clock: 'performance.now'; sourcePresentationTimestamps: null; syncUncertaintyMs: null; notes: string }
  quality: { actualDepth: false; cameraCalibration: null; droppedFrames: null; interruptions: string[] }
  observation: ObservationBundle
}
export interface FinishedRecording { blob: Blob; filename: string; manifest: RecordingManifest; observationBundle: ObservationBundle }
export function chooseRecordingMime(hasVideo: boolean): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const choices = hasVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
  return choices.find(type => MediaRecorder.isTypeSupported(type))
}
export function recordingTracks(video?: MediaStream | null, audio?: MediaStream | null): MediaStreamTrack[] {
  const videoTracks = video?.getVideoTracks() ?? []
  const audioTracks = audio?.getAudioTracks().length ? audio.getAudioTracks() : video?.getAudioTracks() ?? []
  return [...videoTracks.slice(0, 1), ...audioTracks.slice(0, 1)].filter(track => track.readyState === 'live')
}
export function describeTrack(track: MediaStreamTrack): RecordingTrack {
  // Device/group IDs are unnecessary in a shareable manifest.
  const settings = Object.fromEntries(Object.entries(track.getSettings()).filter(([key, value]) =>
    !['deviceId', 'groupId'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)))
  return { kind: track.kind, label: track.label, settings }
}
export async function finishRecording(blob: Blob, metadata: Omit<RecordingManifest, 'schema' | 'observation'>): Promise<FinishedRecording> {
  const extension = blob.type.includes('mp4') ? (metadata.tracks.some(track => track.kind === 'video') ? 'mp4' : 'm4a') : 'webm'
  const filename = `${metadata.id}.${extension}`
  const digest = await sha256(new Uint8Array(await blob.arrayBuffer()))
  const artifactId = `${metadata.id}-media`
  const streams: ObservationStream[] = (['audio', 'rgb', 'depth'] as const).map(modality => {
    const track = metadata.tracks.find(item => item.kind === (modality === 'rgb' ? 'video' : modality))
    return {
      modality,
      timebase: { clockId: `${metadata.id}-${modality}-source-unknown`, origin: 'session-start', unit: 'ms', syncUncertaintyMs: null, referenceClockId: null, offsetToReferenceMs: null },
      // The muxed recording is real, but these raw sample timestamps are not exposed by MediaRecorder.
      samples: [], missingReason: modality === 'depth' ? 'not-supported' : 'not-captured', droppedSamples: 0,
      settings: { ...track?.settings, containerRecorded: Boolean(track), rawSampleIndexAvailable: false, droppedSampleCountKnown: false },
      calibration: { artifactId: null, missingReason: 'not-calibrated' }, depth: null,
    }
  })
  const observation: ObservationBundle = {
    schemaVersion: CONTRACT_VERSION, kind: 'observation', id: metadata.id, createdAt: metadata.startedAt,
    provenance: { kind: 'human-observation', producer: 'browser-media-recorder', producerVersion: '1', sourceIds: [], sourceHashes: [] },
    participantId: metadata.profileId, sessionId: metadata.id, trialId: metadata.id, predictionId: null,
    consentScope: ['explicit-local-recording', 'user-controlled-export'], task: 'User-started singing capture; muxed media with unindexed source timestamps',
    streams, artifacts: [{ id: artifactId, uri: filename, sha256: digest, mediaType: blob.type || 'application/octet-stream', byteLength: blob.size }],
  }
  assertRecord(observation)
  return { blob, filename, observationBundle: observation, manifest: { schema: 'singing-teacher/browser-recording/1', ...metadata, observation } }
}
