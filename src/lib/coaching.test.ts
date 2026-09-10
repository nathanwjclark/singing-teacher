/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTips } from './coaching.ts';
import type { TrackingFrame } from '../types.ts';

const frame = (metrics: Partial<TrackingFrame['metrics']> = {}): TrackingFrame => ({
  face: [{ x: 0.5, y: 0.5 }],
  pose: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 })),
  metrics: { mouthOpen: 0.25, headTilt: 0, shoulderTilt: 0, brightness: 125, motion: 0, ...metrics },
  timestamp: 0,
});

test('no camera and lost face provide setup instructions without anatomical inference', () => {
  assert.equal(getTips(null)[0].id, 'start');
  const lost = frame({ mouthOpen: 0, headTilt: 20, shoulderTilt: 20 });
  lost.face = [];
  assert.deepEqual(getTips(lost).map(tip => tip.id), ['find-face']);
});

test('three physical cues are prioritized and mouth opening is conditional on singing a vowel', () => {
  const tips = getTips(frame({ mouthOpen: 0.13, headTilt: -15, shoulderTilt: 12 }));
  assert.deepEqual(tips.map(tip => tip.id), ['head-level', 'shoulder-level', 'mouth-open']);
  assert.match(tips[2].detail, /sustained vowel/);
  assert.match(tips[2].detail, /between phrases/);
});

test('depth cues span regions and unreliable facial angles suppress lip and elevation cues', () => {
  const tips = getTips(frame({ headYaw: 30, headPitch: 25, shoulderDepth: 0.19, torsoLean: 19, lipWidth: 1.2, jawAsymmetry: 0.5, shoulderElevation: 0.1 }));
  assert.equal(tips.length, 3);
  assert.equal(new Set(tips.map(tip => tip.region)).size, 3);
  assert.ok(tips.some(tip => tip.id === 'shoulder-rotation'));
  assert.ok(tips.some(tip => tip.id === 'torso-lean'));
  assert.ok(tips.every(tip => tip.muscles?.length));
  assert.ok(!tips.some(tip => ['lip-spread', 'jaw-asymmetry', 'shoulder-elevation'].includes(tip.id)));
  assert.equal(getTips(frame({ distanceCm: 25, torsoLean: 19 }))[0].id, 'camera-close');
});

test('missing or low confidence shoulders never produce shoulder correction', () => {
  const missing = frame({ shoulderTilt: 25 });
  missing.pose = [];
  assert.deepEqual(getTips(missing).map(tip => tip.id), ['show-shoulders']);
  const obscured = frame({ shoulderTilt: -25 });
  obscured.pose[11].visibility = 0.1;
  assert.deepEqual(getTips(obscured).map(tip => tip.id), ['show-shoulders']);
});

test('poor lighting takes precedence over unreliable physical cues', () => {
  assert.deepEqual(getTips(frame({ brightness: 20, mouthOpen: 0, headTilt: 25 })).map(tip => tip.id), ['lighting']);
});

test('threshold boundaries avoid unnecessary corrections and nonfinite data does not trigger them', () => {
  assert.equal(getTips(frame({ mouthOpen: 0.24, headTilt: 9, shoulderTilt: -7 }))[0].id, 'keep-exploring');
  const tips = getTips(frame({ mouthOpen: Number.NaN, headTilt: Number.POSITIVE_INFINITY, shoulderTilt: Number.NaN }));
  assert.deepEqual(tips.map(tip => tip.id), ['measurement-unavailable']);
  assert.deepEqual(getTips(frame({ shoulderTilt: Number.NaN })).map(tip => tip.id), ['show-shoulders']);
});

test('idle and closed mouths never receive vowel opening advice', () => {
  assert.equal(getTips(frame({mouthOpen:0}))[0].id,'no-singing');
  assert.equal(getTips(frame({mouthOpen:0.02}))[0].title,'No singing detected');
  assert.equal(getTips(frame({mouthOpen:0.14}),{singing:false})[0].id,'no-singing');
  assert.ok(getTips(frame({mouthOpen:0.14}),{singing:true}).some(tip=>tip.id==='mouth-open'));
});

