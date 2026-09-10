import { useEffect, useId, useRef, type RefObject } from 'react';
import type { AnatomyMotionState } from '../../lib/anatomyState';
import './SideAnatomyPanel.css';
import { AtlasCrossSection } from './AtlasCrossSection';

type Props = { motion: RefObject<AnatomyMotionState> };
const degrees = (angle: number) => angle * 180 / Math.PI;

// Licensed anatomical plate above; original illustrative airway geometry below. The shared surface rig supplies motion;
// neither the internal tissue shapes nor airway dimensions are camera measurements.
export function SideAnatomyPanel({ motion }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const find = (name: string) => Array.from(element.querySelectorAll<SVGElement>(`[data-motion="${name}"]`));
    const torso = find('torso'), head = find('head'), jaw = find('jaw');
    const tongue = find('tongue'), airway = find('airway'), centerline = find('centerline');
    const lateral = find('lateral');
    const status = element.querySelector('[data-status]');
    let request = 0;
    const draw = () => {
      const state = motion.current;
      const pitch = degrees(state.head.x), lean = degrees(state.torso.x);
      torso.forEach(node => node.setAttribute('transform', `rotate(${lean} 143 237)`));
      head.forEach(node => node.setAttribute('transform', `rotate(${pitch} 146 168)`));
      jaw.forEach(node => node.setAttribute('transform', `rotate(${degrees(state.jawOpen)} 173 117)`));
      // A sagittal projection of the same pinned-root deformation as the front rig.
      // Forward = extension; upward = lift + curl. Sideways motion is out of plane.
      const tipX = 223 + state.tongue.extension * 3.2;
      const tipY = 139 - state.tongue.lift * 3.2 - Math.sin(state.tongue.curl) * 9;
      const tonguePath = `M 166 159 C 156 144 176 129 195 132 C 209 134 ${tipX - 8} ${tipY - 5} ${tipX} ${tipY} C ${tipX + 1} ${tipY + 6} 210 153 194 154 C 181 154 178 165 166 159 Z`;
      tongue.forEach(node => { node.setAttribute('d', tonguePath); node.style.opacity = state.tongue.visible ? '1' : '.52'; });
      // This is the *illustrative space around* the tongue, not measured airflow.
      const opening = Math.sin(state.jawOpen) * 38;
      const roof = Math.min(135, Math.max(116, tipY - 8));
      const tract = `M 235 123 Q 211 117 191 119 Q 169 118 159 139 Q 155 151 153 163 L 154 197 Q 154 211 151 234 L 166 234 Q 170 210 167 195 L 166 165 Q 163 154 174 143 Q 184 132 200 ${roof} Q 216 ${roof} 235 ${137 + opening} Z`;
      airway.forEach(node => node.setAttribute('d', tract));
      centerline.forEach(node => node.setAttribute('d', `M 231 ${129 + opening / 2} Q 181 120 163 146 Q 160 160 160 188 Q 163 210 158 233`));
      lateral.forEach(node => node.setAttribute('cx', String(160 + state.tongue.lateral * 5)));
      if (status) status.textContent = state.demo ? 'DEMO MOTION' : state.frame ? 'SHARED CAMERA MOTION' : 'REFERENCE · WAITING FOR CAMERA';
      request = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(request);
  }, [motion]);

  return <div ref={root} className="side-anatomy-panel">
    <section className="side-anatomy-tile" aria-label="Side profile head and neck cross-section">
      <header><strong>HEAD & NECK</strong><span>SAGITTAL CUTAWAY</span></header>
      <AtlasCrossSection motion={motion}/>
      <div className="atlas-credit"><a href="https://commons.wikimedia.org/wiki/File:Head_sagittal_mouth.jpg" target="_blank" rel="noreferrer">Patrick J. Lynch · C. Carl Jaffe</a><span>Animated adaptation · <a href="https://creativecommons.org/licenses/by/2.5/" target="_blank" rel="noreferrer">CC BY 2.5</a></span></div>
    </section>
    <section className="side-anatomy-tile vocal-tract-tile" aria-label="Vocal tract interior shape">
      <header><strong>VOCAL TRACT</strong><span>INTERIOR SPACE</span></header>
      <svg viewBox="65 70 225 180" role="img" aria-label="Animated illustrative cast of mouth, pharynx, larynx and trachea">
        <defs><linearGradient id={`${id}-lumen`} x1="0" y1="0" x2="1" y2=".3"><stop stopColor="#367c76"/><stop offset=".4" stopColor="#a4e0cf"/><stop offset=".68" stopColor="#68b4a6"/><stop offset="1" stopColor="#326a68"/></linearGradient></defs>
        <g data-motion="torso">
          <g data-motion="head">
            <path d="M 236 93 Q 211 82 194 102 Q 182 110 173 132" fill="none" stroke="#7fb7af" strokeWidth="15" opacity=".24"/>
            <path data-motion="airway" fill={`url(#${id}-lumen)`} stroke="#b4e8d8" strokeWidth="1.4"/>
            <path data-motion="centerline" stroke="#e3fff1" strokeOpacity=".43" strokeWidth="1" fill="none"/>
            <g data-motion="jaw"><path data-motion="tongue" fill="#bd7788" fillOpacity=".65" stroke="#e5a3ad" strokeWidth=".8"/></g>
            <ellipse cx="160" cy="185" rx="8" ry="4" fill="#224940" stroke="#c7ecd3"/>
            <path d="M 158 182 L 162 188 M 162 182 L158 188" stroke="#e9e5bb" strokeWidth="1.1"/>
            {[204,213,222,231].map(y => <path key={y} d={`M 153 ${y} Q 160 ${y + 5} 168 ${y}`} stroke="#c2e9d4" strokeOpacity=".55" fill="none"/>)}
          </g>
        </g>
        <g className="side-anatomy-label"><path d="M237 116 H262"/><text x="234" y="109">Mouth</text><path d="M108 153 H150"/><text x="78" y="147">Pharynx</text><path d="M174 185 H213"/><text x="216" y="188">Larynx</text><path d="M111 223 H148"/><text x="78" y="217">Trachea</text></g>
        <path d="M145 244 H175" stroke="#6b8f83"/><circle data-motion="lateral" cx="160" cy="244" r="2.8" fill="#e9a3b4"/><text className="side-anatomy-lateral" x="192" y="247">TIP LEFT / RIGHT</text>
      </svg>
      <div className="side-anatomy-key"><i className="lumen"/>Airway cast<i className="tongue"/>Tongue boundary</div>
    </section>
    <footer><span data-status>REFERENCE · WAITING FOR CAMERA</span><p>Illustrative internal anatomy · motion shared with front model. Internal shape is not measured.</p></footer>
  </div>;
}
