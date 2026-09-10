const ENDPOINT = 'https://api.openai.com/v1/responses'
const MODEL = 'gpt-6-astra'
const MAX_INPUT_BYTES = 128 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024

export class AstraProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.name = 'AstraProviderError'
    this.code = code
    this.status = status
  }
}

function boundedInteger(value, fallback, min, max) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AstraProviderError('invalid_configuration', 'Astra request limits are invalid.', 503)
  }
  return number
}

async function readBoundedJson(response) {
  if (!response.body) throw new AstraProviderError('empty_response', 'Astra returned an empty response.')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new AstraProviderError('response_too_large', 'Astra response exceeded the size limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new AstraProviderError('invalid_response', 'Astra returned invalid JSON.')
  }
}

function extractDecision(response) {
  if (response.status !== 'completed') {
    throw new AstraProviderError('incomplete_response', 'Astra did not complete the decision. No action was selected.')
  }
  const texts = []
  for (const item of response.output ?? []) {
    if (item.type === 'reasoning') continue
    if (item.type !== 'message' || item.role !== 'assistant') {
      throw new AstraProviderError('unexpected_output', 'Astra returned an unexpected output type.')
    }
    for (const content of item.content ?? []) {
      if (content.type === 'refusal') {
        throw new AstraProviderError('refusal', 'Astra declined to produce this decision.', 422)
      }
      if (content.type !== 'output_text' || typeof content.text !== 'string') {
        throw new AstraProviderError('unexpected_output', 'Astra returned unexpected message content.')
      }
      texts.push(content.text)
    }
  }
  if (texts.length !== 1) throw new AstraProviderError('invalid_decision', 'Astra did not return one structured decision.')
  let decision
  try { decision = JSON.parse(texts[0]) } catch {
    throw new AstraProviderError('invalid_decision', 'Astra returned an invalid structured decision.')
  }
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new AstraProviderError('invalid_decision', 'Astra decision must be an object.')
  }
  return decision
}

function usageSummary(usage) {
  if (!usage || typeof usage !== 'object') return null
  const result = {}
  for (const name of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(usage[name]) && usage[name] >= 0) result[name] = usage[name]
  }
  return result
}

/** One bounded, tool-free API request. Caller validates decision semantics before committing an action. */
export function createAstraProvider({ env = process.env, fetchImpl = fetch } = {}) {
  let inFlight = false
  const selectedProvider = env.ASTRA_PROVIDER || 'api'
  const key = env.OPENAI_API_KEY?.trim()
  const model = env.ASTRA_MODEL || MODEL
  const configured = ['api', 'responses'].includes(selectedProvider) && Boolean(key) && model === MODEL

  function getProviderStatus() {
    return {
      configured,
      available: configured,
      provider: 'api',
      model,
      readiness: configured ? 'configured_not_live_verified' : 'unconfigured',
      ...(!configured ? { reason: selectedProvider === 'codex'
        ? 'Codex ChatGPT authentication requires a separately configured supported Codex runtime. Select api and set OPENAI_API_KEY for this provider.'
        : model !== MODEL ? 'ASTRA_MODEL must be gpt-6-astra.'
          : !['api', 'responses'].includes(selectedProvider) ? 'ASTRA_PROVIDER must be api or responses.'
            : 'Set OPENAI_API_KEY in the server environment.' } : {}),
    }
  }

  async function generateDecision({ instructions, input, schema, signal } = {}) {
    if (!configured) throw new AstraProviderError('provider_unconfigured', getProviderStatus().reason, 503)
    if (inFlight) throw new AstraProviderError('provider_busy', 'An Astra decision is already running. Wait for its result.', 409)
    if (typeof instructions !== 'string' || !instructions.trim() || !schema || schema.type !== 'object') {
      throw new AstraProviderError('invalid_request', 'Instructions and an object JSON schema are required.', 400)
    }
    let serializedInput
    try { serializedInput = typeof input === 'string' ? input : JSON.stringify(input) } catch {
      throw new AstraProviderError('invalid_request', 'Astra input must be JSON serializable.', 400)
    }
    if (typeof serializedInput !== 'string' || !serializedInput.trim()) {
      throw new AstraProviderError('invalid_request', 'Astra input is required.', 400)
    }
    const timeoutMs = boundedInteger(env.ASTRA_TIMEOUT_MS, 90000, 1000, 180000)
    const maxOutputTokens = boundedInteger(env.ASTRA_MAX_OUTPUT_TOKENS, 2048, 128, 4096)
    let body
    try {
      body = JSON.stringify({
        model,
        instructions,
        input: serializedInput,
        store: false,
        tools: [],
        tool_choice: 'none',
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_schema', name: 'singing_coach_decision', strict: true, schema } },
      })
    } catch {
      throw new AstraProviderError('invalid_request', 'Astra schema must be JSON serializable.', 400)
    }
    if (Buffer.byteLength(body) > MAX_INPUT_BYTES) {
      throw new AstraProviderError('request_too_large', 'Astra decision context exceeds 128 KiB.', 413)
    }
    if (signal?.aborted) throw new AstraProviderError('aborted', 'Astra decision was cancelled.', 499)
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    inFlight = true
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        const code = response.status === 401 || response.status === 403 ? 'authentication_failed'
          : response.status === 429 ? 'rate_limited' : 'upstream_error'
        const message = code === 'authentication_failed' ? 'Astra API authentication or model access failed. Check the server credential and project access.'
          : code === 'rate_limited' ? 'Astra API usage or rate limit reached. No automatic retry was made.'
            : `Astra API request failed (HTTP ${response.status}). No automatic retry was made.`
        throw new AstraProviderError(code, message, response.status === 429 ? 429 : 502)
      }
      const payload = await readBoundedJson(response)
      return { decision: extractDecision(payload), provider: 'api', model, usage: usageSummary(payload.usage) }
    } catch (error) {
      if (error instanceof AstraProviderError) throw error
      if (controller.signal.aborted) {
        throw new AstraProviderError(signal?.aborted ? 'aborted' : 'timeout',
          signal?.aborted ? 'Astra decision was cancelled.' : 'Astra decision timed out. No automatic retry was made.', signal?.aborted ? 499 : 504)
      }
      throw new AstraProviderError('connection_failed', 'Could not reach the Astra API. No automatic retry was made.')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      inFlight = false
    }
  }
  return { generateDecision, getProviderStatus }
}

let defaultProvider
function provider() { return defaultProvider ??= createAstraProvider() }
export function generateDecision(request) { return provider().generateDecision(request) }
export function getProviderStatus() { return provider().getProviderStatus() }
