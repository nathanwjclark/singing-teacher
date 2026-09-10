import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeLpcm,importNativePcm} from './import_native_pcm.ts';
import {validateRecord} from '../../src/contracts/index.ts';
import {extractAudioMeasurement} from '../../src/lib/audio.ts';

export async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'native-pcm-software-fixture-'));
 const samples:any[]=[];const rate=48000,count=1024,stamp=(value:number)=>({value,timescale:rate,epoch:0,flags:1,seconds:value/rate});
 const format={sample_rate:rate,format_id:1819304813,format_flags:9,bytes_per_packet:8,frames_per_packet:1,bytes_per_frame:8,channels_per_frame:2,bits_per_channel:32};
 const mono=new Float32Array(count*6);
 for(let i=0;i<mono.length;i++)mono[i]=.1*Math.sin(2*Math.PI*180*i/rate);
 for(let chunk=0;chunk<6;chunk++){
  const raw=Buffer.alloc(count*8);for(let i=0;i<count;i++){raw.writeFloatLE(0,i*8);raw.writeFloatLE(mono[chunk*count+i],i*8+4)}
  const path=`chunk-${chunk}.pcm.raw`;await writeFile(join(directory,path),raw);
  samples.push({presentation_timestamp:stamp(rate+chunk*count),duration:stamp(count),num_samples:count,gap_before_seconds:chunk?0:null,
   artifact:{path,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')},asbd:{...format}});
 }
 const manifest={schema_version:'singing-native-rgbd-1.0.0',capture_mode:'one-held-pose',capture_id:'software-fixture',created_at:'2026-01-01T00:00:00Z',
  task:'Explicit software-generated PCM fixture, not phone evidence',device:{device_type:'AVCaptureDeviceTypeBuiltInTrueDepthCamera',position:'front',output_mirrored:false},
  frames:[],audio:{reason:'software fixture only',samples}};
 const save=()=>writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));await save();
 return {directory,manifest,save,mono,stamp};
}
const opts={participantId:'fixture-participant',sessionId:'fixture-session',pose:'a',evidenceKind:'development-fixture' as const};

test('joins contiguous chunks, retains provenance and unknown clocks, selects energy channel',async()=>{
 const f=await fixture(),output=f.directory+'-out';
 try{
  const result=await importNativePcm(f.directory,output,opts);
  assert.equal(result.segments.length,1);assert.equal(result.fit_trial_options.length,1);
  assert.equal(result.segments[0].selected_source_channel,2);
  assert.equal(result.segments[0].source_artifacts.length,6);
  assert.equal(result.declared_evidence_kind,'development-fixture');
  const measurement=result.records.find(r=>r.kind==='audio-measurement')!;
  assert.equal(measurement.kind,'audio-measurement');if(measurement.kind!=='audio-measurement')throw Error();
  assert.equal(measurement.timebase.offsetToReferenceMs,1000);assert.equal(measurement.timebase.syncUncertaintyMs,null);
  assert.equal(measurement.window.startMs,0);assert.match(measurement.provenance.producer,/development-fixture/);
  const expected=extractAudioMeasurement(f.mono.slice(0,4096),48000,{id:'expected',observationId:'expected',artifactId:'expected',startMs:0,timebase:measurement.timebase});
  assert.deepEqual(measurement.measurements,expected.measurements);
  for(const record of result.records)assert.equal(validateRecord(record).valid,true);
  const bytes=await readFile(join(output,result.segments[0].derived_artifact.uri));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),result.segments[0].derived_artifact.sha256);
  for(let i=0;i<f.mono.length;i++)assert.equal(bytes.readFloatLE(i*4),f.mono[i]);
  assert.equal(result.fit_trial_options[0].frame_size,4096);
  assert.equal(result.fit_trial_options[0].duration_s,6144/48000);
  await assert.rejects(importNativePcm(f.directory,output,opts),/EEXIST/);
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});

