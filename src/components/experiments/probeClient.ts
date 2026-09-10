import type { AcousticProbeMeasurement } from '../../contracts/probes.ts';

export interface ProbeStatus {
  busy: boolean;
  currentModelId: string | null;
  canFit: boolean;
  fitBlockedReason: string | null;
  import: { importId: string; eligible: boolean; reasons: string[]; archiveSha256: string; includedInFit: false } | null;
  fit: { importId: string; modelId: string | null; parentModelId: string | null; status: string;
    includedInFit: boolean; probeRecords: { id: string; included_in_fit: boolean; reason: string }[];
    score: { joint_discrepancy: number } | null; baselineScore: { joint_discrepancy: number } | null;
    nativeCalls: number; adoptionStatus: string } | null;
  measurement: AcousticProbeMeasurement | null;
  error: string | null;
}

async function request<T>(action: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/probe/${action}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : `Probe service unavailable (${response.status}).`);
  if (!result || typeof result !== 'object') throw new Error('Probe service returned an unreadable response.');
  return result as T;
}

export function getProbeStatus(signal?: AbortSignal): Promise<ProbeStatus> { return request('status', undefined, signal); }
export function importLatestProbe(requestId: string): Promise<{ accepted: true }> { return request('import', { requestId }); }
export function fitLatestProbe(requestId: string, importId: string, expectedModelId: string): Promise<{ accepted: true }> {
  return request('fit', { requestId, importId, expectedModelId });
}
