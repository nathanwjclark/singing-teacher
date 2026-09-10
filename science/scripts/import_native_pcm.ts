/** Verified native LPCM chunks -> canonical KIT audio, preserving clock uncertainty. */
import {constants} from 'node:fs';
import {open,realpath,mkdir,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {importNativeCapture} from '../../scripts/import-native-capture.ts';
import {audioFrameSize,extractAudioMeasurement} from '../../src/lib/audio.ts';
import {validateRecord} from '../../src/contracts/index.ts';
import type {Artifact,AudioMeasurement,ObservationBundle} from '../../src/contracts/index.ts';

type Row=Record<string,any>;
const AUDIO_LIMIT=64*1024*1024,WINDOW_LIMIT=1000;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const integer=(value:unknown,label:string)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error(`Invalid ${label}`);return value};
function timestamp(value:Row,label:string){
 if(!value||typeof value!=='object')throw Error(`Missing ${label}`);
 const n=integer(value.value,label),scale=integer(value.timescale,label),epoch=integer(value.epoch,label),flags=integer(value.flags,label);
 if(!scale||!(flags&1)||(flags&28)||typeof value.seconds!=='number'||!Number.isFinite(value.seconds)||Math.abs(n/scale-value.seconds)>1e-6)throw Error(`Invalid ${label}`);
 return {seconds:n/scale,epoch};
}
export function decodeLpcm(bytes:Buffer,format:Row,count:number){
 const rate=integer(format.sample_rate,'sample rate'),flags=integer(format.format_flags,'format flags');
 const channels=integer(format.channels_per_frame,'channel count'),bits=integer(format.bits_per_channel,'bits/channel');
 const width=bits/8;
 if(![44100,48000,96000].includes(rate)||!channels||channels>8||format.format_id!==1819304813||
    !((bits===32&&(flags===1||flags===9))||(bits===16&&(flags===4||flags===12)))||
    format.bytes_per_frame!==channels*width||format.frames_per_packet!==1||format.bytes_per_packet!==channels*width||
    !Number.isSafeInteger(count)||count<=0||bytes.length!==count*channels*width)throw Error('Unsupported or inconsistent interleaved little-endian float32/PCM16 ASBD');
 const output=Array.from({length:channels},()=>new Float32Array(count));
 for(let i=0;i<count;i++)for(let channel=0;channel<channels;channel++){
  const at=(i*channels+channel)*width,value=bits===32?bytes.readFloatLE(at):bytes.readInt16LE(at)/32768;
  if(!Number.isFinite(value))throw Error('Nonfinite native PCM');
  output[channel][i]=value;
 }
 return {rate,channels:output};
}

