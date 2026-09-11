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
  setup?: ProbeSetupStatus;
}

export interface ProbeSetupReceipt {
  setupId: string; importId: string; createdAt: string; configurationSha256: string; profileSha256: string;
  packageSha256: string; manifestSha256: string; provenance: string; calibrationKind: string; calibrationId: string;
  routeId: string; pose: string; trialId: string; frequencyHz: number[]; comparison: string;
  placement: ProbePlacement; profile: ProbeProfile;
  evidence: { path: string; sha256: string; byteCount: number }[];
  eligible: true; includedInFit: false; calibrationAuthenticityVerified: false;
}
export interface ProbePlacement { placement_id: string; coordinate_frame: string; source_m: number[]; microphone_m: number[]; mouth_m: number[] }
export interface ProbeProfile { JA: number; gain: number; direct_gain: number; coupling_gain: number; delay_s: number }
export interface ProbeSetupStatus {
  setup: ProbeSetupReceipt | null;
  capture: { importId: string; captureId: string; manifestSha256: string; provenance: string; declaredProvenance: string; pose: string | null; placementId: string | null; routeSignature: string | null } | null;
  legacyConfiguration: boolean;
  error?: string;
}
export interface ProbeSetupRequest {
  requestId: string; importId: string; manifestSha256: string; packageBase64: string;
  evidence: { name: string; base64: string }[]; placement: ProbePlacement; profile: ProbeProfile; trialId: string; pose: string;
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
export function saveProbeSetup(body: ProbeSetupRequest): Promise<{ saved: true; setup: ProbeSetupReceipt }> { return request('setup', body); }
export function fitLatestProbe(requestId: string, importId: string, expectedModelId: string): Promise<{ accepted: true }> {
  return request('fit', { requestId, importId, expectedModelId });
}
