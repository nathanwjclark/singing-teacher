import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TrackingFrame } from '../types';
import { getTips, resolvedTipIds, isMouthOpen } from '../lib/coaching';
import { updateRecentTips } from '../lib/recentTips';
import type { RecentTip } from '../lib/recentTips';
import { hasRecentVoice } from '../lib/voiceActivity';
import type { VoiceActivity } from '../lib/voiceActivity';

type ActivityOptions = {voice?:RefObject<VoiceActivity|null>;demo?:boolean};
export function useRecentTips(frame: TrackingFrame | null, scope: string, options: ActivityOptions = {}) {
  const sessionScope = scope.replace(/:(live|idle)$/, ':session');
  const latest = useRef({frame,options});
  const [state, setState] = useState<{scope:string; rows:RecentTip[]; now:number; fallback:RecentTip[]}> (() => ({scope:sessionScope, rows:[], now:Date.now(),fallback:[]}));
  useEffect(() => { latest.current = {frame,options}; }, [frame,options]);
  useEffect(() => {
    let rows: RecentTip[] = [];
    let previous: TrackingFrame | null = null;
    let wasSinging = false;
    let mouthWasOpen = false;
    const tick = () => {
      const now = Date.now(), clock = performance.now();
      const {frame:raw,options:activity} = latest.current;
      const current = activity.demo || (raw && clock - raw.timestamp < 1200) ? raw : null;
      const singing = !!activity.demo || hasRecentVoice(activity.voice?.current,clock);
      const cues = getTips(current,{limit:12,uniqueRegions:false,singing,mouthWasOpen});
      mouthWasOpen = !!current?.face.length && isMouthOpen(current.metrics.mouthOpen,mouthWasOpen);
      const resolved = singing && wasSinging ? resolvedTipIds(previous,current) : new Set<string>();
      rows = updateRecentTips(rows,cues,now,resolved);
      previous = current; wasSinging = singing;
      const fallback = cues.map(tip=>({...tip,triggeredAt:now,lastSeenAt:now,active:true}));
      setState({scope:sessionScope,rows,now,fallback});
    };
    const first = window.setTimeout(tick,0);
    const timer = window.setInterval(tick,250);
    return () => {clearTimeout(first);clearInterval(timer)};
  }, [sessionScope]);
  const history = state.scope === sessionScope ? state.rows.slice(0,6) : [];
  const fallback = state.scope === sessionScope ? state.fallback : [];
  // Keep the current pause state visible while older adjustments finish fading.
  const idle = fallback.find(tip=>tip.id === 'no-singing');
  return {tips:history.length ? (idle ? [idle,...history.slice(0,5)] : history) : fallback,now:state.now};
}
