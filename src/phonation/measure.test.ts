import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measurePhonation} from './measure.ts';
import type {PhonationMetadata} from './types.ts';
const metadata:PhonationMetadata={observationId:'test',sessionId:'session',attemptId:'attempt',artifactId:'frame',sourceHashes:[],evidenceAt:'2026-01-01T00:00:00Z',windowStartSample:0,clockId:'sample-clock',syncUncertaintyMs:null,sourceKind:'development-fixture',processing:{automaticGainControl:false,noiseSuppression:false,echoCancellation:false}};
function wave(f0=180,decay=1){return Float32Array.from({length:4096},(_,i)=>{let x=0;for(let h=1;h<=10;h++)x+=.03/h**decay*Math.sin(2*Math.PI*h*f0*i/48000);return x})}
test('same extractor source invariance, finite acoustic slope and exact frame hash',async()=>{
 const pcm=wave(),r=await measurePhonation(pcm,48000,metadata),synthetic=await measurePhonation(pcm,48000,{...metadata,sourceKind:'engine-generated'});
 assert.equal(r.capabilities.measurement.status,'available');assert.deepEqual(r.descriptors,synthetic.descriptors);assert.equal(r.frameSha256,synthetic.frameSha256);
 assert.ok(Math.abs(r.descriptors.pitchHz.value!-180)<2);
 assert.ok(Math.abs(r.descriptors.harmonicSpectralSlopeDbOctave.value!+6.0206)<.5);
 const steeper=await measurePhonation(wave(180,2),48000,metadata);assert.ok(steeper.descriptors.harmonicSpectralSlopeDbOctave.value! < r.descriptors.harmonicSpectralSlopeDbOctave.value!-4);
 assert.equal(r.capabilities.sourceInference.status,'unsupported');
});
test('silence, clipping, noise, high pitch and nonfinite have explicit unavailable reasons',async()=>{
 let seed=7;const noise=Float32Array.from({length:4096},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return .1*(seed/2**32-.5)});
 for(const pcm of [new Float32Array(4096),new Float32Array(4096).fill(1),noise,wave(1000)]){
  const r=await measurePhonation(pcm,48000,metadata);assert.equal(r.capabilities.measurement.status,'insufficient-quality');assert.ok(Object.values(r.descriptors).every(d=>d.value===null&&d.reason));
 }
 const invalid=wave();invalid[0]=NaN;assert.equal((await measurePhonation(invalid,48000,metadata)).capabilities.measurement.status,'failed');
 assert.equal((await measurePhonation(wave(),22050,metadata)).capabilities.measurement.status,'unsupported');
});
test('disabled cancellation and insufficient harmonic support are distinct',async()=>{
 assert.equal((await measurePhonation(wave(),48000,metadata,{enabled:false})).capabilities.measurement.status,'disabled');
 const abort=new AbortController();abort.abort();assert.equal((await measurePhonation(wave(),48000,metadata,{signal:abort.signal})).capabilities.measurement.status,'timed-out');
 const sine=Float32Array.from({length:4096},(_,i)=>.1*Math.sin(2*Math.PI*180*i/48000));
 const r=await measurePhonation(sine,48000,metadata);assert.equal(r.capabilities.measurement.status,'available');assert.equal(r.descriptors.harmonicSpectralSlopeDbOctave.value,null);
});
test('asynchronous frame hash and analysis share one immutable buffer snapshot',async()=>{
 const pcm=wave(),expected=await measurePhonation(pcm,48000,metadata);
 const pending=measurePhonation(pcm,48000,metadata);pcm.fill(0);const actual=await pending;
 assert.equal(actual.frameSha256,expected.frameSha256);assert.deepEqual(actual.descriptors,expected.descriptors);
});

test('strongly time-varying nonstationary signal is not a stable phonation reference',async()=>{
 const chirp=Float32Array.from({length:4096},(_,i)=>{const t=i/48000;return .1*Math.sin(2*Math.PI*(100*t+6000*t*t))});
 const result=await measurePhonation(chirp,48000,metadata);assert.equal(result.capabilities.measurement.status,'insufficient-quality');
});

test('unknown absolute evidence time stays null and invalid timestamps reject',async()=>{
 const result=await measurePhonation(wave(),48000,{...metadata,evidenceAt:null});
 assert.equal(result.evidenceAt,null);assert.equal(result.capabilities.measurement.evidenceAt,null);assert.equal(result.capabilities.measurement.status,'available');
 await assert.rejects(measurePhonation(wave(),48000,{...metadata,evidenceAt:'invalid-date'}),/evidence time/);
});
