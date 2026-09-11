import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { importAcousticProbe } from './import-acoustic-probe.ts'
import { validateProbeMeasurement } from '../src/contracts/probes.ts'
import type { ProbeAttempt } from '../src/contracts/probes.ts'
import { makeFixture } from './acoustic-probe-fixture.ts'
test('known filter response, withheld fit state, and corrupt-byte rejection',async t=>{
 const root=await mkdtemp(join(tmpdir(),'probe-dsp-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const a=await makeFixture(root),out=join(root,'derived'),r=await importAcousticProbe(root,out)
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
})

test('the command line classifies with a pull receipt when given one and keeps the manifest rule without',async t=>{
 const root=await mkdtemp(join(tmpdir(),'probe-cli-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await makeFixture(join(root,'capture'))
 const run=(...args:string[])=>promisify(execFile)(process.execPath,['--experimental-strip-types','scripts/import-acoustic-probe.ts',join(root,'capture'),...args])
 const measured=async(name:string)=>JSON.parse(await readFile(join(root,name,'probe-measurement.json'),'utf8'))
 await run(join(root,'direct'));assert.equal((await measured('direct')).provenance,'software-fixture')
 // Input data: an archive and the receipt the app's pull writes for it, with a fictional device.
 const archive=Buffer.from('archive bytes for the review-import receipt test')
 const receipt={schemaVersion:'native-pull-receipt-2',name:'probe-12345678-1234-1234-1234-123456789abc.zip',bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex'),
  acquisition:{transport:'devicectl',connection:{transportType:'wired',tunnelState:'connected'},device:{coreDeviceId:'0B1C2D3E-4F50-4A6B-8C7D-9E0F1A2B3C4D',udid:null,productType:'iPhone16,1',osVersion:'26.0'}}}
 await writeFile(join(root,'original.zip'),archive);await writeFile(join(root,'usb-receipt.json'),JSON.stringify(receipt))
 await run(join(root,'pulled'),join(root,'usb-receipt.json'))
 assert.equal((await measured('pulled')).provenance,'human-recording')
 const kit=JSON.parse(await readFile(join(root,'pulled','probe-kit-observation.json'),'utf8'));assert.equal(kit.records[0].provenance.kind,'human-observation')
 await writeFile(join(root,'original.zip'),Buffer.concat([archive,Buffer.from('!')]))
 await assert.rejects(run(join(root,'changed'),join(root,'usb-receipt.json')),/does not match its pull receipt/)
})
