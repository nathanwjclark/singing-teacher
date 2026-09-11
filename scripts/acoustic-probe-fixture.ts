/** The software probe fixture: three drives through a known two-tap filter, labelled and marked as generated. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SOFTWARE_FIXTURE_CALIBRATION_ID } from '../src/contracts/probes.ts'
import type { ProbeAttempt } from '../src/contracts/probes.ts'
export async function makeFixture(root:string){
 await mkdir(root,{recursive:true});const count=3,length=4096,rate=16000,x=Buffer.alloc(count*length*4),y=Buffer.alloc(x.length);let seed=7
 for(let r=0;r<count;r++)for(let i=32;i<length-32;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;x.writeFloatLE((seed/2**32-.5)*.2,(r*length+i)*4)}
 // Three independent drives through the same known two-tap filter, H(z)=.6+.2z^-3.
 for(let r=0;r<count;r++)for(let i=0;i<length;i++)y.writeFloatLE(.6*x.readFloatLE((r*length+i)*4)+(i>=3?.2*x.readFloatLE((r*length+i-3)*4):0),(r*length+i)*4)
 const media=async(path:string,bytes:Buffer)=>{await writeFile(join(root,path),bytes);return{path,sha256:createHash('sha256').update(bytes).digest('hex'),byteCount:bytes.length,format:'float32-le' as const,channels:1 as const,sampleCount:bytes.length/4}}
 const a:ProbeAttempt={schemaVersion:'probe-native-1.0.0',captureId:'known-filter-fixture',provenance:'software-fixture',sampleRateHz:rate,drive:await media('drive.f32le',x),received:await media('received.f32le',y),segments:Array.from({length:count},(_,i)=>({driveStartSample:i*length,receivedStartSample:i*length,sampleCount:length})),timing:{support:'sample-aligned',uncertaintySeconds:0,method:'known fixture array indices; not hardware'},protocol:{id:'known-fir-test',bandHz:[300,6000],gain:.1},calibration:{id:SOFTWARE_FIXTURE_CALIBRATION_ID}}
 await writeFile(join(root,'manifest.json'),JSON.stringify(a));return a
}
