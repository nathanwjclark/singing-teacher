#!/usr/bin/env -S node --experimental-strip-types
/** Private native directory -> KIT-01, without media conversion or physiological fitting. */
import { constants } from 'node:fs'
import { open, realpath, readdir, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { CONTRACT_VERSION, validateRecord } from '../src/contracts/index.ts'
import type { Artifact, ObservationBundle, ObservationStream } from '../src/contracts/index.ts'

type ObjectRow = Record<string, unknown>
const LIMIT = 512 * 1024 * 1024
function row(value: unknown, name: string): ObjectRow { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${name}: expected object`); return value as ObjectRow }
function array(value: unknown, name: string): unknown[] { if (!Array.isArray(value)) throw Error(`${name}: expected array`); return value }
function text(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw Error(`${name}: expected nonempty string`); return value }
function number(value: unknown, name: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${name}: expected finite number`); return value }
function integer(value: unknown, name: string): number { const n=number(value,name); if(!Number.isSafeInteger(n)||n<0)throw Error(`${name}: expected nonnegative safe integer`);return n }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function stamp(value: unknown, name: string) {
 const t=row(value,name), scale=integer(t.timescale,`${name}.timescale`), v=integer(t.value,`${name}.value`),epoch=integer(t.epoch,`${name}.epoch`), flags=integer(t.flags,`${name}.flags`)
 if(!scale||!(flags&1)||(flags&28))throw Error(`${name}: invalid/nonnumeric CMTime`)
 const seconds=number(t.seconds,`${name}.seconds`)
 if(Math.abs(seconds-v/scale)>1e-6)throw Error(`${name}: inconsistent rational timestamp`)
 return {ms:v/scale*1000,epoch}
}
function dimensions(value:unknown,name:string){const d=array(value,name);if(d.length!==2)throw Error(`${name}: expected width,height`);const w=integer(d[0],name),h=integer(d[1],name);if(!w||!h||w*h>LIMIT/4)throw Error(`${name}: invalid dimensions`);return [w,h] as const}
function calibration(value:unknown){const c=row(value,'calibration');for(const [name,columns]of [['intrinsics_row_major',3],['extrinsics_3x4_row_major',4]] as const){const matrix=array(c[name],name);if(matrix.length!==3)throw Error(`Invalid ${name}`);matrix.forEach(r=>{const vals=array(r,name);if(vals.length!==columns)throw Error(`Invalid ${name}`);vals.forEach(v=>number(v,name))})}const k=c.intrinsics_row_major as number[][];if(k[0][0]<=0||k[1][1]<=0)throw Error('Invalid calibration focal lengths');dimensions(c.intrinsic_reference_dimensions,'calibration reference dimensions');if(number(c.pixel_size_mm,'pixel size')<=0)throw Error('Invalid pixel size');const center=array(c.lens_distortion_center,'distortion center');if(center.length!==2)throw Error('Invalid distortion center');center.forEach(v=>number(v,'distortion center'));for(const key of ['lens_distortion_table_base64','inverse_lens_distortion_table_base64'])if(c[key]!==null&&typeof c[key]!=='string')throw Error('Invalid distortion table')}

