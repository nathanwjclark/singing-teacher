# Astra decision provider

The local server calls `generateDecision({instructions, input, schema, signal})`
from `server/astraProvider.mjs`. It returns `{decision, provider, model, usage}`.
The orchestrator must validate the decision against the offered experiment IDs
and current session version before executing or committing an action.

Set `OPENAI_API_KEY` in the server environment or its ignored `.env` file. Do not
paste credentials into browser settings or commit them. `ASTRA_PROVIDER=api`
(the default) and `ASTRA_PROVIDER=responses` select this provider. The model is
`gpt-6-astra`. The server sends a single request to
`https://api.openai.com/v1/responses`, with strict JSON-schema output, no tools,
no stored response, and no automatic retry or automatic provider fallback.

Each request is limited to 128 KiB input, 1 MiB response, 2,048 output tokens and
90 seconds by default. `ASTRA_MAX_OUTPUT_TOKENS` accepts 128–4,096;
`ASTRA_TIMEOUT_MS` accepts 1,000–180,000 milliseconds. The provider allows one
concurrent request per instance. The orchestration layer owns the durable
per-session call budget and idempotency. API billing is separate from ChatGPT
subscription usage. A timeout or cancellation does not guarantee that already
processed tokens will not be billed; the provider never automatically retries.

`getProviderStatus()` exposes configuration readiness only. It does not make an
API call and does not prove account/model access. It never returns a credential
or account identity. Successful calls return token usage. Errors discard raw
upstream bodies and network exception details to avoid exposing credentials.

## Codex sign-in

Official Codex SDK/App Server integrations can use Codex-managed ChatGPT sign-in.
That is different from sending an extracted Codex OAuth token to the public
Responses API. We do not read or export Codex credentials. The installed desktop
Codex runtime reported ChatGPT sign-in during this investigation; its PATH CLI
was older and failed to parse the desktop configuration.

The current decision provider implements the API route. Selecting
`ASTRA_PROVIDER=codex` returns an explicit unavailable status and never silently
switches to paid API calls. A Codex provider still requires its own tested runtime
isolation and integration; it is not claimed as implemented here.

Sources checked September 10, 2026:

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex App Server authentication](https://learn.chatgpt.com/docs/app-server#authentication-modes)
- [GPT-6 Astra API model](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

Run `node --test server/astraProvider.test.mjs` for deterministic transport,
failure, cancellation and spend-bound checks. These tests make no paid calls.

A bounded live check using the user-provided server credential succeeded on
September 10, 2026: a synthetic discomfort report returned `{"action":"rest"}`
from `gpt-6-astra` with strict structured output. Usage was 75 input tokens and
17 output tokens (92 total). No human recordings were submitted. This verifies
that credential/model/endpoint combination at test time, not coaching efficacy.
