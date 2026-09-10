import { useEffect, useRef, useState } from 'react';
import type { TrackingFrame } from '../types';
import { getTips } from '../lib/coaching';
import { updateRecentTips } from '../lib/recentTips';
import type { RecentTip } from '../lib/recentTips';

export function useRecentTips(frame: TrackingFrame | null, scope: string) {
  const latest = useRef(frame);
  const [state, setState] = useState<{scope:string; rows:RecentTip[]; now:number}>({scope, rows:[], now:Date.now()});
  useEffect(() => { latest.current = frame; }, [frame]);
  useEffect(() => {
    let rows: RecentTip[] = [];
    const tick = () => {
      const now = Date.now();
      rows = updateRecentTips(rows, getTips(latest.current, { limit: 12, uniqueRegions: false }), now);
      setState({scope, rows, now});
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 500);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [scope]);
  const history = state.scope === scope ? state.rows.slice(0, 6) : [];
  const fallback = getTips(frame).map(tip => ({...tip, triggeredAt: state.now, lastSeenAt: state.now, active: true}));
  return { tips: history.length ? history : fallback, now:state.now };
}