test('gaps and explicit drops split short segments rather than bridging missing PCM',async()=>{
 const f=await fixture(),output=f.directory+'-gap';
 try{
  for(let i=3;i<6;i++)f.manifest.audio.samples[i].presentation_timestamp=f.stamp(48000+i*1024+100);
  f.manifest.audio.samples[3].gap_before_seconds=100/48000;await f.save();
  const result=await importNativePcm(f.directory,output,opts);
  assert.equal(result.segments.length,2);assert.equal(result.fit_trial_options.length,0);
  assert.equal(result.cuts[0].reason,'timestamp-gap');
  assert.ok(result.segments.every(s=>s.missing_reason==='segment-shorter-than-canonical-window'));
  await rm(output,{recursive:true,force:true});
  f.manifest.audio.samples.splice(3,0,{missing_reason:'software-simulated-drop'});await f.save();
  const dropped=await importNativePcm(f.directory,output,opts);
  assert.equal(dropped.segments.length,2);assert.equal(dropped.fit_trial_options.length,0);
  assert.ok(dropped.cuts.some(c=>c.reason==='software-simulated-drop'));
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});

test('LPCM16 scales without normalization and unsupported flags/nonfinite samples reject',()=>{
 const format={sample_rate:48000,format_id:1819304813,format_flags:12,bytes_per_frame:2,bytes_per_packet:2,frames_per_packet:1,channels_per_frame:1,bits_per_channel:16};
 const raw=Buffer.alloc(6);[-32768,0,16384].forEach((v,i)=>raw.writeInt16LE(v,i*2));
 assert.deepEqual([...decodeLpcm(raw,format,3).channels[0]],[-1,0,.5]);
 for(const flags of [14,44,28,0])assert.throws(()=>decodeLpcm(raw,{...format,format_flags:flags},3),/ASBD/);
 const nan=Buffer.alloc(4);nan.writeFloatLE(NaN);
 assert.throws(()=>decodeLpcm(nan,{...format,format_flags:9,bits_per_channel:32,bytes_per_frame:4,bytes_per_packet:4},1),/Nonfinite/);
});

test('durations, gap declarations, hashes and source encoding cannot be guessed',async()=>{
 const f=await fixture(),output=f.directory+'-bad';
 try{
  f.manifest.audio.samples[0].duration=f.stamp(1);await f.save();
  await assert.rejects(importNativePcm(f.directory,output,opts),/Duration/);
  f.manifest.audio.samples[0].duration=f.stamp(1024);f.manifest.audio.samples[1].gap_before_seconds=.1;await f.save();
  await assert.rejects(importNativePcm(f.directory,output,opts),/gap disagrees/);
  f.manifest.audio.samples[1].gap_before_seconds=0;f.manifest.audio.samples[0].asbd.format_flags=11;await f.save();
  await assert.rejects(importNativePcm(f.directory,output,opts),/ASBD/);
  f.manifest.audio.samples[0].asbd.format_flags=9;await f.save();
  await writeFile(join(f.directory,'chunk-0.pcm.raw'),Buffer.alloc(1));
  await assert.rejects(importNativePcm(f.directory,output,opts),/hash or byte/);
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});

test('short-but-extractable windows remain ineligible for native fit and int16 rail flags clipping',async()=>{
 const f=await fixture(),output=f.directory+'-short';
 try{
  for(let i=4;i<6;i++)await rm(join(f.directory,f.manifest.audio.samples[i].artifact.path));
  f.manifest.audio.samples.length=4;
  for(const row of f.manifest.audio.samples){
   const bytes=Buffer.alloc(1024*2);for(let i=0;i<1024;i++)bytes.writeInt16LE(32767,i*2);
   await writeFile(join(f.directory,row.artifact.path),bytes);
   row.artifact.bytes=bytes.length;row.artifact.sha256=createHash('sha256').update(bytes).digest('hex');
   Object.assign(row.asbd,{format_flags:12,bytes_per_frame:2,bytes_per_packet:2,channels_per_frame:1,bits_per_channel:16});
  }
  await f.save();const result=await importNativePcm(f.directory,output,opts);
  assert.equal(result.records.filter(r=>r.kind==='audio-measurement').length,1);
  assert.equal(result.fit_trial_options.length,0);
  assert.equal(result.segments[0].fit_missing_reason,'segment-shorter-than-native-minimum-duration');
  const measurement=result.records.find(r=>r.kind==='audio-measurement')!;
  if(measurement.kind!=='audio-measurement')throw Error();assert.ok(measurement.quality.flags.includes('clipping'));
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});

test('cumulative sub-sample timestamp drift cuts segments instead of accumulating hidden timing error',async()=>{
 const f=await fixture(),output=f.directory+'-drift';
 try{
  f.manifest.audio.samples.forEach((row,i)=>{
   const value=240000+i*5121;row.presentation_timestamp={value,timescale:240000,epoch:0,flags:1,seconds:value/240000};
   row.gap_before_seconds=i?1/240000:null;
  });
  await f.save();const result=await importNativePcm(f.directory,output,opts);
  assert.equal(result.segments.length,3);
  assert.ok(result.cuts.some(c=>c.reason==='cumulative-timestamp-deviation'));
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});

test('a long chunk splits at five seconds with exact original sample offsets',async()=>{
 const f=await fixture(),output=f.directory+'-long';
 try{
  for(const row of f.manifest.audio.samples)await rm(join(f.directory,row.artifact.path));
  const raw=Buffer.alloc(48000*6*8);for(let i=0;i<48000*6;i++)raw.writeFloatLE(.1*Math.sin(2*Math.PI*180*i/48000),i*8+4);
  const row=f.manifest.audio.samples[0];row.num_samples=48000*6;row.duration=f.stamp(row.num_samples);
  row.artifact={path:'long.pcm.raw',bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
  await writeFile(join(f.directory,row.artifact.path),raw);f.manifest.audio.samples=[row];await f.save();
  const result=await importNativePcm(f.directory,output,opts);
  assert.equal(result.segments.length,2);
  assert.equal(result.segments[0].source_artifacts[0].source_sample_offset,0);
  assert.equal(result.segments[1].source_artifacts[0].source_sample_offset,240000);
  assert.equal(result.segments[1].source_artifacts[0].sample_count,48000);
  assert.ok(result.fit_trial_options.every(t=>t.duration_s<=5));
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});


test('CLI fixture declaration works without an optional pose',async()=>{
 const f=await fixture(),output=f.directory+'-cli';
 try{
  await promisify(execFile)(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./import_native_pcm.ts',import.meta.url)),
   f.directory,output,'fixture-participant','fixture-session','--development-fixture']);
  const result=JSON.parse(await readFile(join(output,'native-pcm.json'),'utf8'));
  assert.equal(result.declared_evidence_kind,'development-fixture');assert.equal(result.fit_trial_options.length,0);
  assert.equal(result.segments[0].fit_missing_reason,'pose-not-declared');
 }finally{await rm(f.directory,{recursive:true,force:true});await rm(output,{recursive:true,force:true})}
});
