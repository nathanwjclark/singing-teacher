import { audioFrameSize, analyzeAudioFrame, serializeAudioMeasurement } from './audio.ts';
import { AmbientCalibrator } from './audioCalibration.ts';
import type { AudioMeasurement } from '../contracts';
import type { FinishedRecording } from './recording';

export const RECORDING_AUDIO_HOP_MS = 100;
/** Deterministic windowing shared by recording extraction and the tone regression. */
export function* recordingAudioWindows(channel: Float32Array, sampleRate: number) {
  const size = audioFrameSize(sampleRate);
  const hop = Math.round(sampleRate * RECORDING_AUDIO_HOP_MS / 1000);
  for (let start = 0; start + size <= channel.length; start += hop) {
    yield { startMs: start / sampleRate * 1000, waveform: channel.slice(start, start + size) };
  }
}
const pending = new WeakMap<Blob, Promise<AudioMeasurement[]>>();
/** Analyze saved bytes at 10 Hz, not unrelated preview samples or one snapshot per second.
 * Share extraction between the dashboard and recording replay; retain no extra raw audio.
 */
export function measureRecording(recording: FinishedRecording): Promise<AudioMeasurement[]> {
  const cached = pending.get(recording.blob);
  if (cached) return cached;
  const result = decodeRecording(recording);
  pending.set(recording.blob, result);
  void result.catch(() => pending.delete(recording.blob));
  return result;
}
async function decodeRecording(recording: FinishedRecording): Promise<AudioMeasurement[]> {
  if (!recording.manifest.tracks.some(track => track.kind === 'audio')) return [];
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await recording.blob.arrayBuffer());
    // A stereo interface may put the mic only on channel 2. Select the highest-energy
    // channel rather than silently analyzing channel 1 or cancelling opposite phases.
    let channelIndex = 0, bestEnergy = -1;
    for (let index = 0; index < buffer.numberOfChannels; index++) {
      const pcm = buffer.getChannelData(index);
      let energy = 0;
      for (let i = 0; i < pcm.length; i += 8) energy += pcm[i] ** 2;
      if (energy > bestEnergy) { bestEnergy = energy; channelIndex = index; }
    }
    const channel = buffer.getChannelData(channelIndex), measurements: AudioMeasurement[] = [];
    const artifact = recording.observationBundle.artifacts[0];
    const calibrator = new AmbientCalibrator();
    for (const { startMs, waveform } of recordingAudioWindows(channel, buffer.sampleRate)) {
      const metrics = analyzeAudioFrame(waveform, buffer.sampleRate);
      const calibration = calibrator.update(metrics, waveform, startMs);
      measurements.push(serializeAudioMeasurement(metrics, waveform.length, buffer.sampleRate, {
        id: `${recording.manifest.id}-audio-${measurements.length}`, observationId: recording.observationBundle.id, artifactId: artifact.id,
        startMs, sourceKind: 'human-observation', sourceHashes: [artifact.sha256], calibration,
        timebase: { clockId: `${recording.manifest.id}-decoded`, origin: 'session-start', unit: 'ms', syncUncertaintyMs: null, referenceClockId: null, offsetToReferenceMs: null },
        qualityFlags: ['decoded-container', 'source-sensor-timestamps-unavailable', `analyzed-channel-${channelIndex + 1}`, 'ambient-estimated-from-recording'],
      }));
      // Long captures should not freeze the graph or stop button while extracting.
      if (measurements.length % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return measurements;
  } finally { await context.close(); }
}
