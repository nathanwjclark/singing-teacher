import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudioFrame, extractAudioMeasurement } from './audio.ts';
import { AmbientCalibrator } from './audioCalibration.ts';
import { validateRecord } from '../contracts/index.ts';
const wave = (hz: number, amplitude = 0.2) => Float32Array.from({ length: 4096 }, (_, i) => amplitude * Math.sin(i / 48000 * hz * Math.PI * 2));
test('canonical PCM extractor measures known tone, rejects invalid PCM and serializes valid provenance', () => {
  const pcm = wave(220);
  const measured = analyzeAudioFrame(pcm, 48000);
  assert.ok(Math.abs(measured.pitchHz! - 220) < 1);
  assert.ok(Math.abs(measured.centroidHz! - 220) < 5);
  assert.ok(Math.abs(measured.dbfs - 20 * Math.log10(0.2 / Math.sqrt(2))) < 0.1);
  assert.equal(analyzeAudioFrame(new Float32Array(4096), 48000).pitchHz, null);
  assert.throws(() => analyzeAudioFrame(Float32Array.from([NaN]), 48000));
  const record = extractAudioMeasurement(pcm, 48000, { id: 'm1', observationId: 'o1', artifactId: 'a1', startMs: 0, sourceKind: 'engine-generated', timebase: { clockId: 'pcm', origin: 'session-start', unit: 'ms', referenceClockId: null, offsetToReferenceMs: null, syncUncertaintyMs: 0 } });
  assert.equal(validateRecord(record).valid, true);
  assert.equal(record.measurements.find(m => m.name === 'pitchHz')!.value, measured.pitchHz);
});
test('ambient calibration waits for quiet windows, does not absorb singing, and flags clipping', () => {
  const calibrator = new AmbientCalibrator();
  const singing = wave(220);
  let result = calibrator.update(analyzeAudioFrame(singing, 48000), singing, 0);
  for (let i = 1; i < 35; i++) result = calibrator.update(analyzeAudioFrame(singing, 48000), singing, i * 100);
  assert.equal(result.state, 'collecting');
  let seed = 123;
  const quiet = Float32Array.from({ length: 4096 }, () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed / 2 ** 32 - 0.5) * 0.003; });
  for (let i = 35; i < 60; i++) result = calibrator.update(analyzeAudioFrame(quiet, 48000), quiet, i * 100);
  assert.equal(result.state, 'ready');
  assert.ok(result.noiseFloorDbfs! < -55);
  result = calibrator.update(analyzeAudioFrame(singing, 48000), singing, 6100);
  assert.ok(result.snrDb! > 35);
  const clipped = new Float32Array(4096).fill(1);
  assert.equal(calibrator.update(analyzeAudioFrame(clipped, 48000), clipped, 6200).clipping, true);
});

test('pitch spans the advertised voice range at device rates including 192 kHz', async () => {
  const { audioFrameSize } = await import('./audio.ts');
  for (const rate of [44100, 48000, 96000, 192000]) {
    for (const hz of [65, 80, 110, 220, 440, 880, 1100]) {
      const pcm = Float32Array.from({ length: audioFrameSize(rate) }, (_, i) => .2 * Math.sin(i / rate * hz * Math.PI * 2));
      const measured = analyzeAudioFrame(pcm, rate);
      assert.notEqual(measured.pitchHz, null, `${hz} Hz at ${rate} Hz`);
      assert.ok(Math.abs(measured.pitchHz! - hz) < 2, `${hz} Hz at ${rate} Hz: ${measured.pitchHz}`);
    }
  }
});
test('recorded pitch windows preserve sub-second note changes and silent gaps', async () => {
  const { recordingAudioWindows } = await import('./recordingMeasurements.ts');
  const rate = 48000;
  const pcm = Float32Array.from({ length: rate * 2 }, (_, i) => {
    const hz = [220, 440, 0, 330][Math.floor(i / (rate / 2))];
    return hz ? .2 * Math.sin(i / rate * hz * Math.PI * 2) : 0;
  });
  const rows = [...recordingAudioWindows(pcm, rate)].map(window => ({ time: window.startMs, pitch: analyzeAudioFrame(window.waveform, rate).pitchHz }));
  assert.equal(rows.length, 20);
  for (const [time, expected] of [[200, 220], [700, 440], [1200, null], [1700, 330]] as const) {
    const result = rows.find(row => row.time === time)!;
    if (expected === null) assert.equal(result.pitch, null);
    else assert.ok(Math.abs(result.pitch! - expected) < 2);
  }
});

test('sensitive live meter detects quiet voices without changing canonical measurements or voicing noise', async () => {
  const { livePitchMetrics, pitchStatus, LIVE_PITCH_MIN_DBFS } = await import('./audio.ts');
  for (const hz of [80, 220, 440, 880]) for (const db of [-62, -72, -77]) {
    const pcm = wave(hz, Math.SQRT2 * 10 ** (db / 20));
    const canonical = analyzeAudioFrame(pcm, 48000);
    const live = livePitchMetrics(pcm, 48000, canonical);
    assert.equal(canonical.pitchHz, null, 'canonical extractor retains its published floor');
    assert.ok(live.pitchHz !== null && Math.abs(live.pitchHz - hz) < 2, `${hz} Hz at ${db} dBFS`);
    assert.equal(pitchStatus(live, LIVE_PITCH_MIN_DBFS), 'Pitch detected');
  }
  let voiceSeed = 7;
  const noisyVoice = Float32Array.from({ length: 4096 }, (_, i) => {
    voiceSeed = (1664525 * voiceSeed + 1013904223) >>> 0;
    return 0.01 * (Math.SQRT2 * Math.sin(i / 48000 * 220 * Math.PI * 2) + (voiceSeed / 2 ** 32 - 0.5) * Math.sqrt(12));
  });
  const strict = analyzeAudioFrame(noisyVoice, 48000);
  assert.equal(strict.pitchHz, null);
  const sensitive = livePitchMetrics(noisyVoice, 48000, strict);
  assert.ok(sensitive.pitchHz !== null && Math.abs(sensitive.pitchHz - 220) < 6);
  let seed = 22;
  for (let i = 0; i < 30; i++) {
    const noise = Float32Array.from({ length: 4096 }, () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed / 2 ** 32 - 0.5) * 0.01; });
    assert.equal(livePitchMetrics(noise, 48000, analyzeAudioFrame(noise, 48000)).pitchHz, null);
  }
  for (const pcm of [new Float32Array(4096), wave(220, Math.SQRT2 * 10 ** (-82 / 20))]) {
    assert.equal(livePitchMetrics(pcm, 48000, analyzeAudioFrame(pcm, 48000)).pitchHz, null);
  }
});
