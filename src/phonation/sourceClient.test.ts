/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSourceStatus, sourceAction } from './sourceClient.ts';

test('source actions use server-retained media and configurations', async () => {
  const original = globalThis.fetch;
  try {
    for (const action of ['analyze', 'forecast', 'score'] as const) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, `/api/source/${action}`);
        assert.equal(init?.method, 'POST');
        assert.deepEqual(JSON.parse(String(init?.body)), {});
        return Response.json({ accepted: true });
      };
      await sourceAction(action);
    }
  } finally { globalThis.fetch = original; }
});

test('missing optional service and rejected evidence report errors without fallback measurements', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Unavailable', { status: 404 });
    await assert.rejects(getSourceStatus(), /unavailable \(404\)/);
    globalThis.fetch = async () => Response.json({ error: 'A new recording is required.' }, { status: 409 });
    await assert.rejects(sourceAction('score'), /new recording/);
  } finally { globalThis.fetch = original; }
});

test('status forwards abort signal for panel cleanup', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => { assert.equal(init?.signal, controller.signal); return Response.json({ enabled: false }); };
  try { assert.equal((await getSourceStatus(controller.signal)).enabled, false); }
  finally { globalThis.fetch = original; }
});
