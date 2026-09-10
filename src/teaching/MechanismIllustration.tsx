import {useEffect, useId, useState} from 'react';
import {getMechanism} from './mechanisms';
import type {DemonstrationId} from './mechanisms';
import './MechanismIllustration.css';

function MechanismDrawing({kind,progress,label}:{kind:DemonstrationId;progress:number;label:string}) {
 const id=useId();const t=Math.max(0,Math.min(1,progress));
 const sourceWave=Array.from({length:121},(_,i)=>`${i===0?'M':'L'}${28+i*1.25},${185-Math.sin(i*.38)*19}`).join(' ');
 const filterWave=Array.from({length:121},(_,i)=>`${i===0?'M':'L'}${285+i*1.25},${185-Math.sin(i*.38)*(12+12*t)*(.6+.4*Math.cos(i*.08))}`).join(' ');
 return <svg className="mechanism-drawing" viewBox="0 0 480 300" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
  <title id={`${id}-title`}>{label}</title><desc id={`${id}-desc`}>{getMechanism(kind)?.illustration.caption} General schematic; proportions and movement are illustrative.</desc>
  <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor"/></marker></defs>
  <path className="mechanism-guide" d="M25 262H455"/><text className="mechanism-small" x="26" y="283">SCHEMATIC · SAME VIEW &amp; SCALE</text>
  {kind==='cricothyroid-pitch'&&<>
   <path className="mechanism-guide" d="M66 51V242M59 60H73M59 232H73"/><text className="mechanism-small" x="18" y="36">Height held fixed</text>
   <path className="mechanism-cartilage" d="M145 188Q213 161 290 184L303 218Q220 241 151 216Z"/>
   <g transform={`rotate(${12*t} 158 176)`}>
    <path className="mechanism-cartilage mechanism-cartilage--moving" d="M166 70Q227 38 315 87L301 166Q226 151 162 173Z"/>
    <circle className="mechanism-joint" cx="158" cy="176" r="6"/>
    <circle className="mechanism-attachment" cx="292" cy="126" r="5"/>
   </g>
   <path className="mechanism-fold" d={`M171 149L${158+134*Math.cos(12*t*Math.PI/180)+50*Math.sin(12*t*Math.PI/180)} ${176+134*Math.sin(12*t*Math.PI/180)-50*Math.cos(12*t*Math.PI/180)}`}/>
   <circle className="mechanism-attachment" cx="171" cy="149" r="5"/>
   <path className="mechanism-arrow" d="M339 73Q362 103 335 126" markerEnd={`url(#${id}-arrow)`}/>
   <path className="mechanism-leader" d="M309 91H396M293 211H388M230 137L294 248"/>
   <text x="375" y="83">Thyroid</text><text x="331" y="231">Cricoid</text><text x="300" y="251">Vocal fold</text>
   <text className="mechanism-note" x="91" y="24">Relative cartilage movement</text>
  </>}
  {kind==='soft-palate-coupling'&&<>
   <path className="mechanism-cavity" d="M64 77Q113 35 196 55L284 65Q354 69 369 122L350 224H307L313 143H255L178 168H72L49 147L81 125Z"/>
   <path className="mechanism-airspace" d="M99 94Q170 71 241 91L317 99L329 121L257 124L183 140H83"/>
   <path className="mechanism-palate" d={`M177 139Q225 ${138-42*t} 270 ${159-58*t}`} />
   <path className="mechanism-flow" opacity={1-t*.82} d="M314 204Q315 139 292 120Q245 86 138 94" markerEnd={`url(#${id}-arrow)`}/>
   <path className="mechanism-flow" d="M303 204Q301 169 233 164H113" markerEnd={`url(#${id}-arrow)`}/>
   <path className="mechanism-leader" d="M204 87L199 28M131 161L111 211M249 127L397 164"/>
   <text x="155" y="23">Nasal pathway</text><text x="61" y="232">Oral pathway</text><text x="356" y="184">Soft palate</text>
   <text className="mechanism-note" x="269" y="247">{t<.5?'More nasal coupling':'Reduced nasal coupling'}</text>
  </>}
  {kind==='tongue-jaw-vowels'&&<>
   <path className="mechanism-cavity" d="M74 90Q112 40 206 62L298 68Q359 80 355 147L337 229H303L302 151Q260 115 198 124L93 144L66 125Z"/>
   <path className="mechanism-jaw" d={`M91 161Q166 ${234+15*t} 288 ${184+20*t}L298 146`} />
   <path className="mechanism-tongue" d={`M107 ${175+10*t}Q151 ${170-37*t} 193 ${155-38*t}Q237 ${117+30*t} 290 169L297 211Q204 235 107 ${175+10*t}Z`}/>
   <path className="mechanism-arrow" d="M169 147L173 103" markerEnd={`url(#${id}-arrow)`}/>
   <path className="mechanism-arrow" d="M136 226L131 249" markerEnd={`url(#${id}-arrow)`}/>
   <path className="mechanism-leader" d="M192 151L403 174M236 218L383 243"/>
   <text x="358" y="166">Tongue</text><text x="354" y="253">Jaw</text>
   <text className="mechanism-note" x="82" y="26">A different vowel shape</text>
  </>}
  {kind==='source-filter'&&<>
   <rect className="mechanism-source-box" x="25" y="60" width="154" height="63" rx="12"/>
   <path className="mechanism-cavity" d={`M226 70Q257 ${52-10*t} 288 72L345 ${65+15*t}L355 112L286 ${102-15*t}Q254 124 226 105Z`}/>
   <path className="mechanism-arrow" d="M185 91H215M363 91H436" markerEnd={`url(#${id}-arrow)`}/>
   <text x="53" y="86">Vocal-fold</text><text x="58" y="107">excitation</text><text x="241" y="145">Tract filtering</text>
   <path className="mechanism-wave" d={sourceWave}/><path className="mechanism-wave mechanism-wave--filtered" d={filterWave}/>
   <text className="mechanism-small" x="27" y="231">SOURCE PATTERN HELD FIXED</text><text className="mechanism-small" x="283" y="231">ILLUSTRATIVE TIMBRE CHANGE</text>
   <text className="mechanism-note" x="29" y="30">Source and filter have different jobs</text>
  </>}
 </svg>;
}

