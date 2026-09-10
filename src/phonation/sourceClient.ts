export type SourceAction = 'analyze' | 'forecast' | 'score';

export interface SourceStage {
  status: string;
  result?: Record<string, unknown> | null;
  reason?: string | null;
}

export interface SourceInferenceStatus {
  enabled: boolean;
  running: boolean;
  fit: SourceStage;
  forecast: SourceStage;
  score: SourceStage;
  sessionId: string | null;
  runId: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/source/${path}`, { ...init, cache: 'no-store' });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result ? result.error : null;
    throw new Error(typeof error === 'string' ? error : `Optional source analysis unavailable (${response.status}).`);
  }
  if (!result || typeof result !== 'object') throw new Error('Optional source analysis returned an unreadable response.');
  return result as T;
}

export function getSourceStatus(signal?: AbortSignal): Promise<SourceInferenceStatus> {
  return request('status', { signal });
}

export function sourceAction(action: SourceAction): Promise<unknown> {
  return request(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}
