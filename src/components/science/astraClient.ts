export interface AstraDecisionReceipt {
  status: 'succeeded';
  requestId: string;
  sessionId: string;
  runId: string;
  decision: { action: 'record' | 'rest'; experimentId: string | null; cue: string; explanation: string };
  designId: string | null;
  modelId?: string;
  sessionVersion?: number;
  provider: string;
  model: string;
  completedAt: string;
}

export interface AstraStatus {
  provider: { configured: boolean; available: boolean; provider: string; model: string; reason?: string };
  runId: string | null;
  sessionId: string | null;
  remainingCalls: number;
  callBudget: number;
  running: boolean;
  latest: AstraDecisionReceipt | null;
  error?: string;
}

export class AstraRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/astra/${path}`, { ...init, cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AstraRequestError(typeof body?.error === 'string' ? body.error : `Astra service unavailable (${response.status}).`, response.status);
  }
  if (!body || typeof body !== 'object') throw new Error('Astra returned an unreadable response.');
  return body as T;
}

export function getAstraStatus(signal?: AbortSignal): Promise<AstraStatus> {
  return request('status', { signal });
}

export function askAstra(requestId: string, goal: string): Promise<AstraDecisionReceipt> {
  return request('decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, ...(goal.trim() ? { goal: goal.trim() } : {}) }),
  });
}
