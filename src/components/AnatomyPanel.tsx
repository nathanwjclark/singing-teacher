import { useId } from 'react';
import type { TrackingFrame } from '../types';
import './AnatomyPanel.css';

type Props = {
  frame: TrackingFrame | null;
  activeRegion?: 'jaw' | 'neck' | 'shoulders' | 'general';
  demo: boolean;
};

export function AnatomyPanel({ frame, activeRegion = 'jaw', demo }: Props) {
  const id = useId().replace(/:/g, '');
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const headTilt = clamp(frame?.metrics.headTilt ?? 0, -20, 20);
  const shoulderTilt = clamp(frame?.metrics.shoulderTilt ?? 0, -15, 15);
  const jawOpen = clamp(frame?.metrics.mouthOpen ?? (demo ? 0.14 : 0), 0, 1) * 15;
  const accent = '#ff947c';
  const teal = '#8ccbbe';
  const regionColor = (region: Props['activeRegion']) => activeRegion === region ? accent : teal;

  return (
    <section className="anatomy-panel" aria-label="Illustrative movement model">
      <div className="anatomy-heading"><span className="anatomy-kicker">MOVEMENT MAP</span><span className="anatomy-view">FRONT VIEW <span>↗</span></span></div>
      <div className="anatomy-stage">
        <div className="anatomy-coordinates">Y +<br /><span>0.00</span></div>
        <svg className="anatomy-svg" viewBox="0 0 400 460" role="img" aria-label="Illustrative skull, jaw, neck muscles, shoulders and ribs, reflecting visible movement">
          <defs>
            <radialGradient id={`${id}-halo`}><stop offset="0" stopColor="#76bdb0" stopOpacity=".09"/><stop offset="1" stopColor="#76bdb0" stopOpacity="0"/></radialGradient>
            <linearGradient id={`${id}-muscle`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7bc1b0" stopOpacity=".2"/><stop offset="1" stopColor="#7bc1b0" stopOpacity=".03"/></linearGradient>
            <linearGradient id={`${id}-focus`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={accent} stopOpacity=".24"/><stop offset="1" stopColor={accent} stopOpacity=".04"/></linearGradient>
            <pattern id={`${id}-grid`} width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#8ccbbe" strokeOpacity=".055" strokeWidth=".6"/></pattern>
          </defs>
          <rect width="400" height="460" fill={`url(#${id}-grid)`}/>
          <ellipse cx="200" cy="230" rx="180" ry="220" fill={`url(#${id}-halo)`}/>
          <g stroke="#729990" fill="none" strokeWidth=".6" opacity=".24"><path d="M200 20V437" strokeDasharray="3 6"/><ellipse cx="200" cy="420" rx="122" ry="15"/><ellipse cx="200" cy="420" rx="75" ry="8"/><path d="M44 420H356"/></g>
          <g transform={`rotate(${shoulderTilt} 200 252)`} strokeLinecap="round" strokeLinejoin="round">
            <path d="M164 180C153 205 127 217 103 226C74 235 64 262 59 294L47 370M236 180C247 205 273 217 297 226C326 235 336 262 341 294L353 370" stroke="#86b2a7" strokeOpacity=".26" fill="none"/>
            {/* Shoulder and chest muscle sheets. */}
            <g fill={`url(#${id}-${activeRegion === 'shoulders' ? 'focus' : 'muscle'})`} stroke={regionColor('shoulders')} strokeWidth=".8" opacity=".82">
              <path d="M153 209C126 216 102 228 91 245C76 267 75 289 79 309L109 326C102 298 104 270 120 253L175 247Z"/>
              <path d="M247 209C274 216 298 228 309 245C324 267 325 289 321 309L291 326C298 298 296 270 280 253L225 247Z"/>
              <path d="M191 254C167 245 136 249 116 269L139 311C158 303 175 295 192 289Z"/>
              <path d="M209 254C233 245 264 249 284 269L261 311C242 303 225 295 208 289Z"/>
            </g>
            <g fill="none" stroke={regionColor('shoulders')} strokeWidth=".65" opacity=".35">
              {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M${151 - i * 8} ${220 + i * 4}Q${79 + i * 7} 247 ${86 + i * 5} ${306 - i * 6}M${249 + i * 8} ${220 + i * 4}Q${321 - i * 7} 247 ${314 - i * 5} ${306 - i * 6}`}/>)}
              {[0, 1, 2, 3].map(i => <path key={i} d={`M190 ${260 + i * 7}Q166 ${261 + i * 9} ${122 + i * 5} ${274 + i * 9}M210 ${260 + i * 7}Q234 ${261 + i * 9} ${278 - i * 5} ${274 + i * 9}`}/>)}
            </g>
            {/* Sternum, clavicles and ribcage. */}
            <g fill="none" stroke={teal} opacity=".64" strokeWidth="1.25">
              <path d="M196 252C181 236 167 238 147 242L116 247M204 252C219 236 233 238 253 242L284 247" strokeWidth="3"/>
              <path d="M195 255L192 285L197 325L200 335L203 325L208 285L205 255Z" fill="#8ccbbe" fillOpacity=".12"/>
              {[0,1,2,3,4,5].map(i => <path key={i} d={`M${195 + Math.min(i, 3)} ${278 + i * 13}C${148 - i * 4} ${251 + i * 14} ${113 - i * 2} ${283 + i * 12} ${142 + i * 4} ${312 + i * 13}C160 ${327 + i * 11} 180 ${321 + i * 12} 195 ${307 + i * 9}M${205 - Math.min(i, 3)} ${278 + i * 13}C${252 + i * 4} ${251 + i * 14} ${287 + i * 2} ${283 + i * 12} ${258 - i * 4} ${312 + i * 13}C240 ${327 + i * 11} 220 ${321 + i * 12} 205 ${307 + i * 9}`} opacity={1 - i * .11}/>)}
              <path d="M195 338L192 405M205 338L208 405M111 263L93 331L83 383M289 263L307 331L317 383" opacity=".5"/>
              {[0,1,2,3,4,5].map(i => <path key={i} d={`M195 ${344 + i * 10}H205`} opacity=".3"/>)}
            </g>
            <g stroke={regionColor('neck')} strokeWidth=".9" fill={`url(#${id}-${activeRegion === 'neck' ? 'focus' : 'muscle'})`}>
              <path d="M167 161C169 193 182 221 198 247C187 228 161 214 156 191L154 169Z"/>
              <path d="M233 161C231 193 218 221 202 247C213 228 239 214 244 191L246 169Z"/>
              <path d="M170 182L190 219L195 234M164 183L181 216M230 182L210 219L205 234M236 183L219 216" fill="none" opacity=".45"/>
            </g>
            <g stroke={teal} fill="none" opacity=".4" strokeWidth=".8"><path d="M190 184V211L200 223L210 211V184"/>{[0,1,2,3].map(i => <path key={i} d={`M190 ${190 + i * 6}Q200 ${196 + i * 6} 210 ${190 + i * 6}`}/>)}</g>
          </g>
          <g transform={`rotate(${headTilt} 200 170)`} strokeLinecap="round" strokeLinejoin="round">
            {/* Cranial outline and facial bones. */}
            <path d="M151 141C140 124 137 103 143 80C149 55 171 40 200 40C229 40 251 55 257 80C263 103 260 124 249 141L238 158L229 175H171L162 158Z" fill="#8ccbbe" fillOpacity=".045" stroke={teal} strokeWidth="1.2"/>
            <path d="M150 102C146 78 168 49 200 48C232 49 254 78 250 102M151 86C170 77 186 78 200 82C214 78 230 77 249 86M200 48V78" stroke={teal} strokeWidth=".65" fill="none" opacity=".27"/>
            <path d="M151 111C155 98 179 98 188 109L183 129C169 136 155 129 151 111ZM249 111C245 98 221 98 212 109L217 129C231 136 245 129 249 111Z" fill="#101e1b" fillOpacity=".55" stroke={teal} strokeWidth="1.1"/>
            <path d="M199 112L189 140L200 136L211 140L201 112M153 131L160 146L178 150M247 131L240 146L222 150M155 139L153 155L163 166M245 139L247 155L237 166" fill="none" stroke={teal} strokeWidth="1"/>
            <path d="M180 148Q200 142 220 148L218 161Q200 169 182 161Z" fill="#8ccbbe" fillOpacity=".09" stroke={teal} strokeWidth=".8"/>
            {[0,1,2,3,4,5,6].map(i => <path key={i} d={`M${185 + i * 5} 150V161`} stroke={teal} opacity=".35" strokeWidth=".6"/>)}
            <g transform={`translate(0 ${jawOpen})`} stroke={regionColor('jaw')}>
              <path d="M155 143L161 169Q173 193 200 196Q227 193 239 169L245 143L237 149L231 169Q218 182 200 181Q182 182 169 169L163 149Z" fill={regionColor('jaw')} fillOpacity=".13" strokeWidth="1.2"/>
              <path d="M180 170Q200 180 220 170M175 179Q200 195 225 179" fill="none" strokeWidth=".7" opacity=".65"/>
              <circle cx="157" cy="145" r="3.3" fill={regionColor('jaw')} fillOpacity=".2"/><circle cx="243" cy="145" r="3.3" fill={regionColor('jaw')} fillOpacity=".2"/>
            </g>
            <path d="M147 120C131 110 133 142 149 149M253 120C269 110 267 142 251 149" stroke={teal} fill="none" opacity=".35"/>
          </g>
          <g className="anatomy-leaders" fill="none" strokeWidth=".65">
            <path d="M231 176L277 153H340" stroke={regionColor('jaw')}/><circle cx="231" cy="176" r="2" fill={regionColor('jaw')} stroke="none"/>
            <path d="M175 213L124 196H56" stroke={regionColor('neck')}/><circle cx="175" cy="213" r="2" fill={regionColor('neck')} stroke="none"/>
            <path d="M268 246L299 277H345" stroke={regionColor('shoulders')}/><circle cx="268" cy="246" r="2" fill={regionColor('shoulders')} stroke="none"/>
          </g>
          <g className="anatomy-labels"><text x="285" y="145" fill={regionColor('jaw')}>JAW RELEASE</text><text x="55" y="188" fill={regionColor('neck')}>HEAD POSITION</text><text x="285" y="292" fill={regionColor('shoulders')}>SHOULDERS</text></g>
          <g stroke="#8ccbbe" strokeWidth=".7" opacity=".3"><path d="M19 35V22H32M368 22H381V35M19 425V438H32M368 438H381V425"/></g>
        </svg>
        <span className="anatomy-model-tag">MODEL 01 / UPPER BODY</span>
      </div>
      <div className="anatomy-legend"><span><i/>Movement reference</span><span><i className="anatomy-focus-dot"/>Current focus</span></div>
      <p className="anatomy-disclaimer">Illustrative anatomy · estimated visible movement.<br/>Your camera cannot measure muscles or bones.</p>
    </section>
  );
}

export default AnatomyPanel;
