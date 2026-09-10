/** Additive probe interchange. KIT 1.0 semantics remain unchanged. */
export const PROBE_VERSION = 'probe-records-1.0.0' as const
export type ProbeProvenance = 'software-fixture' | 'physical-reference' | 'human-recording'
export interface ProbeMedia { path:string; sha256:string; byteCount:number; format:'float32-le'; channels:1; sampleCount:number }
export interface ProbeDefinition { id:string; bandHz:[number,number]; gain:number; [key:string]:unknown }
export interface ProbeCalibration { id?:string; levelCheck?:unknown; [key:string]:unknown }
export interface ProbeAttempt {
 schemaVersion:'probe-native-1.0.0'; captureId:string; provenance:ProbeProvenance; sampleRateHz:number;
 drive:ProbeMedia; received:ProbeMedia;
 segments:{driveStartSample:number;receivedStartSample:number|null;sampleCount:number}[];
 timing:{support:'sample-aligned'|'estimated'|'unknown';uncertaintySeconds:number|null;method:string};
 protocol:ProbeDefinition; calibration:ProbeCalibration; failures?:string[]; [key:string]:unknown
}
export interface ProbeForecast { schemaVersion:typeof PROBE_VERSION; kind:'probe-forecast'; id:string; frozenAt:string; modelId:string; operatorVersion:string; excitationHash:string; calibrationId:string; supportedChannels:string[]; nuisanceAssumptions:string[]; computeBudget:number; predictedArtifact:ProbeMedia|null }
export interface AcousticProbeMeasurement {
 schemaVersion:typeof PROBE_VERSION; kind:'acoustic-probe-measurement'; id:string; captureId:string; provenance:ProbeProvenance;
 captured:{value:true;reason:string}; responseUsable:{value:boolean;reason:string}; includedInFit:{value:false;reason:string;operatorVersion:null};
 units:'recorded-PCM-per-digital-drive'; sourceHashes:{manifest:string;drive:string;received:string};
 extractor:{version:string;configuration:Record<string,unknown>}; timing:ProbeAttempt['timing']; phaseUsable:boolean;
 quality:{repeats:number;clippedSamples:number;snrDb:number|null;flags:string[];validBandHz:[number,number]|null};
 response:{frequencyHz:number[];real:number[];imag:number[];magnitude:number[];coherence:(number|null)[];relativeStd:(number|null)[];valid:boolean[]};
 artifacts:{response:{path:string;sha256:string;byteCount:number};impulse:{path:string;sha256:string;byteCount:number}};
 calibration:ProbeCalibration; interpretation:string
}
/** Browser-safe structural checks. Raw-byte verification belongs to the importer, never this JSON reader. */
export function validateProbeMeasurement(value:unknown):{valid:boolean;errors:string[]} {
 const errors:string[]=[]
 const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
 const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
 const str=(v:unknown)=>typeof v==='string'&&!!v.trim()
 const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
 if(!obj(value))return{valid:false,errors:['Expected probe measurement object']}
 const r=value
 if(r.schemaVersion!==PROBE_VERSION||r.kind!=='acoustic-probe-measurement')errors.push('Unsupported probe record version/kind')
 if(!str(r.id)||!str(r.captureId)||!['software-fixture','physical-reference','human-recording'].includes(String(r.provenance)))errors.push('Missing identity/provenance')
 if(r.units!=='recorded-PCM-per-digital-drive')errors.push('Unsupported units')
 for(const k of ['captured','responseUsable','includedInFit'])if(!obj(r[k])||typeof r[k].value!=='boolean'||!str(r[k].reason))errors.push(`Invalid ${k} state`)
 if(obj(r.captured)&&r.captured.value!==true)errors.push('Not a verified capture')
 if(obj(r.includedInFit)&&(r.includedInFit.value!==false||r.includedInFit.operatorVersion!==null))errors.push('This producer cannot certify a fit')
 if(!obj(r.sourceHashes)||Object.keys(r.sourceHashes).length!==3||!['manifest','drive','received'].every(k=>obj(r.sourceHashes)&&digest(r.sourceHashes[k])))errors.push('Source SHA-256 lineage required')
 if(!obj(r.timing)||!['sample-aligned','estimated','unknown'].includes(String(r.timing.support))||!str(r.timing.method)||(r.timing.uncertaintySeconds!==null&&(!num(r.timing.uncertaintySeconds)||r.timing.uncertaintySeconds<0)))errors.push('Invalid timing metadata')
 if(typeof r.phaseUsable!=='boolean'||(r.phaseUsable&&(!obj(r.timing)||r.timing.support!=='sample-aligned'||!num(r.timing.uncertaintySeconds))))errors.push('Phase requires verified timing')
 if(!obj(r.extractor)||!str(r.extractor.version)||!obj(r.extractor.configuration)||!obj(r.calibration)||!str(r.interpretation))errors.push('Missing derivation/calibration metadata')
 const q=r.quality
 if(!obj(q)||!Number.isInteger(q.repeats)||!num(q.repeats)||q.repeats<0||!Number.isInteger(q.clippedSamples)||!num(q.clippedSamples)||q.clippedSamples<0||(q.snrDb!==null&&!num(q.snrDb))||!Array.isArray(q.flags)||!q.flags.every(str)||(q.validBandHz!==null&&(!Array.isArray(q.validBandHz)||q.validBandHz.length!==2||!q.validBandHz.every(num))))errors.push('Invalid quality record')
 const response=r.response
 const keys=['frequencyHz','real','imag','magnitude','coherence','relativeStd','valid']
 if(!obj(response)||!Array.isArray(response.frequencyHz)||response.frequencyHz.length>512||!keys.every(k=>Array.isArray(response[k])&&response[k].length===(response.frequencyHz as unknown[]).length))errors.push('Invalid response arrays')
 else {
  for(const key of ['frequencyHz','real','imag','magnitude'])if(!(response[key] as unknown[]).every(num))errors.push(`Invalid ${key}`)
  if(!(response.valid as unknown[]).every(x=>typeof x==='boolean')||!(response.coherence as unknown[]).every(x=>x===null||(num(x)&&x>=0&&x<=1))||!(response.relativeStd as unknown[]).every(x=>x===null||(num(x)&&x>=0)))errors.push('Invalid response quality')
  if(obj(r.responseUsable)&&r.responseUsable.value&&!(response.valid as unknown[]).some(Boolean))errors.push('Usable response requires valid bands')
 }
 if(!obj(r.artifacts)||!['response','impulse'].every(k=>obj(r.artifacts)&&obj(r.artifacts[k])&&str(r.artifacts[k].path)&&digest(r.artifacts[k].sha256)&&num(r.artifacts[k].byteCount)&&r.artifacts[k].byteCount>0))errors.push('Missing derived artifact lineage')
 return{valid:errors.length===0,errors}
}