function IllustrationControls({demonstrationId}:{demonstrationId:DemonstrationId}) {
 const mechanism=getMechanism(demonstrationId)!;const sliderId=useId();
 const [progress,setProgress]=useState(0),[playing,setPlaying]=useState(false),[staticView,setStaticView]=useState(true),[reduced,setReduced]=useState(false);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>{setReduced(media.matches);if(media.matches){setPlaying(false);setStaticView(true);}};update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 const active=playing&&progress<1&&!reduced;
 useEffect(()=>{if(!active)return;const timer=window.setInterval(()=>setProgress(value=>Math.min(1,value+1/100)),60);return()=>window.clearInterval(timer);},[active]);
 return <figure className="mechanism-illustration" aria-label={`${mechanism.title} illustration`}>
  <div className="mechanism-illustration-header"><span>General explanation</span><span>{mechanism.illustration.view}</span></div>
  {staticView?<div className="mechanism-comparison">
   <div><p className="mechanism-state-label">Before</p><MechanismDrawing kind={demonstrationId} progress={0} label={`Before: ${mechanism.illustration.before}`}/><p>{mechanism.illustration.before}</p></div>
   <div><p className="mechanism-state-label">After</p><MechanismDrawing kind={demonstrationId} progress={1} label={`After: ${mechanism.illustration.after}`}/><p>{mechanism.illustration.after}</p></div>
  </div>:<div className="mechanism-transition"><MechanismDrawing kind={demonstrationId} progress={progress} label={`${mechanism.title}: ${Math.round(progress*100)} percent through the illustration`}/></div>}
  <figcaption>{mechanism.illustration.caption} <span>This schematic is not a measurement of your anatomy.</span></figcaption>
  <div className="mechanism-controls"><button type="button" disabled={reduced} onClick={()=>{setStaticView(false);if(progress===1)setProgress(0);setPlaying(!active);}}>{active?'Pause illustration':progress===1?'Replay illustration':'Play slow illustration'}</button>
   <button type="button" aria-pressed={staticView} onClick={()=>{setPlaying(false);setStaticView(value=>!value);}}>{staticView?'Show one view':'Static comparison'}</button>
   <label htmlFor={sliderId}>Explore the movement<input id={sliderId} type="range" min="0" max="100" value={Math.round(progress*100)} aria-valuetext={`${Math.round(progress*100)} percent from before to after`} onChange={event=>{setPlaying(false);setStaticView(false);setProgress(Number(event.target.value)/100);}}/></label>
  </div>
  {reduced&&<p className="mechanism-access-note">Reduced motion is on. Use the static comparison or move the slider yourself.</p>}
  <p className="mechanism-movement">{mechanism.illustration.movement}</p>
 </figure>;
}

export function MechanismIllustration({demonstrationId}:{demonstrationId:DemonstrationId}) {
 if(!getMechanism(demonstrationId))return null;
 return <IllustrationControls key={demonstrationId} demonstrationId={demonstrationId}/>;
}
