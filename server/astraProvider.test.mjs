import test from 'node:test'
import assert from 'node:assert/strict'
import { createAstraProvider } from './astraProvider.mjs'

const schema = { type: 'object', properties: { action: { type: 'string', enum: ['rest'] } }, required: ['action'], additionalProperties: false }
const request = { instructions: 'Choose one supported action.', input: { discomfort: true }, schema }
const env = { OPENAI_API_KEY: 'fictional-test-secret' }
const result = (overrides = {}) => new Response(JSON.stringify({
  status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"action":"rest"}' }] }],
  usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16, unrelated: 'discard' }, ...overrides,
}), { headers: { 'content-type': 'application/json' } })

test('sends a bounded tool-free strict Responses request, returning only decision and usage', async () => {
  let calls = 0
  const provider = createAstraProvider({ env, fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.openai.com/v1/responses')
    assert.equal(options.headers.Authorization, 'Bearer fictional-test-secret')
    assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'gpt-6-astra')
    assert.equal(body.store, false)
    assert.deepEqual(body.tools, [])
    assert.equal(body.tool_choice, 'none')
    assert.equal(body.max_output_tokens, 2048)
    assert.deepEqual(body.text.format.schema, schema)
    assert.equal(body.text.format.strict, true)
    return result()
  } })
  assert.equal(provider.getProviderStatus().configured, true)
  assert.equal(JSON.stringify(provider.getProviderStatus()).includes(env.OPENAI_API_KEY), false)
  assert.deepEqual(await provider.generateDecision(request), {
    decision: { action: 'rest' }, provider: 'api', model: 'gpt-6-astra', usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 },
  })
  assert.equal(calls, 1)
})

test('missing credentials, unsupported provider/model, oversized input and invalid limits never call upstream', async () => {
  for (const config of [{}, { ...env, ASTRA_PROVIDER: 'codex' }, { ...env, ASTRA_MODEL: 'another-model' }]) {
    const provider = createAstraProvider({ env: config, fetchImpl: () => assert.fail('unexpected fetch') })
    assert.equal(provider.getProviderStatus().configured, false)
    await assert.rejects(provider.generateDecision(request), { code: 'provider_unconfigured' })
  }
  const provider = createAstraProvider({ env, fetchImpl: () => assert.fail('unexpected fetch') })
  await assert.rejects(provider.generateDecision({ ...request, input: 'a'.repeat(128 * 1024) }), { code: 'request_too_large' })
  await assert.rejects(provider.generateDecision({ ...request, input: undefined }), { code: 'invalid_request' })
  const malformed = createAstraProvider({ env: { ...env, ASTRA_MAX_OUTPUT_TOKENS: '999999' }, fetchImpl: () => assert.fail('unexpected fetch') })
  await assert.rejects(malformed.generateDecision(request), { code: 'invalid_configuration' })
})

test('rate limits and upstream errors are sanitized and never retried', async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0
    const provider = createAstraProvider({ env, fetchImpl: async () => { calls++; return new Response(env.OPENAI_API_KEY, { status }) } })
    await assert.rejects(provider.generateDecision(request), error => {
      assert.equal(error.message.includes(env.OPENAI_API_KEY), false)
      return ['authentication_failed', 'rate_limited', 'upstream_error'].includes(error.code)
    })
    assert.equal(calls, 1)
  }
  const provider = createAstraProvider({ env, fetchImpl: async () => { throw new Error(env.OPENAI_API_KEY) } })
  await assert.rejects(provider.generateDecision(request), error => error.code === 'connection_failed' && !error.message.includes(env.OPENAI_API_KEY))
})

test('incomplete, refusal, tool output, malformed JSON and oversized responses cannot become actions', async () => {
  for (const payload of [
    { status: 'incomplete' },
    { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'declined' }] }] },
    { output: [{ type: 'function_call', name: 'exec' }] },
    { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[]' }] }] },
    { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'broken' }] }] },
  ]) {
    const provider = createAstraProvider({ env, fetchImpl: async () => result(payload) })
    await assert.rejects(provider.generateDecision(request))
  }
  const provider = createAstraProvider({ env, fetchImpl: async () => new Response('a'.repeat(1024 * 1024 + 1)) })
  await assert.rejects(provider.generateDecision(request), { code: 'response_too_large' })
})

test('concurrency gate, caller cancellation and subsequent recovery', async () => {
  let calls = 0
  const provider = createAstraProvider({ env, fetchImpl: async (_url, { signal }) => {
    calls++
    if (calls > 1) return result()
    return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  } })
  const controller = new AbortController()
  const first = provider.generateDecision({ ...request, signal: controller.signal })
  await assert.rejects(provider.generateDecision(request), { code: 'provider_busy' })
  controller.abort()
  await assert.rejects(first, { code: 'aborted' })
  assert.deepEqual((await provider.generateDecision(request)).decision, { action: 'rest' })
  await assert.rejects(provider.generateDecision({ ...request, signal: controller.signal }), { code: 'aborted' })
  assert.equal(calls, 2)
})

test('deadline aborts the request and releases the concurrency gate', async () => {
  const provider = createAstraProvider({ env: { ...env, ASTRA_TIMEOUT_MS: '1000' }, fetchImpl: async (_url, { signal }) =>
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  })
  await assert.rejects(provider.generateDecision(request), { code: 'timeout', status: 504 })
})
