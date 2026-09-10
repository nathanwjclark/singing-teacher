/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askAstra, getAstraStatus, isAstraDecision } from './astraClient.ts';

const receipt = { requestId: 'same-attempt', status: 'succeeded', sessionId: 'session-1', runId: 'run-1',
  decision: { action: 'record', experimentId: 'e-1', cue: 'Sing ah comfortably.', explanation: 'Compare predicted responses.' } };

test('decision request preserves retry identity and sends only goal to same-origin server', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/astra/decide');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(init?.body)), { requestId: 'same-attempt', goal: 'comfortable brightness' });
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    return Response.json(receipt);
  };
  try { assert.equal((await askAstra('same-attempt', ' comfortable brightness ')).requestId, 'same-attempt'); }
  finally { globalThis.fetch = original; }
});

test('running and failed attempt receipts cannot become renderable decisions', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of ['running', 'failed']) {
      const attempt = { requestId: 'incomplete', status, error: 'Provider failed.' };
      assert.equal(isAstraDecision(attempt), false);
      globalThis.fetch = async () => Response.json({ latest: attempt, latestAttempt: attempt, latestCurrent: false });
      const result = await getAstraStatus();
      assert.equal(result.latest, null);
      assert.equal(result.latestAttempt?.status, status);
      await assert.rejects(askAstra('incomplete', ''), /completed decision/);
    }
  } finally { globalThis.fetch = original; }
});

test('historical decision retains text but never regains current validity from receipt alone', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ latest: receipt, latestCurrent: false, latestDesignStatus: 'stale', currentModelId: 'new-model' });
    const result = await getAstraStatus();
    assert.equal(result.latest?.decision.cue, receipt.decision.cue);
    assert.equal(result.latestCurrent, false);
    assert.equal(result.latestDesignStatus, 'stale');
    assert.equal(result.currentModelId, 'new-model');
  } finally { globalThis.fetch = original; }
});

test('unavailable provider and malformed responses are errors, never fallback decisions', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Call budget exhausted.' }, { status: 429 });
    await assert.rejects(askAstra('budget-attempt', ''), /Call budget exhausted/);
    globalThis.fetch = async () => new Response('<html>Unavailable</html>', { status: 502 });
    await assert.rejects(getAstraStatus(), /unavailable \(502\)/);
    globalThis.fetch = async () => Response.json(null);
    await assert.rejects(getAstraStatus(), /unreadable response/);
  } finally { globalThis.fetch = original; }
});

test('status passes cancellation through to fetch', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    return Response.json({ running: false });
  };
  try { assert.equal((await getAstraStatus(controller.signal)).running, false); }
  finally { globalThis.fetch = original; }
});
