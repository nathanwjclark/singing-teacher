# Subjective personal cue memory

`createLearningRoutes({repo,dataRoot,json})` exposes local-only routes:

- `GET /api/learning/memory`: `{kind:"subjective-cue-memory",sessionId,entries,scope:"subjective_not_physiological_evidence"}`.
- `POST /api/learning/sensation` with only `{text}` (1..2000 characters): derives the current completed outcome and calls the actual session's `record_sensation`. Returns updated memory; errors409 retain retryable intent.

Each entry links `id`, `attemptId`, `modelId`, `runId`, `designId`, `text`, `createdAt`, `decisionId` and `cue`. Astra association requires its saved pointer/decision to match the outcome session and design. A missing matching decision leaves cue/decision null; no cue is invented. `readLearningMemory({dataRoot,sessionId})` lets the Astra orchestrator consume this history as subjective reports, not measured physiology.

Identical session/attempt/text is idempotent. Private durable intent precedes the scientific command; interrupted saves replay that identity. A rejected stale version is preserved and retried with a fresh versioned command. Files0600 live under learning-memory/0700. Reports change subjective session history, never physiological model parameters.

Verified with `PYTHONPATH=science/src python -m pytest science/tests/test_learning_memory.py -q`: actual48k native outcome through authenticated HTTP/update, then route POST, duplicate POST and GET; one subjective report added and model snapshot unchanged. Evidence is synthetic software execution; no learning-efficacy claim.
