import type { Tip } from '../types';
import type { RecentTip } from '../lib/recentTips';
import './CoachingPanel.css';

type Props = { tips: RecentTip[]; demo: boolean; tracking: boolean; selectedTipId?: string; now: number; onSelectTip?: (tip: Tip) => void };
export function CoachingPanel({ tips, demo, tracking, selectedTipId, now, onSelectTip }: Props) {
  const selected = tips.find(tip => tip.id === selectedTipId) ?? tips[0];
  return <section className="coaching-panel recent-coaching" aria-label="Recent coaching adjustments">
    <div className="recent-heading"><span>NEWEST FIRST</span><span>{demo ? 'DEMO' : tracking ? 'LIVE' : 'PAUSED'} · LAST 45 SECONDS</span></div>
    <ol className="coaching-tips recent-tip-grid">
      {tips.map((tip, index) => <li key={tip.id} className={`coaching-tip coaching-tip--${tip.severity} ${selected?.id === tip.id ? 'coaching-tip--selected' : ''} ${tip.active ? '' : 'coaching-tip--past'}`}>
        <div className="coaching-tip-topline"><span className="coaching-tip-number">{String(index + 1).padStart(2, '0')}</span><span className="coaching-tip-region">{tip.region === 'general' ? 'PRACTICE' : tip.region.toUpperCase()}</span></div>
        <h3><button className="coaching-select" type="button" onClick={() => onSelectTip?.(tip)} aria-pressed={selected?.id === tip.id} aria-describedby={selected?.id === tip.id ? 'selected-cue-detail' : undefined}>{tip.title}</button></h3>
        <div className="recent-cue-time"><span className={tip.active ? 'cue-present' : ''}>{tip.active ? 'Present' : 'Recent'}</span><span>{Math.max(0, Math.floor((now - tip.triggeredAt) / 1000))}s ago</span></div>
      </li>)}
    </ol>
    {selected && <div className="selected-cue-detail" id="selected-cue-detail"><p>{selected.detail}</p>{selected.muscles?.length ? <span>REFERENCE · {selected.muscles.join(' / ')}</span> : null}</div>}
  </section>;
}
