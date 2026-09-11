/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlAction, getControlStatus } from './controlClient.ts';

test('control actions post no body and use the server-held cue and recordings', async () => {
  const original = globalThis.fetch;
  try {
    for (const action of ['forecast', 'score', 'stop'] as const) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, `/api/control/${action}`);
        assert.equal(init?.method, 'POST');
        assert.equal(init?.body, undefined);
        return Response.json({ accepted: true });
      };
      await controlAction(action);
    }
  } finally { globalThis.fetch = original; }
});

test('rejections surface the server reason and unreadable replies fail', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Ask Astra for a recording decision first' }, { status: 409 });
    await assert.rejects(controlAction('forecast'), /Ask Astra/);
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    await assert.rejects(getControlStatus(), /unavailable \(503\)/);
  } finally { globalThis.fetch = original; }
});
