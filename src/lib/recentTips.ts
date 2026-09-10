import type { Tip } from '../types';

export type RecentTip = Tip & { triggeredAt: number; lastSeenAt: number; active: boolean; inactiveSince?: number };
export const RECENT_WINDOW_MS = 5_000;

/** Recency is the latest onset/recurrence, not every video frame. Keeping that
 * timestamp stable prevents continuously present cues from shuffling the grid. */
export function updateRecentTips(previous: RecentTip[], current: Tip[], now: number): RecentTip[] {
  const rows = new Map<string, RecentTip>(previous.filter(row => row.inactiveSince === undefined || now - row.inactiveSince < RECENT_WINDOW_MS).map(row => [row.id, { ...row, active: false, inactiveSince: row.inactiveSince ?? now }]));
  for (const cue of current.filter(cue => cue.region !== 'general' && cue.severity !== 'good')) {
    const old = rows.get(cue.id);
    rows.set(cue.id, { ...cue, triggeredAt: !old || now - old.lastSeenAt > 1500 ? now : old.triggeredAt, lastSeenAt: now, active: true });
  }
  return [...rows.values()].sort((a, b) => b.triggeredAt - a.triggeredAt || b.score - a.score || a.id.localeCompare(b.id)).slice(0, 12);
}