test('green resolution requires an observed change; signal loss gets the normal fade', async () => {
  const {resolvedTipIds} = await import('./coaching.ts');
  const {updateRecentTips} = await import('./recentTips.ts');
  const before=frame({mouthOpen:.14,headTilt:15,shoulderTilt:12});before.timestamp=100;
  const after=frame({mouthOpen:.3,headTilt:3,shoulderTilt:2});after.timestamp=200;
  const initial=updateRecentTips([],getTips(before,{limit:12,uniqueRegions:false}),1000);
  const resolved=resolvedTipIds(before,after);
  assert.deepEqual([...resolved].sort(),['head-level','mouth-open','shoulder-level']);
  const improved=updateRecentTips(initial,getTips(after),1250,resolved);
  assert.ok(improved.every(tip=>tip.resolved && !tip.active));
  assert.equal(updateRecentTips(improved,[],2750).length,0);
  const lost={...after,face:[]};
  assert.equal(resolvedTipIds(before,lost).size,0);
  assert.equal(resolvedTipIds(before,before).size,0);
  const closed=frame({mouthOpen:0});closed.timestamp=200;
  assert.equal(resolvedTipIds(before,closed).size,0);
  const paused=updateRecentTips(initial,getTips(null),1250);
  assert.ok(paused.every(tip=>!tip.resolved && !tip.active));
  assert.equal(updateRecentTips(paused,[],3000).length,3);
  assert.equal(updateRecentTips(paused,[],6250).length,0);
  const occluded={...after,pose:[]};
  assert.ok(!resolvedTipIds(before,occluded).has('shoulder-level'));
});

test('voice activity expires when the microphone stops producing observations', async () => {
  const {hasRecentVoice}=await import('./voiceActivity.ts');
  assert.equal(hasRecentVoice({voiced:true,at:1000},1400),true);
  assert.equal(hasRecentVoice({voiced:true,at:1000},1700),false);
  assert.equal(hasRecentVoice({voiced:false,at:1000},1100),false);
  assert.equal(hasRecentVoice(null,1100),false);
});

test('partly open singing vowels keep jaw guidance through brief pitch dropouts, then resolve on opening', async () => {
  const {updateVoiceActivity,hasRecentVoice}=await import('./voiceActivity.ts');
  const {resolvedTipIds}=await import('./coaching.ts');
  let voice=updateVoiceActivity(null,true,1000);
  for (const now of [1100,1200,1400,1600]) {
    voice=updateVoiceActivity(voice,false,now);
    for (const mouthOpen of [.12,.15,.22]) {
      const cues=getTips(frame({mouthOpen}),{singing:hasRecentVoice(voice,now)});
      assert.ok(cues.some(cue=>cue.id==='mouth-open'));
    }
  }
  voice=updateVoiceActivity(voice,false,1700);
  assert.equal(getTips(frame({mouthOpen:.18}),{singing:hasRecentVoice(voice,1700)})[0].id,'no-singing');
  const before=frame({mouthOpen:.18});before.timestamp=100;
  const after=frame({mouthOpen:.3});after.timestamp=200;
  assert.ok(resolvedTipIds(before,after).has('mouth-open'));
  assert.equal(getTips(after)[0].id,'keep-exploring');
});

test('near-closed lip jitter cannot activate vowel guidance, even with a held voice', async () => {
  const {isMouthOpen}=await import('./coaching.ts');
  const {hasRecentVoice,updateVoiceActivity}=await import('./voiceActivity.ts');
  const voice=updateVoiceActivity(updateVoiceActivity(null,true,1000),false,1300);
  let mouthWasOpen=false;
  for (const mouthOpen of [0,.035,.06,.081,.099,.08]) {
    assert.equal(getTips(frame({mouthOpen}),{singing:hasRecentVoice(voice,1300),mouthWasOpen})[0].id,'no-singing');
    mouthWasOpen=isMouthOpen(mouthOpen,mouthWasOpen);
    assert.equal(mouthWasOpen,false);
  }
  for (const mouthOpen of [.12,.095,.085]) {
    assert.ok(getTips(frame({mouthOpen}),{singing:true,mouthWasOpen}).some(tip=>tip.id==='mouth-open'));
    mouthWasOpen=isMouthOpen(mouthOpen,mouthWasOpen);
    assert.equal(mouthWasOpen,true);
  }
  for (const mouthOpen of [.08,.09,.07]) {
    assert.equal(getTips(frame({mouthOpen}),{singing:true,mouthWasOpen})[0].id,'no-singing');
    mouthWasOpen=isMouthOpen(mouthOpen,mouthWasOpen);
    assert.equal(mouthWasOpen,false);
  }
});
