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
  latestAttempt?: { requestId: string; status: 'running' | 'failed' | 'succeeded'; error?: string } | null;
  latestCurrent?: boolean;
  latestDesignStatus?: string | null;
  currentModelId?: string | null;
  error?: string;
}

export function isAstraDecision(value: unknown): value is AstraDecisionReceipt {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AstraDecisionReceipt>;
  return row.status === 'succeeded' && typeof row.requestId === 'string' &&
    typeof row.sessionId === 'string' && typeof row.runId === 'string' &&
    Boolean(row.decision && ['record', 'rest'].includes(row.decision.action) &&
      typeof row.decision.cue === 'string' && typeof row.decision.explanation === 'string');
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

export async function getAstraStatus(signal?: AbortSignal): Promise<AstraStatus> {
  const status = await request<AstraStatus>('status', { signal });
  // Older servers can return a running/failed attempt in the latest slot.
  return { ...status, latest: isAstraDecision(status.latest) ? status.latest : null };
}

export async function askAstra(requestId: string, goal: string): Promise<AstraDecisionReceipt> {
  const receipt = await request<unknown>('decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, ...(goal.trim() ? { goal: goal.trim() } : {}) }),
  });
  if (!isAstraDecision(receipt)) throw new Error('Astra did not return a completed decision. Refresh status before trying again.');
  return receipt;
}
