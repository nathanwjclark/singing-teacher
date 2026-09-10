export interface TeachingAsset { name: string; sha256: string; byteLength: number; url: string }
export interface TeachingMeasurement { name: string; value: number | null; unit: string; missingReason?: string }
export interface TeachingCanonical { measurement?: { measurements?: TeachingMeasurement[] } }
export interface TeachingSide {
  experimentId: string; pose: string; controls: { JA: number; f0_hz: number; gain: number };
  prediction: { canonical?: TeachingCanonical; features?: Record<string, number | null>; missingReason?: string };
  geometry?: { svg?: TeachingAsset; data?: TeachingAsset }; audio?: TeachingAsset;
}
export interface TeachingResult {
  schemaVersion: 'visual-teaching-model-1'; demonstrationId: string; demonstrationVersion: string;
  evidenceMode: 'model-prediction'; runId: string; sessionId: string; modelId: string; designId: string;
  attemptId: string; targetObservationId: string; committedAt: string; forecastSha256: string;
  hypothesisId: string; hypothesisCount: number;
  capabilities: Record<'geometry' | 'acoustics' | 'synthesis', { available: boolean; reason?: string }>;
  before: TeachingSide; after: TeachingSide; assumptions: string[];
  playback?: {gainApplied: number; normalization: string; storedMeasurementsUnchanged: boolean};
  outcome?: { evidenceMode: 'recorded-result'; attemptId: string; observedAt: string; observationId: string;
    sourceKind: string; canonical?: TeachingCanonical; features?: Record<string, number | null>;
    predictionErrors?: unknown; modelUpdated: boolean; originalAudio: { available: boolean; reason?: string; asset?: TeachingAsset }; interpretation: string };
}
export interface TeachingStatus {
  enabled: boolean; audioEnabled: boolean; status: string; current: boolean; reason?: string;
  currentModelId?: string; currentDesignId?: string; result?: TeachingResult;
}
async function jsonRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {...init, cache: 'no-store'});
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Teaching view unavailable (${response.status}).`);
  if (!data || typeof data !== 'object') throw new Error('Teaching view returned an unreadable response.');
  return data;
}
export async function getTeachingStatus(signal?: AbortSignal): Promise<TeachingStatus> {
  const value = await jsonRequest('/api/teaching/status', {signal}) as TeachingStatus;
  if (typeof value.status !== 'string' || typeof value.current !== 'boolean') throw new Error('Teaching status is incomplete.');
  if (value.result && (value.result.schemaVersion !== 'visual-teaching-model-1' || !value.result.before || !value.result.after
    || !value.result.capabilities || !Array.isArray(value.result.assumptions))) throw new Error('Teaching model result is incomplete.');
  return value;
}
export function prepareTeaching(demonstrationId: string, modelId: string, designId: string, signal?: AbortSignal) {
  return jsonRequest('/api/teaching/prepare', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({demonstrationId, modelId, designId}), signal});
}

/** Only byte-verified local artifacts can become media sources. */
export async function teachingAssetBlob(asset: TeachingAsset, signal?: AbortSignal): Promise<Blob> {
  if (!asset || !/^\/api\/teaching\/asset\?/.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256)
    || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > 8 * 1024 * 1024) throw new Error('Teaching media has invalid provenance.');
  const response = await fetch(asset.url, {signal, cache: 'no-store', redirect: 'error'});
  if (!response.ok || !response.body) throw new Error('Teaching media is unavailable. The text explanation remains available.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > asset.byteLength) {await reader.cancel(); throw new Error('Teaching media size did not match its receipt.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  if (length !== asset.byteLength) throw new Error('Teaching media is incomplete.');
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) throw new Error('Teaching media did not match its original hash.');
  return new Blob([bytes], {type: asset.name.endsWith('.svg') ? 'image/svg+xml' : asset.name.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream'});
}

export function comparisonRows(before?: TeachingCanonical, after?: TeachingCanonical) {
  const left = before?.measurement?.measurements || [], right = after?.measurement?.measurements || [];
  return left.map(row => {
    const matched = right.find(item => item.name === row.name && item.unit === row.unit);
    const a = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
    const b = typeof matched?.value === 'number' && Number.isFinite(matched.value) ? matched.value : null;
    return {name: row.name, unit: row.unit, before: a, after: b, difference: a !== null && b !== null ? b - a : null};
  });
}
