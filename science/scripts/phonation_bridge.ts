#!/usr/bin/env -S node --experimental-strip-types
import {measurePhonation} from '../../src/phonation/measure.ts';
let raw='';
for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>2_000_000)throw Error('Phonation bridge input exceeds2MB');}
const request=JSON.parse(raw);
if(!Array.isArray(request.pcm)||request.pcm.length>8192||!request.pcm.every((x:unknown)=>typeof x==='number'&&Number.isFinite(x)))throw Error('Finite bounded PCM array required');
// Offline scientific extraction uses the extractor's maximum deadline; the
// 200 ms default is for live feedback and made results depend on host load.
process.stdout.write(JSON.stringify(await measurePhonation(Float32Array.from(request.pcm),request.sampleRate,request.metadata,{deadlineMs:2000})));
