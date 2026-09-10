/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askAstra, getAstraStatus } from './astraClient.ts';

test('decision request preserves retry identity and sends only goal to same-origin server', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/astra/decide');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(init?.body)), { requestId: 'same-attempt', goal: 'comfortable brightness' });
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    return Response.json({ requestId: 'same-attempt', status: 'succeeded' });
  };
  try { assert.equal((await askAstra('same-attempt', ' comfortable brightness ')).requestId, 'same-attempt'); }
  finally { globalThis.fetch = original; }
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
