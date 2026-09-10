import { analyzeAudioFrame, audioFrameSize } from '../lib/audio.ts';
import type { PhonationMetadata, PhonationObservation, CapabilityStatus } from './types.ts';

export const PHONATION_EXTRACTOR_VERSION = 'canonical-yin-flatness-harmonic-slope-1.0.0';
export const PHONATION_CONFIGURATION_VERSION = 'phonation-window-policy-1.0.0';
const MISSING = 'Measurement unavailable';
/** Fixed finite frame, no contact/closure estimator. Invoke outside capture/render path. */
export async function measurePhonation(pcm: Float32Array, sampleRate: number, metadata: PhonationMetadata,
 options: { enabled?: boolean; deadlineMs?: number; signal?: AbortSignal } = {}): Promise<PhonationObservation> {
 pcm = pcm.slice(); // Snapshot caller buffer before the asynchronous hash operation.
 const beginning = performance.now(), deadline = options.deadlineMs ?? 200;
 if (!Number.isFinite(deadline) || deadline <= 0 || deadline > 2000) throw Error('Deadline must be within0..2000ms');
 for (const key of ['observationId','sessionId','attemptId','artifactId','clockId'] as const) if (typeof metadata[key] !== 'string' || !metadata[key].trim()) throw Error('Explicit phonation identity/clock required');
 if (!Number.isFinite(Date.parse(metadata.evidenceAt)) || !Number.isSafeInteger(metadata.windowStartSample) || metadata.windowStartSample < 0) throw Error('Invalid evidence time/window offset');
 if (!Array.isArray(metadata.sourceHashes) || metadata.sourceHashes.some(h => !/^[a-f0-9]{64}$/.test(h))) throw Error('Invalid original source SHA256');
 if (!['human-observation','engine-generated','development-fixture'].includes(metadata.sourceKind)) throw Error('Explicit source kind required');
 if (metadata.syncUncertaintyMs !== null && (!Number.isFinite(metadata.syncUncertaintyMs) || metadata.syncUncertaintyMs < 0)) throw Error('Explicit nonnegative or unknown clock uncertainty required');
 if (!metadata.processing || !['automaticGainControl','noiseSuppression','echoCancellation'].every(k => [true,false,null].includes(metadata.processing[k as keyof PhonationMetadata['processing']]))) throw Error('Explicit processing metadata required');
 const capability = (status: CapabilityStatus, reason: string | null) => ({ status, reason, evidenceAt: metadata.evidenceAt });
 const descriptor = (unit: string) => ({ value: null as number | null, unit, reason: MISSING as string | null });
 const result: PhonationObservation = { ...metadata, schemaVersion:'phonation-observation-1.0.0',extractorVersion:PHONATION_EXTRACTOR_VERSION,configurationVersion:PHONATION_CONFIGURATION_VERSION,
  sourceHashes:[...metadata.sourceHashes],processing:{...metadata.processing},frameSha256:null,hashScope:'little-endian-float32-frame-bytes',
  window:{sampleRateHz:sampleRate,startSample:metadata.windowStartSample,sampleCount:pcm.length,clockId:metadata.clockId,syncUncertaintyMs:metadata.syncUncertaintyMs},
  capabilities:{measurement:capability('failed',MISSING),sourceInference:capability('unsupported','Acoustic descriptors do not identify fold closure'),coaching:capability('disabled','Consumer must establish compatible reference and freshness')},
  descriptors:{pitchHz:descriptor('Hz'),periodicity:descriptor('1'),spectralFlatness:descriptor('1'),harmonicSpectralSlopeDbOctave:descriptor('dB/octave')},qualityFlags:[],
  limitations:['Recorded acoustic descriptors include vocal tract, microphone and room effects.','YIN periodicity is not harmonic energy fraction or calibrated HNR.','Harmonic slope is not glottal spectral tilt; no formant or radiation correction.','No vocal-fold contact, closure, pressure or pathology diagnosis.'] };
 function unavailable(status: CapabilityStatus, reason: string) { result.capabilities.measurement=capability(status,reason); for (const d of Object.values(result.descriptors)) { d.value=null;d.reason=reason } return result }
 const expired = () => options.signal?.aborted || performance.now()-beginning>deadline;
 if (options.enabled===false) return unavailable('disabled','Phonation measurement disabled');
 if (![44100,48000,96000].includes(sampleRate) || pcm.length!==audioFrameSize(sampleRate)) return unavailable('unsupported','Requires canonical44100/48000/96000Hz frame4096/4096/8192');
 if (!pcm.every(Number.isFinite)) return unavailable('failed','Nonfinite PCM input');
 try {
  const bytes=new Uint8Array(pcm.length*4),view=new DataView(bytes.buffer);pcm.forEach((v,i)=>view.setFloat32(i*4,v,true));
  result.frameSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(expired())return unavailable('timed-out',options.signal?.aborted?'Analysis cancelled':'Analysis deadline exceeded');
  if(pcm.some(v=>Math.abs(v)>=.995)){result.qualityFlags.push('clipping');return unavailable('insufficient-quality','Clipped PCM frame')}
  const metrics=analyzeAudioFrame(pcm,sampleRate);
  if(expired())return unavailable('timed-out','Analysis deadline exceeded');
  if(metrics.dbfs < -60)return unavailable('insufficient-quality','Signal below declared-60dBFS analysis floor');
  const assign=(key:keyof typeof result.descriptors,value:number)=>{result.descriptors[key].value=value;result.descriptors[key].reason=null};
  if(metrics.pitchHz===null || metrics.periodicity===null || metrics.periodicity<.85)return unavailable('insufficient-quality','No stable periodic voice candidate; noise/irregularity unresolved');
  if(metrics.pitchHz>800)return unavailable('insufficient-quality','Pitch above800Hz phonation comparison support');
  assign('pitchHz',metrics.pitchHz);assign('periodicity',metrics.periodicity);
  if(metrics.flatness!==null)assign('spectralFlatness',metrics.flatness);
  // Probe raw Blackman-windowed harmonic amplitudes, with the same fixed frame for either source kind.
  const f0=metrics.pitchHz, harmonics=Math.min(12,Math.floor(4000/f0));
  const points:{x:number;y:number}[]=[];let mean=0;for(const value of pcm)mean+=value;mean/=pcm.length;
  for(let h=1;h<=harmonics;h++){
   if(expired())return unavailable('timed-out','Analysis deadline exceeded');
   let re=0,im=0;
   for(let n=0;n<pcm.length;n++){
    const window=.42-.5*Math.cos(2*Math.PI*n/(pcm.length-1))+.08*Math.cos(4*Math.PI*n/(pcm.length-1));
    const value=(pcm[n]-mean)*window,phase=2*Math.PI*h*f0*n/sampleRate;
    re+=value*Math.cos(phase);im-=value*Math.sin(phase);
   }
   const amplitude=2*Math.hypot(re,im)/pcm.length;
   points.push({x:Math.log2(h*f0),y:20*Math.log10(Math.max(amplitude,1e-15))});
  }
  const peak=Math.max(...points.map(p=>p.y)),retained=points.filter(p=>p.y>=peak-40);
  if(retained.length>=4){
   const mx=retained.reduce((s,p)=>s+p.x,0)/retained.length,my=retained.reduce((s,p)=>s+p.y,0)/retained.length;
   assign('harmonicSpectralSlopeDbOctave',retained.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/retained.reduce((s,p)=>s+(p.x-mx)**2,0));
  }else result.descriptors.harmonicSpectralSlopeDbOctave.reason='Fewer than four harmonic amplitudes within40dB of strongest harmonic';
  if(expired())return unavailable('timed-out','Analysis deadline exceeded');
  if(Object.values(metadata.processing).some(v=>v!==false))result.qualityFlags.push('processing-present-or-unknown');
  result.capabilities.measurement=capability('available',null);return result;
 }catch(error){return unavailable('failed',error instanceof Error?error.message:'Extraction failed')}
}
