/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitLatestProbe, getProbeStatus, importLatestProbe } from './probeClient.ts';

test('fit binds original import and expected model; browser review bytes are never submitted', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/probe/fit');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { requestId: 'fit-1', importId: 'import-1', expectedModelId: 'model-2' });
    return Response.json({ accepted: true }, { status: 202 });
  };
  try { assert.equal((await fitLatestProbe('fit-1', 'import-1', 'model-2')).accepted, true); }
  finally { globalThis.fetch = original; }
});

test('import preserves request identity and status forwards abort signal', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    if (url === '/api/probe/import') assert.deepEqual(JSON.parse(String(init?.body)), { requestId: 'import-attempt' });
    else { assert.equal(url, '/api/probe/status'); assert.equal(init?.signal, controller.signal); }
    return Response.json({ accepted: true });
  };
  try { await importLatestProbe('import-attempt'); await getProbeStatus(controller.signal); }
  finally { globalThis.fetch = original; }
});

test('calibration rejection and unavailable service stay explicit', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Measured calibration is required.' }, { status: 409 });
    await assert.rejects(fitLatestProbe('fit-1', 'import-1', 'model-2'), /Measured calibration/);
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    await assert.rejects(getProbeStatus(), /unavailable \(503\)/);
  } finally { globalThis.fetch = original; }
});
