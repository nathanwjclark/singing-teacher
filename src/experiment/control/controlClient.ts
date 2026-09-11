export type ControlAction = 'forecast' | 'score' | 'stop';

export interface ResidualFeature { unit: string; mean: number | null; sd: number | null }
export interface ControlAnatomy {
  anatomySha256: string;
  hypothesisId: string;
  matchedAttempts: number;
  forecastMatchedAttempts: number;
  supportStatus: string;
  leadingControlIds: string[];
  weights: Record<string, number | null>;
  residualCalibration: { status: string; count: number; features: Record<string, ResidualFeature> };
}
export interface ControlForecast {
  forecastId: string;
  status: string;
  current: boolean;
  committedAt: string;
  forecastSha256: string;
  predictionStatus: string;
  supportStatus: string;
  anatomyControlTradeoff: boolean;
  excludedAttempts: number;
  anatomies: ControlAnatomy[];
}
export interface ControlBinding {
  bindingId: string;
  deliveredCue: string;
  cueSha256: string;
  context: { vowel: string; pitch_hz: number; level: string; posture: string; capture_context_id: string; source_kind: string };
  controls: { controlId: string; JA: number; f0Hz: number }[];
  gain: number;
  attempts: { scored: number; unscorable: number; stopped: number; failed: number };
  latestForecast: ControlForecast | null;
}
export interface ControlPhase { id: string; status: string; reason?: string | null; forecastId?: string | null; result?: Record<string, unknown> | null }
export interface ControlStatus {
  status: string;
  reason?: string;
  running: boolean;
  workerAvailable?: boolean;
  minimumMatchedAttempts: number;
  interpretation: string;
  bindings: ControlBinding[];
  truncated: boolean;
  delivery: { current: boolean; cue?: string | null; decisionId?: string; cueBindingId?: string | null; reason?: string | null };
  forecast: ControlPhase | null;
  score: ControlPhase | null;
  stop: ControlPhase | null;
  sessionId?: string;
  runId?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/control/${path}`, { ...init, cache: 'no-store' });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result ? result.error : null;
    throw new Error(typeof error === 'string' ? error : `Cue-execution learning unavailable (${response.status}).`);
  }
  if (!result || typeof result !== 'object') throw new Error('Cue-execution learning returned an unreadable response.');
  return result as T;
}

export function getControlStatus(signal?: AbortSignal): Promise<ControlStatus> {
  return request('status', { signal });
}

export function controlAction(action: ControlAction): Promise<unknown> {
  return request(action, { method: 'POST' });
}