/** Output is new and private. Source directory is never modified. */
export async function importNativePcm(directory:string,outputDirectory:string,options:{participantId:string;sessionId:string;pose?:string;evidenceKind?:'human-observation'|'development-fixture'}){
 if(options.pose!==undefined&&(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(options.pose)))throw Error('Pose must be an explicit native pose name');
 const evidenceKind=options.evidenceKind??'human-observation';
 if(!['human-observation','development-fixture'].includes(evidenceKind))throw Error('Unsupported declared evidence kind');
 const native=await importNativeCapture(directory,options.participantId,options.sessionId);
 native.records[0].provenance.kind=evidenceKind;
 const observation=native.records[0],audio=observation.streams.find(s=>s.modality==='audio')!;
 const root=await realpath(directory),artifacts=new Map(observation.artifacts.map(a=>[a.uri,a]));
 let readBytes=0;
 async function verified(name:string){
  const expected=artifacts.get(name);
  if(!expected||basename(name)!==name)throw Error('Unverified native artifact');
  const handle=await open(resolve(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==expected.byteLength||readBytes+stat.size>AUDIO_LIMIT)throw Error('Native audio input exceeds 64 MB or changed size');const bytes=await handle.readFile();if(bytes.length!==expected.byteLength||hash(bytes)!==expected.sha256)throw Error('Native artifact changed after validation');readBytes+=bytes.length;return bytes}finally{await handle.close()}
 }
 const manifestArtifact=artifacts.get('manifest.json')!,manifest=JSON.parse((await verified('manifest.json')).toString());
 if(!Array.isArray(manifest.audio.samples)||manifest.audio.samples.length>10000)throw Error('Native audio sample list exceeds limit');
 type Chunk={channels:Float32Array[];start:number;count:number;rate:number;epoch:number;signature:string;artifact:Artifact;index:number;sourceOffset:number};
 type Segment={chunks:Chunk[];count:number;rate:number;start:number;epoch:number;signature:string};
 const segments:Segment[]=[],cuts:Row[]=[];
 let current:Segment|null=null,previousEnd:number|null=null,previousEpoch:number|null=null;
 const flush=()=>{if(current){segments.push(current);current=null}};
 for(let index=0;index<manifest.audio.samples.length;index++){
  const row=manifest.audio.samples[index];
  if(!row.artifact){flush();cuts.push({sample_index:index,reason:row.missing_reason??'missing-native-chunk'});previousEnd=null;previousEpoch=null;continue}
  const decoded=decodeLpcm(await verified(row.artifact.path),row.asbd,integer(row.num_samples,'sample count'));
  const start=timestamp(row.presentation_timestamp,'presentation timestamp'),duration=timestamp(row.duration,'audio duration');
  const expectedDuration=row.num_samples/decoded.rate,tolerance=.25/decoded.rate;
  if(Math.abs(duration.seconds-expectedDuration)>tolerance)throw Error('Duration does not match PCM sample count');
  if(row.gap_before_seconds!==undefined&&row.gap_before_seconds!==null&&
     (typeof row.gap_before_seconds!=='number'||!Number.isFinite(row.gap_before_seconds)))throw Error('Invalid declared gap');
  if(previousEnd!==null){
   const gap=start.seconds-previousEnd;
   if(start.epoch!==previousEpoch)throw Error('Native audio epoch changed');
   if(gap < -tolerance)throw Error('Overlapping native audio chunks');
   if(row.gap_before_seconds!==undefined&&row.gap_before_seconds!==null&&Math.abs(row.gap_before_seconds-gap)>tolerance)throw Error('Declared audio gap disagrees with timestamps');
   if(gap>tolerance){flush();cuts.push({sample_index:index,reason:'timestamp-gap',gap_seconds:gap})}
  }
  previousEnd=start.seconds+expectedDuration;previousEpoch=start.epoch;
  const signature=JSON.stringify(Object.keys(row.asbd).sort().map(key=>[key,row.asbd[key]]));
  if(current&&(current.signature!==signature||current.epoch!==start.epoch)){flush();cuts.push({sample_index:index,reason:'format-change'})}
  if(current&&Math.abs(start.seconds-(current.start+current.count/current.rate))>tolerance){
   cuts.push({sample_index:index,reason:'cumulative-timestamp-deviation',deviation_seconds:start.seconds-(current.start+current.count/current.rate)});flush();
  }
  const artifact=artifacts.get(row.artifact.path)!;
  let offset=0;
  while(offset<row.num_samples){
   if(!current)current={chunks:[],count:0,rate:decoded.rate,start:start.seconds+offset/decoded.rate,epoch:start.epoch,signature};
   const count=Math.min(row.num_samples-offset,decoded.rate*5-current.count);
   current.chunks.push({channels:decoded.channels.map(c=>c.subarray(offset,offset+count)),start:start.seconds+offset/decoded.rate,
     count,rate:decoded.rate,epoch:start.epoch,signature,artifact,index,sourceOffset:offset});
   current.count+=count;offset+=count;
   if(current.count===decoded.rate*5){flush();cuts.push({sample_index:index,reason:'five-second-analysis-segment-boundary'})}
  }
 }
 flush();
 const pendingFiles=new Map<string,Buffer>(),records:(ObservationBundle|AudioMeasurement)[]=[],bindings:Row[]=[],fitTrials:Row[]=[];
 let windows=0;
 for(let index=0;index<segments.length;index++){
  const segment=segments[index],channels=Array.from({length:segment.chunks[0].channels.length},()=>new Float32Array(segment.count));
  let offset=0;
  for(const chunk of segment.chunks){chunk.channels.forEach((c,i)=>channels[i].set(c,offset));offset+=chunk.count}
  // Match B recordingMeasurements: highest energy from every eighth sample, earliest tie.
  let selected=0,best=-1;
  channels.forEach((channel,i)=>{let energy=0;for(let sample=0;sample<channel.length;sample+=8)energy+=channel[sample]**2;if(energy>best){best=energy;selected=i}});
  const mono=channels[selected],raw=Buffer.alloc(mono.length*4);mono.forEach((x,i)=>raw.writeFloatLE(x,i*4));
  const id=`${observation.id}-pcm-segment-${index}`,name=`segment-${index}.pcm.f32`,sourceHashes=[...new Set(segment.chunks.map(c=>c.artifact.sha256))];
  const artifact:Artifact={id:`${id}-artifact`,uri:name,sha256:hash(raw),mediaType:'application/octet-stream',byteLength:raw.length};
  pendingFiles.set(name,raw);
  const timebase={clockId:`${id}-sample-index`,origin:'session-start' as const,unit:'ms' as const,
      syncUncertaintyMs:null,referenceClockId:audio.timebase.clockId,offsetToReferenceMs:segment.start*1000};
  const derived:ObservationBundle={schemaVersion:'1.0.0',kind:'observation',id,createdAt:new Date().toISOString(),
   provenance:{kind:evidenceKind==='development-fixture'?'development-fixture':'derived-measurement',producer:'singing-teacher/native-pcm-import',producerVersion:'0.1.0',
    sourceIds:[observation.id,...new Set(segment.chunks.map(c=>c.artifact.id))],sourceHashes:[manifestArtifact.sha256,...sourceHashes]},
   participantId:options.participantId,sessionId:options.sessionId,trialId:id,predictionId:null,consentScope:observation.consentScope,
   task:options.pose?`User-declared pose ${options.pose}; native audio segment`:'Native audio segment; pose not declared',artifacts:[artifact],
   streams:['audio','rgb','depth'].map((modality):ObservationBundle['streams'][number]=>({modality:modality as 'audio'|'rgb'|'depth',timebase,
    samples:modality==='audio'?[{captureMs:0,artifactId:artifact.id,sequence:0,quality:{flags:['derived-native-PCM','capture-sync-unknown'],missingReason:null}}]:[],
    missingReason:modality==='audio'?null:'not-requested',droppedSamples:0,
    settings:modality==='audio'?{sampleRate:segment.rate,channels:1,selectedSourceChannel:selected+1,encoding:'little-endian-float32',normalization:'none'}:{},
    calibration:{artifactId:null,missingReason:'not-calibrated'},depth:null}))};
  records.push(derived);
  const frameSize=audioFrameSize(segment.rate),hop=Math.round(segment.rate*.1),measurementIds:string[]=[];
  for(let start=0;start+frameSize<=mono.length;start+=hop){
   if(++windows>WINDOW_LIMIT)throw Error('Canonical window limit exceeded');
   const frame=mono.slice(start,start+frameSize),measurement=extractAudioMeasurement(frame,segment.rate,
    {id:`${id}-window-${start}`,observationId:id,artifactId:artifact.id,startMs:start/segment.rate*1000,timebase,
     sourceKind:evidenceKind,sourceHashes:[artifact.sha256],qualityFlags:['decoded-native-LPCM',`analyzed-channel-${selected+1}`,'capture-sync-unknown',...(frame.some(x=>Math.abs(x)>=.995)?['clipping']:[])]});
   records.push(measurement);measurementIds.push(measurement.id);
   if(options.pose&&mono.length/segment.rate>=.1)fitTrials.push({id:measurement.id,pose:options.pose,measurement,sample_rate_hz:segment.rate,
       frame_start_sample:start,frame_size:frameSize,duration_s:mono.length/segment.rate});
  }
  bindings.push({segment_id:id,derived_artifact:artifact,selected_source_channel:selected+1,
      channel_policy:'B highest energy sampled every eighth sample; earliest tie; no mixing/normalization',
      sample_rate_hz:segment.rate,sample_count:segment.count,source_clock_id:audio.timebase.clockId,
      source_start_ms:segment.start*1000,epoch:segment.epoch,capture_sync_uncertainty_ms:null,
      source_artifacts:segment.chunks.map(c=>({id:c.artifact.id,sha256:c.artifact.sha256,sample_index:c.index,
         source_start_ms:c.start*1000,source_sample_offset:c.sourceOffset,sample_count:c.count})),manifest_sha256:manifestArtifact.sha256,
      fit_missing_reason:!options.pose?'pose-not-declared':mono.length/segment.rate<.1?'segment-shorter-than-native-minimum-duration':null,
      relative_clock_tolerance_seconds:.25/segment.rate,
      measurement_ids:measurementIds,missing_reason:measurementIds.length?null:'segment-shorter-than-canonical-window'});
 }
 for(const record of records){const result=validateRecord(record);if(!result.valid)throw Error(result.errors.join('; '))}
 const result={kind:'native-canonical-pcm-import',version:'0.1.0',records,segments:bindings,cuts,
   declared_evidence_kind:evidenceKind,source_directory:root,source_manifest_sha256:manifestArtifact.sha256,source_import:native,
   fit_trial_options:fitTrials,fit_trial_options_interpretation:'Select at most 10 calibration windows, declare model candidates separately; not an automatic fit or independent trials',
   limits:{audio_bytes:AUDIO_LIMIT,max_windows:WINDOW_LIMIT,max_segment_seconds:5},
   limitations:['Package consistency is verified, not physical device authenticity.','No actual phone capture acceptance is claimed by software fixtures.',
    'Relative clock origin shift is arithmetic, not audio/video synchronization calibration.','Ambient noise and room response are not calibrated.',
    'Subframe timestamp discrepancies up to one-quarter audio sample are tolerated; gaps larger than that cut segments.']};
 await mkdir(outputDirectory,{recursive:false,mode:0o700});
 for(const [name,bytes]of pendingFiles)await writeFile(resolve(outputDirectory,name),bytes,{flag:'wx',mode:0o600});
 await writeFile(resolve(outputDirectory,'native-pcm.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 const fixtureFlag=args.at(-1)==='--development-fixture';
 if(fixtureFlag)args.pop();
 if(args.length<4||args.length>5)throw Error('Expected input, output, participant, session and optional pose');
 const [input,output,participant,session,pose]=args;
 if(!input||!output||!participant||!session)throw Error('Usage: import_native_pcm.ts INPUT NEW_OUTPUT PARTICIPANT SESSION [POSE] [--development-fixture]');
 const result=await importNativePcm(input,output,{participantId:participant,sessionId:session,pose,evidenceKind:fixtureFlag?'development-fixture':'human-observation'});
 console.log(`Wrote ${result.segments.length} segments and ${result.records.filter(r=>r.kind==='audio-measurement').length} canonical measurements; no fitting performed.`);
}
