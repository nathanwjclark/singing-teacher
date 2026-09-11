#!/usr/bin/env -S node --experimental-strip-types
import { constants } from 'node:fs'
import { open,realpath,mkdir,writeFile } from 'node:fs/promises'
import { resolve,basename,dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { CONTRACT_VERSION,validateRecord } from '../src/contracts/index.ts'
import type { ObservationBundle } from '../src/contracts/index.ts'
import { PROBE_VERSION,probeSource,receiptAcquisition,validateProbeMeasurement } from '../src/contracts/probes.ts'
import type { ProbeAttempt,ProbeMedia,AcousticProbeMeasurement } from '../src/contracts/probes.ts'
import { extractProbeResponse,EXTRACTOR_VERSION } from '../src/observations/acoustics/probeResponse.ts'
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)
const integer=(v:unknown)=>finite(v)&&Number.isSafeInteger(v)&&(v as number)>=0
/** Reads one regular file by safe basename from `root` without following symlinks, bounded by `limit` bytes. */
export async function readFrom(root:string,name:string,limit=128*1024*1024){if(typeof name!=='string'||name!==basename(name)||!/^[\w][\w.-]*$/.test(name))throw Error('Unsafe artifact path');const file=await open(resolve(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();if(!stat.isFile()||stat.size>limit)throw Error('Invalid artifact size/type');const bytes=await file.readFile();if(bytes.length!==stat.size)throw Error('File changed during read');return bytes}finally{await file.close()}}
/** The acquisition record of the app's `usb-receipt.json` (null for a receipt that has none), after checking the
 * sha256 and byte count of the `original.zip` beside it. Pass the result to receiptSource. */
export async function pullAcquisition(receiptPath:string):Promise<unknown>{
 const root=await realpath(dirname(resolve(receiptPath))),pull=JSON.parse((await readFrom(root,basename(receiptPath),1024*1024)).toString())
 if(!pull||typeof pull!=='object'||typeof pull.sha256!=='string'||!/^[a-f0-9]{64}$/.test(pull.sha256)||!Number.isSafeInteger(pull.bytes))throw Error('Pull receipt lacks the archive hash and byte count')
 const archive=await readFrom(root,'original.zip',512*1024*1024)
 if(archive.length!==pull.bytes||hash(archive)!==pull.sha256)throw Error('Pulled archive does not match its pull receipt')
 return receiptAcquisition(pull)
}
/** probeSource with the pull receipt's acquisition record. Both importers classify through this, so both refuse a
 * repository-fixture receipt the manifest contradicts. */
export function receiptSource(manifest:unknown,acquisition?:unknown){
 const source=probeSource(manifest,acquisition)
 if(source.attestation==='contradicted-fixture-receipt')throw Error('Repository-fixture pull receipt contradicts the capture manifest: only a marked software fixture without iPhone recorder fields may carry one')
 return source
}
/** `acquisition` is the pull receipt's record from pullAcquisition; omit it for an import with no receipt. */
export async function importAcousticProbe(directory:string,output:string,acquisition?:unknown){
 const root=await realpath(directory)
 const read=(name:string)=>readFrom(root,name)
 const manifest=await read('manifest.json'),a=JSON.parse(manifest.toString()) as ProbeAttempt
 if(a.schemaVersion!=='probe-native-1.0.0'||!a.captureId||!['software-fixture','physical-reference','human-recording'].includes(a.provenance))throw Error('Unsupported capture identity/schema/provenance')
 // Review records carry the source kind the manifest's fields and pull receipt support, not its bare label.
 const source=receiptSource(a,acquisition).kind
 if(!integer(a.sampleRateHz)||a.sampleRateHz<8000||a.sampleRateHz>192000)throw Error('Invalid sample rate')
 if(!a.protocol||!a.protocol.id||!Array.isArray(a.protocol.bandHz)||a.protocol.bandHz.length!==2||!a.protocol.bandHz.every(finite)||a.protocol.bandHz[0]<=0||a.protocol.bandHz[1]<=a.protocol.bandHz[0]||a.protocol.bandHz[1]>=a.sampleRateHz/2||!finite(a.protocol.gain)||a.protocol.gain<0||a.protocol.gain>1)throw Error('Invalid protocol band/gain')
 if(!a.timing||!['sample-aligned','estimated','unknown'].includes(a.timing.support)||!a.timing.method||(a.timing.uncertaintySeconds!==null&&(!finite(a.timing.uncertaintySeconds)||a.timing.uncertaintySeconds<0))||!a.calibration||typeof a.calibration!=='object')throw Error('Missing timing/calibration')
 if(a.failures!==undefined&&(!Array.isArray(a.failures)||a.failures.some(x=>typeof x!=='string')))throw Error('Invalid failure metadata')
 async function pcm(m:ProbeMedia){if(!m||m.format!=='float32-le'||m.channels!==1||!integer(m.sampleCount)||!m.sampleCount||!integer(m.byteCount)||m.byteCount!==m.sampleCount*4||!m.sha256)throw Error('Unsupported PCM descriptor');const bytes=await read(m.path);if(bytes.length!==m.byteCount||hash(bytes)!==m.sha256)throw Error('PCM hash/byte mismatch');const values=new Float64Array(m.sampleCount);for(let i=0;i<values.length;i++){values[i]=bytes.readFloatLE(i*4);if(!Number.isFinite(values[i]))throw Error('Nonfinite PCM sample')}return values}
 const drive=await pcm(a.drive),received=await pcm(a.received)
 if(!Array.isArray(a.segments)||!a.segments.length||a.segments.length>32)throw Error('No supported repeated windows')
 let prevDrive=0,prevReceived=0,unsupportedWindows=false
 for(const s of a.segments){
  if(!s||![s.driveStartSample,s.sampleCount].every(integer)||!s.sampleCount||s.driveStartSample<prevDrive||s.driveStartSample+s.sampleCount>drive.length)throw Error('Invalid or overlapping drive windows')
  prevDrive=s.driveStartSample+s.sampleCount
  if(s.receivedStartSample===null){unsupportedWindows=true;continue}
  if(!integer(s.receivedStartSample)||s.receivedStartSample<prevReceived)throw Error('Invalid or overlapping received windows')
  if(s.receivedStartSample+s.sampleCount>received.length){if(!a.failures?.length)throw Error('Incomplete PCM windows without failed/stopped capture declaration');unsupportedWindows=true}
  prevReceived=s.receivedStartSample+s.sampleCount
 }
 // Verify all calibration artifact bytes as well as audio. Keep original manifest immutable.
 const levelArtifact=a.calibration.levelCheckArtifact as {path:string;sha256:string;byteCount:number}|undefined
 if(levelArtifact){const bytes=await read(levelArtifact.path);if(bytes.length!==levelArtifact.byteCount||hash(bytes)!==levelArtifact.sha256)throw Error('Calibration artifact hash/byte mismatch')}
 const flags=[...(a.failures??[])]
 if(Array.isArray(a.bufferDiscontinuities)&&a.bufferDiscontinuities.length)flags.push('Received PCM buffer discontinuities invalidate response')
 const result=unsupportedWindows?{
  full:{frequencyHz:[],real:[],imag:[],coherence:[],relativeStd:[],valid:[]},response:{frequencyHz:[],real:[],imag:[],magnitude:[],coherence:[],relativeStd:[],valid:[]},impulse:[],configuration:{unavailableReason:'Stopped/incomplete windows or missing native sample alignment; no response estimated'},quality:{repeats:0,clippedSamples:0,snrDb:null,flags:[...flags,'Response unavailable: incomplete capture or unknown playback sample mapping'],validBandHz:null}
 }:extractProbeResponse(drive,received,{...a,failures:flags})
 if(!result.quality.validBandHz)result.quality.flags.push('No band passes repeat, excitation and saturation criteria')
 const outputRoot=resolve(output);await mkdir(outputRoot,{recursive:true})
 async function derived(name:string,value:unknown){const bytes=Buffer.from(JSON.stringify(value)),sha256=hash(bytes),path=`${name}-${sha256.slice(0,16)}.json`;await writeFile(resolve(outputRoot,path),bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error});return{path,sha256,byteCount:bytes.length}}
 const responseArtifact=await derived('probe-response',{schemaVersion:PROBE_VERSION,units:'recorded-PCM-per-digital-drive',sourceHashes:{drive:a.drive.sha256,received:a.received.sha256},...result.full})
 const impulseArtifact=await derived('probe-impulse',{sampleRateHz:a.sampleRateHz,units:'recorded-PCM-per-digital-drive',interpretation:'circular finite-window estimate; time zero unverified for estimated timing; no direct-path removal',samples:result.impulse})
 const measurement:AcousticProbeMeasurement={schemaVersion:PROBE_VERSION,kind:'acoustic-probe-measurement',id:`probe-${hash(manifest)}`,captureId:a.captureId,provenance:source,captured:{value:true,reason:unsupportedWindows?'Original exact drive and received PCM hashes and byte lengths verified; response windows unavailable':'Original exact drive and received PCM hashes, byte lengths and nonoverlapping windows verified'},responseUsable:{value:!!result.quality.validBandHz,reason:result.quality.validBandHz?'Repeated response has supported magnitude bands; consult quality/timing masks':'No supported response band; capture retained'},includedInFit:{value:false,reason:'External-drive observation operator and joint-fit integration are not implemented; glottal transfer is not a substitute',operatorVersion:null},units:'recorded-PCM-per-digital-drive',sourceHashes:{manifest:hash(manifest),drive:a.drive.sha256,received:a.received.sha256},extractor:{version:EXTRACTOR_VERSION,configuration:result.configuration},timing:a.timing,phaseUsable:a.timing.support==='sample-aligned'&&a.timing.uncertaintySeconds!==null&&a.timing.uncertaintySeconds<=1/a.sampleRateHz,quality:result.quality,response:result.response,artifacts:{response:responseArtifact,impulse:impulseArtifact},calibration:a.calibration,interpretation:'Recorded response includes speaker, microphone, direct path, room, placement and cavity contributions; not a scan of hidden anatomy'}
 const validation=validateProbeMeasurement(measurement);if(!validation.valid)throw Error(validation.errors.join('; '))
 const observation:ObservationBundle={schemaVersion:CONTRACT_VERSION,kind:'observation',id:`${measurement.id}/observation`,createdAt:typeof a.createdAt==='string'?a.createdAt:new Date(0).toISOString(),provenance:{kind:source==='software-fixture'?'development-fixture':'human-observation',producer:'singing-teacher/probe-import',producerVersion:EXTRACTOR_VERSION,sourceIds:[a.captureId],sourceHashes:Object.values(measurement.sourceHashes)},participantId:typeof a.participantId==='string'?a.participantId:'unassigned-local-participant',sessionId:typeof a.sessionId==='string'?a.sessionId:a.captureId,trialId:a.captureId,predictionId:typeof a.predictionId==='string'?a.predictionId:null,consentScope:['private-local-analysis'],task:`external-acoustic-probe:${a.protocol.id}`,artifacts:[{id:`${measurement.id}/manifest`,uri:pathToFileURL(resolve(root,'manifest.json')).href,sha256:hash(manifest),byteLength:manifest.length,mediaType:'application/json'},...[a.drive,a.received].map((m,i)=>({id:`${measurement.id}/${i?'received':'drive'}`,uri:pathToFileURL(resolve(root,m.path)).href,sha256:m.sha256,byteLength:m.byteCount,mediaType:'application/octet-stream'}))],streams:[{modality:'audio',timebase:{clockId:`${a.captureId}/received-pcm-indices`,origin:'session-start',unit:'ms',syncUncertaintyMs:a.timing.uncertaintySeconds===null?null:a.timing.uncertaintySeconds*1000,referenceClockId:null,offsetToReferenceMs:null},samples:[{captureMs:0,artifactId:`${measurement.id}/received`,sequence:0,quality:{flags:result.quality.flags,missingReason:null}}],missingReason:null,droppedSamples:Array.isArray(a.bufferDiscontinuities)?a.bufferDiscontinuities.length:0,settings:{sampleRateHz:a.sampleRateHz,channels:1,encoding:'float32-le',sampleIndexOrigin:'first retained microphone PCM sample; native host mappings retained in manifest',containsProbe:true,notSingingAudio:true},calibration:{artifactId:null,missingReason:'not-calibrated'},depth:null}]}
 for(const modality of ['rgb','depth'] as const)observation.streams.push({modality,timebase:{clockId:`${a.captureId}/${modality}/absent`,origin:'session-start',unit:'ms',syncUncertaintyMs:null,referenceClockId:null,offsetToReferenceMs:null},samples:[],missingReason:'not-captured',droppedSamples:0,settings:{reason:'standalone native audio probe'},calibration:{artifactId:null,missingReason:'not-calibrated'},depth:null})
 const checked=validateRecord(observation);if(!checked.valid)throw Error(checked.errors.join('; '))
 await writeFile(resolve(outputRoot,'probe-kit-observation.json'),JSON.stringify({kind:'probe-kit-import',version:1,records:[observation],runs:[],limitations:['Raw artifact URIs are private local original files. KIT 1.0 unchanged. Probe-specific measurement uses additive probe-records-1.0.0.','Participant remains unassigned unless native metadata supplies an explicit participant ID.','Do not feed external excitation into a glottal/singing observation operator.']},null,2))
 await writeFile(resolve(outputRoot,'probe-records.json'),JSON.stringify({schemaVersion:PROBE_VERSION,records:[{...a.protocol,kind:'probe-definition',id:`${measurement.id}/definition`,excitation:a.drive},{...a.calibration,kind:'probe-calibration',id:`${measurement.id}/calibration`},{kind:'probe-attempt',id:measurement.id,manifestHash:hash(manifest),observationId:observation.id,source:a},measurement]},null,2))
 await writeFile(resolve(outputRoot,'probe-measurement.json'),JSON.stringify(measurement,null,2))
 return measurement
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [directory,output,receipt]=process.argv.slice(2);if(!directory||!output)throw Error('Usage: node --experimental-strip-types scripts/import-acoustic-probe.ts CAPTURE_DIRECTORY PRIVATE_OUTPUT_DIRECTORY [USB_RECEIPT_JSON]');const r=await importAcousticProbe(directory,output,receipt===undefined?undefined:await pullAcquisition(receipt));console.log(JSON.stringify({id:r.id,captured:r.captured,responseUsable:r.responseUsable,includedInFit:r.includedInFit,quality:r.quality},null,2))}
