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
  const tips = getTips(frame({ mouthOpen: 0.05, headTilt: -15, shoulderTilt: 12 }));
  assert.deepEqual(tips.map(tip => tip.id), ['mouth-open', 'head-level', 'shoulder-level']);
  assert.match(tips[0].detail, /sustained vowel/);
  assert.match(tips[0].detail, /between phrases/);
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
  assert.equal(getTips(frame({ mouthOpen: 0.12, headTilt: 9, shoulderTilt: -7 }))[0].id, 'keep-exploring');
  const tips = getTips(frame({ mouthOpen: Number.NaN, headTilt: Number.POSITIVE_INFINITY, shoulderTilt: Number.NaN }));
  assert.deepEqual(tips.map(tip => tip.id), ['measurement-unavailable']);
  assert.deepEqual(getTips(frame({ shoulderTilt: Number.NaN })).map(tip => tip.id), ['show-shoulders']);
});
