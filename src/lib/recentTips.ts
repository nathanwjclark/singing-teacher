import type { Tip } from '../types';

export type RecentTip = Tip & { triggeredAt: number; lastSeenAt: number; active: boolean; inactiveSince?: number; resolved?: boolean };
export const RECENT_WINDOW_MS = 5_000;
export const RESOLVED_WINDOW_MS = 1_500;

/** Recency is the latest onset/recurrence, not every video frame. */
export function updateRecentTips(previous: RecentTip[], current: Tip[], now: number, resolvedIds: Set<string> = new Set()): RecentTip[] {
  const rows = new Map<string, RecentTip>();
  for (const row of previous) {
    if (row.inactiveSince !== undefined && now - row.inactiveSince >= (row.resolved ? RESOLVED_WINDOW_MS : RECENT_WINDOW_MS)) continue;
    rows.set(row.id, {...row,active:false,inactiveSince:row.inactiveSince ?? now,resolved:row.resolved || (row.active && resolvedIds.has(row.id))});
  }
  for (const cue of current.filter(cue => cue.region !== 'general' && cue.severity !== 'good')) {
    const old = rows.get(cue.id);
    rows.set(cue.id, { ...cue, triggeredAt: !old || now - old.lastSeenAt > 1500 ? now : old.triggeredAt, lastSeenAt: now, active: true });
  }
  return [...rows.values()].sort((a, b) => b.triggeredAt - a.triggeredAt || b.score - a.score || a.id.localeCompare(b.id)).slice(0, 12);
}
