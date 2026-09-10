import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { importAcousticProbe } from './import-acoustic-probe.ts'
import { validateProbeMeasurement } from '../src/contracts/probes.ts'
import type { ProbeAttempt } from '../src/contracts/probes.ts'
export async function makeFixture(root:string){
 await mkdir(root,{recursive:true});const count=3,length=4096,rate=16000,x=Buffer.alloc(count*length*4),y=Buffer.alloc(x.length);let seed=7
 for(let r=0;r<count;r++)for(let i=32;i<length-32;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;x.writeFloatLE((seed/2**32-.5)*.2,(r*length+i)*4)}
 // Three independent drives through the same known two-tap filter, H(z)=.6+.2z^-3.
 for(let r=0;r<count;r++)for(let i=0;i<length;i++)y.writeFloatLE(.6*x.readFloatLE((r*length+i)*4)+(i>=3?.2*x.readFloatLE((r*length+i-3)*4):0),(r*length+i)*4)
 const media=async(path:string,bytes:Buffer)=>{await writeFile(join(root,path),bytes);return{path,sha256:createHash('sha256').update(bytes).digest('hex'),byteCount:bytes.length,format:'float32-le' as const,channels:1 as const,sampleCount:bytes.length/4}}
 const a:ProbeAttempt={schemaVersion:'probe-native-1.0.0',captureId:'known-filter-fixture',provenance:'software-fixture',sampleRateHz:rate,drive:await media('drive.f32le',x),received:await media('received.f32le',y),segments:Array.from({length:count},(_,i)=>({driveStartSample:i*length,receivedStartSample:i*length,sampleCount:length})),timing:{support:'sample-aligned',uncertaintySeconds:0,method:'known fixture array indices; not hardware'},protocol:{id:'known-fir-test',bandHz:[300,6000],gain:.1},calibration:{id:'digital-fixture-no-human-playback'}}
 await writeFile(join(root,'manifest.json'),JSON.stringify(a));return a
}
test('known filter response, withheld fit state, and corrupt-byte rejection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'probe-dsp-')),a=await makeFixture(root),out=join(root,'derived'),r=await importAcousticProbe(root,out)
 assert.equal(r.responseUsable.value,true);assert.equal(r.includedInFit.value,false);assert.equal(r.provenance,'software-fixture');assert.equal(r.phaseUsable,true)
 const full=JSON.parse(await readFile(join(out,r.artifacts.response.path),'utf8'))
 let error=0,n=0;for(let i=0;i<full.frequencyHz.length;i++)if(full.valid[i]){const angle=-2*Math.PI*full.frequencyHz[i]*3/16000;error+=Math.hypot(full.real[i]-(.6+.2*Math.cos(angle)),full.imag[i]-.2*Math.sin(angle));n++}
 assert.ok(n>100);assert.ok(error/n<.0001,`known FIR complex error ${error/n}`)
 const malformed=[null,{}, {...r,response:null},{...r,response:{frequencyHz:[]}},{...r,quality:{flags:[null]}},{...r,includedInFit:{value:true,reason:'fake',operatorVersion:'fake'}}]
 for(const value of malformed)assert.equal(validateProbeMeasurement(value).valid,false)
 a.segments=a.segments.slice(0,1);await writeFile(join(root,'manifest.json'),JSON.stringify(a));const single=await importAcousticProbe(root,join(root,'single'));assert.equal(single.responseUsable.value,false);assert.ok(single.response.coherence.every(x=>x===null))
 a.failures=['user-stop'];a.segments[0].receivedStartSample=yLength(a)+1;await writeFile(join(root,'manifest.json'),JSON.stringify(a));const stopped=await importAcousticProbe(root,join(root,'stopped'));assert.equal(stopped.captured.value,true);assert.equal(stopped.responseUsable.value,false);assert.equal(stopped.response.frequencyHz.length,0)
 function yLength(value:ProbeAttempt){return value.received.sampleCount}
 a.failures=[];a.segments[0].receivedStartSample=null;await writeFile(join(root,'manifest.json'),JSON.stringify(a));const unknown=await importAcousticProbe(root,join(root,'unknown'));assert.equal(unknown.captured.value,true);assert.equal(unknown.responseUsable.value,false)
 const bytes=await readFile(join(root,'received.f32le'));bytes[10]^=1;await writeFile(join(root,'received.f32le'),bytes);await assert.rejects(importAcousticProbe(root,out),/hash\/byte mismatch/)
 console.log(`Fixture report: ${out}/probe-measurement.json`)
})
