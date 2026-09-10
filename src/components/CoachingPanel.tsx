import type { Tip } from '../types';
import './CoachingPanel.css';

type CoachingPanelProps = { tips: Tip[]; demo: boolean; tracking: boolean };

export function CoachingPanel({ tips, demo, tracking }: CoachingPanelProps) {
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

      <p className="coaching-intro">One gentle adjustment at a time.</p>
      <ol className="coaching-tips" aria-live="polite" aria-atomic="true">
        {tips.map((tip, index) => (
          <li key={tip.id} className={`coaching-tip coaching-tip--${tip.severity}`}>
            <div className="coaching-tip-topline">
              <span className="coaching-tip-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="coaching-tip-region">{tip.region === 'general' ? 'YOUR PRACTICE' : tip.region.toUpperCase()}</span>
              <span className="coaching-tip-priority">{tip.severity === 'focus' ? 'TRY THIS FIRST' : tip.severity === 'good' ? 'LOOKING GOOD' : 'EXPLORE'}</span>
            </div>
            <h3>{tip.title}</h3>
            <p>{tip.detail}</p>
          </li>
        ))}
      </ol>

      <div className="coaching-note">
        <span className="coaching-note-icon" aria-hidden="true">↗</span>
        <p><strong>Stay curious. Stay comfortable.</strong> These are visual practice cues. Your camera can’t assess vocal sound or muscle tension.</p>
      </div>
    </section>
  );
}
