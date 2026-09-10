import { useEffect, useId, useRef, type RefObject } from 'react';
import type { AnatomyMotionState } from '../../lib/anatomyState';
import './SideAnatomyPanel.css';

type Props = { motion: RefObject<AnatomyMotionState> };
const degrees = (angle: number) => angle * 180 / Math.PI;

// Original illustrative sagittal geometry. The shared surface rig supplies motion;
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
    const lateral = find('lateral'), neck = find('neck');
    const status = element.querySelector('[data-status]');
    let request = 0;
    const draw = () => {
      const state = motion.current;
      const pitch = degrees(state.head.x), lean = degrees(state.torso.x);
      const neckX = 146 + 27 * Math.cos(state.head.x) + 39 * Math.sin(state.head.x);
      const neckY = 168 + 27 * Math.sin(state.head.x) - 39 * Math.cos(state.head.x);
      neck.forEach(node => node.setAttribute('d', `M ${neckX} ${neckY} Q 161 183 172 219 L 157 231 Q 153 194 ${neckX - 7} ${neckY + 7} Z`));
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
      <svg viewBox="45 5 260 250" role="img" aria-label="Animated illustrative side cutaway of skull, jaw, neck muscles and tongue">
        <defs>
          <linearGradient id={`${id}-bone`} x2="1" y2="1"><stop stopColor="#f5e5c9"/><stop offset="1" stopColor="#ad9d82"/></linearGradient>
          <linearGradient id={`${id}-muscle`}><stop stopColor="#9f5961"/><stop offset=".55" stopColor="#d69787"/><stop offset="1" stopColor="#935563"/></linearGradient>
          <pattern id={`${id}-fibers`} width="5" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><path d="M0 0V8" stroke="#f6c9af" strokeOpacity=".28" strokeWidth="1"/></pattern>
        </defs>
        <g data-motion="torso">
          <path d="M 82 247 Q 105 222 130 218 L 140 166 L 176 162 L 180 216 Q 209 225 222 247" fill="#c69a8620" stroke="#b795824f"/>
          <path d="M 141 170 Q 127 198 139 240" fill="none" stroke="#b5ac94" strokeWidth="14"/>
          {[181,194,207,220,233].map((y, i) => <rect key={y} x={129 + Math.abs(i-2)} y={y} width="19" height="9" rx="3" fill={`url(#${id}-bone)`} stroke="#766e5e" strokeWidth="1"/>)}
          <path data-motion="neck" fill={`url(#${id}-muscle)`}/>
          <path data-motion="neck" fill={`url(#${id}-fibers)`}/>
          <path d="M 137 175 Q 113 208 99 239 L 121 239 Q 130 207 145 188 Z" fill="#a96c72" opacity=".8"/>
          <g data-motion="head">
            <path d="M 143 172 C 116 163 102 129 105 87 C 109 42 143 22 177 25 C 211 27 225 53 224 81 L 237 97 L 251 105 Q 254 111 239 113 L 236 124 Q 248 130 235 137 L 238 149 Q 236 165 212 167 L 177 175" fill="#d9a68b18" stroke="#d6b093" strokeWidth="1.6"/>
            <path d="M 139 152 C 115 135 111 108 116 81 C 123 46 148 34 176 36 C 201 38 213 53 214 76 L 207 93 L 191 104 L 179 116 L 168 145 Z" fill={`url(#${id}-bone)`}/>
            <path d="M 132 118 C 119 91 130 59 157 51 C 183 42 202 58 203 77 C 202 95 181 104 174 128 L 158 137 Z" fill="#293b36" stroke="#d4c3a5" strokeWidth="2"/>
            <path d="M 213 89 Q 238 101 229 112 L 208 112 L 198 120 L 182 122 L 190 104 Z" fill="#2c4541" stroke="#b5b5a0"/>
            <path d="M 185 121 Q 210 119 232 123" stroke="#e6d6b9" strokeWidth="5" fill="none"/>
            <path d="M 198 124 H230" stroke="#fbf1d9" strokeWidth="5" strokeDasharray="5 1"/>
            <path d="M 172 120 Q 155 134 158 173 L 158 209" fill="none" stroke="#73bab0" strokeWidth="12" opacity=".4"/>
            <g data-motion="jaw">
              <path d="M 174 118 Q 167 137 182 155 Q 204 164 233 150 L 229 144 Q 204 151 188 143 L 183 117 Z" fill={`url(#${id}-bone)`} stroke="#dec8a6" strokeWidth="1"/>
              <path d="M 199 145 L 230 143" stroke="#fbf1d9" strokeWidth="5" strokeDasharray="5 1"/>
              <path data-motion="tongue" fill="#df8897" stroke="#ffb1b4" strokeWidth="1.5"/>
              <path d="M 178 111 Q 185 120 187 142 L 177 139 Q 170 121 178 111 Z" fill={`url(#${id}-muscle)`}/>
            </g>
            <circle cx="215" cy="83" r="4" fill="#111f1b" stroke="#ddbaa1"/>
          </g>
        </g>
        <g className="side-anatomy-label"><path d="M 74 76 H106"/><text x="57" y="71">Skull</text><path d="M 249 145 H270"/><text x="247" y="158">Tongue</text><path d="M 82 204 H124"/><text x="55" y="199">Neck</text></g>
      </svg>
      <div className="side-anatomy-key"><i className="bone"/>Bone<i className="muscle"/>Muscle<i className="tongue"/>Tongue</div>
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