export async function importNativeCapture(directory:string,participantId:string,sessionId:string,options:{allowRearLidar?:boolean}={}){
 text(participantId,'participant');text(sessionId,'session')
 const root=await realpath(directory), buffers=new Map<string,Buffer>();let totalBytes=0
 async function readLocal(name:string){
  if(name!==basename(name)||name==='.'||name==='..'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))throw Error(`Unsafe local filename: ${name}`)
  const existing=buffers.get(name);if(existing)return existing
  const handle=await open(resolve(root,name),constants.O_RDONLY|constants.O_NOFOLLOW)
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size+totalBytes>LIMIT)throw Error('Non-regular file or capture exceeds 512 MB');const bytes=await handle.readFile();if(bytes.length!==stat.size)throw Error('Artifact changed during read');totalBytes+=bytes.length;buffers.set(name,bytes);return bytes}finally{await handle.close()}
 }
 const manifestBytes=await readLocal('manifest.json'), manifest=row(JSON.parse(manifestBytes.toString('utf8')),'manifest')
 if(manifest.schema_version!=='singing-native-rgbd-1.0.0'||!['one-held-pose','separate-rear-lidar-held-pose'].includes(String(manifest.capture_mode)))throw Error('Unsupported native capture schema/mode')
 const device=row(manifest.device,'device'),rear=manifest.capture_mode==='separate-rear-lidar-held-pose';
 if(rear&&!options.allowRearLidar)throw Error('Optional rear LiDAR ingestion is disabled');
 if(device.output_mirrored!==false || (rear?(!text(device.device_type,'device type').includes('LiDAR')||device.position!=='back'||device.sensor!=='rear-lidar'):(!text(device.device_type,'device type').includes('TrueDepth')||device.position!=='front')))throw Error('Native sensor identity or mirroring mismatch');

 const captureId=text(manifest.capture_id,'capture_id'), createdAt=text(manifest.created_at,'created_at');if(!Number.isFinite(Date.parse(createdAt)))throw Error('Invalid capture date')
 const frames=array(manifest.frames,'frames').map((f,i)=>row(f,`frame ${i}`)), audio=row(manifest.audio,'audio'), audioRows=array(audio.samples,'audio samples').map((a,i)=>row(a,`audio ${i}`))
 const artifacts:Artifact[]=[], byName=new Map<string,Artifact>()
 const artifactId=(name:string)=>`${captureId}/artifact/${name}`
 async function verifyArtifacts(value:unknown):Promise<void>{
  if(Array.isArray(value)){for(const item of value)await verifyArtifacts(item);return}
  if(!value||typeof value!=='object')return
  const object=value as ObjectRow
  if('path'in object){const name=text(object.path,'artifact.path');const bytes=await readLocal(name);const expected=text(object.sha256,'artifact.sha256');if(!/^[a-f0-9]{64}$/.test(expected)||integer(object.bytes,'artifact.bytes')!==bytes.length||hash(bytes)!==expected)throw Error(`Artifact hash or byte count mismatch: ${name}`);if(!byName.has(name)){const a={id:artifactId(name),uri:name,sha256:expected,mediaType:name.endsWith('.jpg')?'image/jpeg':'application/octet-stream',byteLength:bytes.length};byName.set(name,a);artifacts.push(a)}}
  for(const child of Object.values(object))await verifyArtifacts(child)
 }
 await verifyArtifacts(manifest)
 for(const item of await readdir(root,{withFileTypes:true})){if(item.name==='manifest.json'||item.name==='.DS_Store'&&item.isFile()||item.name==='__MACOSX'&&item.isDirectory())continue;if(!item.isFile()||!byName.has(item.name))throw Error(`Unreferenced or unsafe capture entry: ${item.name}`)}
 const manifestArtifact:Artifact={id:artifactId('manifest.json'),uri:'manifest.json',sha256:hash(manifestBytes),mediaType:'application/json',byteLength:manifestBytes.length};artifacts.push(manifestArtifact)
 const streams:ObservationStream[]=[]
 for(const modality of ['rgb','depth','audio'] as const){
  const rows=modality==='audio'?audioRows:frames, samples:ObservationStream['samples']=[]
  let previous=-Infinity,previousSequence=-1,epoch:number|null=null,dropped=0,filtered:boolean|null=null,calibrated=true
  for(let i=0;i<rows.length;i++){
   const frame=rows[i],ref=frame[modality==='audio'?'artifact':modality]
   const sequence=modality==='audio'?i:integer(frame.sequence,'frame sequence')
   if(sequence<=previousSequence)throw Error('Non-increasing frame sequence');previousSequence=sequence
   if(!ref){if(modality!=='audio'&&!frame[`${modality}_dropped`]&&!frame.write_error)throw Error(`Missing ${modality} without explicit drop/write error`);if(modality==='audio'&&!frame.missing_reason)throw Error('Missing audio chunk without reason');dropped++;continue}
   if(frame[`${modality}_dropped`])throw Error('Artifact declared dropped')
   const name=text(row(ref,'artifact').path,'artifact path'),artifact=byName.get(name);if(!artifact)throw Error('Unverified artifact reference')
   const time=stamp(frame[modality==='audio'?'presentation_timestamp':`${modality}_timestamp`],`${modality} timestamp`)
   if(time.ms<previous||(epoch!==null&&epoch!==time.epoch))throw Error(`${modality} clock reversed or changed epoch`);previous=time.ms;epoch=time.epoch
   const flags=['native-source-timestamp','absolute-sync-uncertainty-unknown'],quality:ObservationStream['samples'][number]['quality']={flags,missingReason:null}
   if(modality==='depth'){
    if(frame.depth_unit!=='m'||frame.depth_storage!=='row-major-little-endian-float32-packed')throw Error('Unsupported depth storage or units')
    const [w,h]=dimensions(frame.depth_dimensions,'depth dimensions'),bytes=buffers.get(name)!
    if(bytes.length!==w*h*4)throw Error('Depth packed byte count mismatch')
    if(typeof frame.depth_filtered!=='boolean'||filtered!==null&&filtered!==frame.depth_filtered)throw Error('Unknown or mixed depth filtering cannot fit one KIT stream');filtered=frame.depth_filtered
    if(frame.calibration)calibration(frame.calibration);else{calibrated=false;flags.push('camera-calibration-missing')}
    let valid=0;for(let offset=0;offset<bytes.length;offset+=4){const value=bytes.readFloatLE(offset);if(Number.isFinite(value)&&value>0)valid++}
    flags.push(`positive-finite-depth-pixels:${valid}/${w*h}`,'native-distortion-not-rectified','depth-noise-not-calibrated')
    if(!valid)quality.missingReason='low-confidence'
    if(frame.depth_accuracy_label!=='absolute'){flags.push('absolute-depth-accuracy-not-declared');quality.missingReason='not-calibrated'}
   }else if(modality==='audio'){
    const format=row(frame.asbd,'audio ASBD'),count=integer(frame.num_samples,'audio sample count'),bytesPerFrame=integer(format.bytes_per_frame,'audio bytes/frame'),formatFlags=integer(format.format_flags,'audio format flags')
    if(format.format_id!==1819304813||(formatFlags&32)||!bytesPerFrame||artifact.byteLength!==count*bytesPerFrame||number(format.sample_rate,'audio sample rate')<=0||!integer(format.channels_per_frame,'audio channels'))throw Error('Invalid interleaved LPCM byte count or format')
    flags.push('native-interleaved-LPCM-see-manifest-ASBD')
   }else dimensions(frame.rgb_dimensions,'RGB dimensions')
   samples.push({captureMs:time.ms,artifactId:artifact.id,sequence,quality})
  }
  streams.push({modality,timebase:{clockId:`${captureId}/${modality}/${modality==='audio'?'presentation':'synchronizer'}/epoch-${epoch??'unknown'}`,origin:'device-monotonic',unit:'ms',syncUncertaintyMs:null,referenceClockId:null,offsetToReferenceMs:null},samples,missingReason:samples.length?null:modality==='audio'&&String(audio.reason).includes('permission-denied')?'permission-denied':'not-captured',droppedSamples:dropped,settings:{nativeManifestArtifactId:manifestArtifact.id,nativeMetadataPath:modality==='audio'?'audio.samples':'frames',nativeCaptureId:captureId,sourceTimestampUnits:'CMTime rational seconds converted to milliseconds',crossClockAlignment:'not-measured',sourceMetadataPreserved:true,...(modality==='audio'?{encoding:'per-chunk native interleaved LPCM ASBD',nativeMissingReason:typeof audio.reason==='string'&&audio.reason?audio.reason:'see per-sample status',droppedSampleCountKnown:false}:{}),...(modality==='depth'?{depthSource:'hardware',sensor:rear?'rear LiDAR':'front TrueDepth',separateScan:rear,modelFusionEnabled:false,rectified:false,perFrameCalibration:calibrated&&samples.length>0,headPose:'not-measured',hiddenGeometry:'not-measured'}:{})},calibration:modality==='depth'&&samples.length&&calibrated?{artifactId:manifestArtifact.id,missingReason:null}:{artifactId:null,missingReason:'not-calibrated'},depth:modality==='depth'&&samples.length?{representation:'depth',unit:'m',coordinateFrame:'camera-optical',filtered:filtered!}:null})
 }
 const observation:ObservationBundle={schemaVersion:CONTRACT_VERSION,kind:'observation',id:`native-${captureId}`,createdAt,provenance:{kind:'human-observation',producer:'singing-teacher/native-import',producerVersion:'1.0.0',sourceIds:[captureId],sourceHashes:[manifestArtifact.sha256]},participantId,sessionId,trialId:captureId,predictionId:null,consentScope:['explicit-local-native-recording','private-local-analysis'],task:text(manifest.task,'task'),streams,artifacts}
 const checked=validateRecord(observation);if(!checked.valid)throw Error(checked.errors.join('\n'))
 return {kind:'native-kit-import',version:1,records:[observation],runs:[],limitations:['Per-frame native distortion/calibration metadata is preserved in manifest.json; no rectification, RGB registration, world/head pose or fitting performed.','Per-modality source clocks remain independent with unknown alignment and absolute synchronization uncertainty.','Hashes verify package consistency, not physical-device authenticity or depth accuracy.','Hardware depth declaration comes from native capture format; fixtures must not be submitted as human evidence.','Artifact URIs resolve beside the original manifest and raw files; import metadata into the dashboard and keep media locally.']}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [directory,...args]=process.argv.slice(2);const options=new Map<string,string>();for(let i=0;i<args.length;i+=2){if(!['--participant','--session','--output'].includes(args[i])||!args[i+1]||options.has(args[i]))throw Error('Invalid or duplicate option');options.set(args[i],args[i+1])}if(!directory||options.size!==3)throw Error('Usage: node --experimental-strip-types scripts/import-native-capture.ts DIRECTORY --participant ID --session ID --output OUTPUT.json');const output=await importNativeCapture(directory,options.get('--participant')!,options.get('--session')!);await writeFile(options.get('--output')!,JSON.stringify(output,null,2),{flag:'wx',mode:0o600});console.log(`Validated ${output.records[0].artifacts.length} artifacts; wrote private KIT metadata. No fitting performed.`)}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1}
}
