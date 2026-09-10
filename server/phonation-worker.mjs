import {readFile,lstat} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {measurePhonation} from '../src/phonation/measure.ts';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory=resolve(process.argv[2]),summary=JSON.parse(await readFile(resolve(directory,'summary.json'),'utf8'));
const imported=await readFile(resolve(directory,'import/native-pcm.json'));
if(hash(imported)!==summary.sourceImportSha256)throw Error('Import integrity mismatch');
const source=JSON.parse(imported),observations=[];
for(const segment of source.segments.slice(0,4)){
 const artifact=segment.derived_artifact;if(basename(artifact.uri)!==artifact.uri)throw Error('Invalid imported path');
 const path=resolve(directory,'import',artifact.uri),stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==artifact.byteLength||stat.size>4*96000*5)throw Error('Invalid imported segment');
 const raw=await readFile(path);if(hash(raw)!==artifact.sha256)throw Error('Segment integrity mismatch');
 const rate=segment.sample_rate_hz,size=rate===96000?8192:4096;
 if(raw.length<size*4)continue;
 const pcm=new Float32Array(size);for(let i=0;i<size;i++)pcm[i]=raw.readFloatLE(i*4);
 observations.push(await measurePhonation(pcm,rate,{observationId:segment.segment_id+'-phonation',sessionId:summary.sessionId,attemptId:segment.segment_id,artifactId:artifact.id,sourceHashes:[artifact.sha256,...segment.source_artifacts.map(a=>a.sha256)],evidenceAt:null,windowStartSample:0,clockId:segment.source_clock_id,syncUncertaintyMs:segment.capture_sync_uncertainty_ms,sourceKind:source.declared_evidence_kind,processing:{automaticGainControl:null,noiseSuppression:null,echoCancellation:null}}));
}
const available=observations.some(row=>row.capabilities.measurement.status==='available');
process.stdout.write(JSON.stringify({status:available?'available':'insufficient-quality',reason:available?'Verified imported PCM analyzed; source physiology remains conditional':'No analyzed window has usable phonation quality',observations,sourceImportSha256:summary.sourceImportSha256,analyzedAt:new Date().toISOString(),evidenceTimeReason:'Absolute original capture time is not verified; fit/import timestamps do not establish evidence freshness',scope:'At most four original imported segments, first canonical frame per segment; dated analysis history only'}));
