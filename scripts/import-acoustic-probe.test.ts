import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importAcousticProbe } from './import-acoustic-probe.ts'
import { validateProbeMeasurement } from '../src/contracts/probes.ts'
import type { ProbeAttempt } from '../src/contracts/probes.ts'
import { makeFixture } from './acoustic-probe-fixture.ts'
test('known filter response, withheld fit state, and corrupt-byte rejection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'probe-dsp-')),a=await makeFixture(root),out=join(root,'derived'),r=await importAcousticProbe(root,out)
 assert.equal(r.responseUsable.value,true);assert.equal(r.includedInFit.value,false);assert.equal(r.provenance,'software-fixture');assert.equal(r.phaseUsable,true)
 const records=JSON.parse(await readFile(join(out,'probe-records.json'),'utf8')).records
 assert.equal(records[0].id,`${r.id}/definition`);assert.equal(records[0].kind,'probe-definition')
 assert.equal(records[1].id,`${r.id}/calibration`);assert.equal(records[1].kind,'probe-calibration')
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
