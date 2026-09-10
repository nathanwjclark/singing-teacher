import { extractAudioMeasurement } from './audio';
import type { AudioMeasurement } from '../contracts';
import type { FinishedRecording } from './recording';

/** Analyze the saved bytes, not unrelated live preview samples. */
export async function measureRecording(recording:FinishedRecording):Promise<AudioMeasurement[]> {
  if(!recording.manifest.tracks.some(track=>track.kind==='audio'))return [];
  const context=new AudioContext();
  try {
    const buffer=await context.decodeAudioData(await recording.blob.arrayBuffer());
    const channel=buffer.getChannelData(0),size=4096,measurements:AudioMeasurement[]=[];
    const artifact=recording.observationBundle.artifacts[0];
    // Up to one window per second, with a bounded metadata footprint.
    for(let start=0;start+size<=channel.length&&measurements.length<600;start+=Math.max(size,Math.round(buffer.sampleRate))) {
      measurements.push(extractAudioMeasurement(channel.slice(start,start+size),buffer.sampleRate,{
        id:`${recording.manifest.id}-audio-${start}`,observationId:recording.observationBundle.id,artifactId:artifact.id,
        startMs:start/buffer.sampleRate*1000,sourceKind:'human-observation',sourceHashes:[artifact.sha256],
        timebase:{clockId:`${recording.manifest.id}-decoded`,origin:'session-start',unit:'ms',syncUncertaintyMs:null,referenceClockId:null,offsetToReferenceMs:null},
        qualityFlags:['decoded-container','source-sensor-timestamps-unavailable','ambient-calibration-not-applied'],
      }));
    }
    return measurements;
  } finally {await context.close()}
}
