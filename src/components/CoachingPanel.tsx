import type { Tip } from '../types';
import './CoachingPanel.css';

type CoachingPanelProps = {
  tips: Tip[];
  demo: boolean;
  tracking: boolean;
  selectedTipId?: string;
  onSelectTip?: (tip: Tip) => void;
};

export function CoachingPanel({ tips, demo, tracking, selectedTipId, onSelectTip }: CoachingPanelProps) {
  return (
    <section className="coaching-panel" aria-labelledby="coaching-title">
      <div className="coaching-heading">
        <div>
          <p className="coaching-eyebrow">03 / YOUR COACH</p>
          <h2 id="coaching-title">Small shifts.<br />More freedom.</h2>
        </div>
        <span className={`coaching-state ${tracking || demo ? 'is-active' : ''}`}>
          <span aria-hidden="true" />{demo ? 'DEMO CUES' : tracking ? 'LIVE CUES' : 'STANDING BY'}
        </span>
      </div>

      <p className="coaching-intro">{onSelectTip ? 'Select a cue to explore its anatomy.' : 'One gentle adjustment at a time.'}</p>
      <ol className="coaching-tips" aria-live="polite" aria-atomic="true">
        {tips.map((tip, index) => (
          <li key={tip.id} className={`coaching-tip coaching-tip--${tip.severity} ${selectedTipId === tip.id ? 'coaching-tip--selected' : ''}`}>
            <div className="coaching-tip-topline">
              <span className="coaching-tip-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="coaching-tip-region">{tip.region === 'general' ? 'YOUR PRACTICE' : tip.region.toUpperCase()}</span>
              <span className="coaching-tip-priority">{tip.severity === 'focus' ? 'TRY THIS FIRST' : tip.severity === 'good' ? 'LOOKING GOOD' : 'EXPLORE'}</span>
            </div>
            <h3>{onSelectTip ? (
              <button className="coaching-select" type="button" onClick={() => onSelectTip(tip)} aria-pressed={selectedTipId === tip.id} aria-describedby={`cue-detail-${tip.id}`}>
                {tip.title}<span aria-hidden="true" className="coaching-select-arrow">↗</span>
              </button>
            ) : tip.title}</h3>
            <p id={`cue-detail-${tip.id}`}>{tip.detail}</p>
            {tip.muscles && <span className="coaching-reference">REFERENCE · {tip.muscles.join(' / ')}</span>}
          </li>
        ))}
      </ol>

      <div className="coaching-note">
        <span className="coaching-note-icon" aria-hidden="true">↗</span>
        <p><strong>Stay curious. Stay comfortable.</strong> Visual cues are estimates. Highlighted muscles are anatomical references; your camera can’t assess their activity, vocal sound, or tension.</p>
      </div>
    </section>
  );
}
