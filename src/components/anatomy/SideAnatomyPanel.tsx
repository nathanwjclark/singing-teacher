import { useEffect, useRef, type RefObject } from 'react';
import type { AnatomyMotionState } from '../../lib/anatomyState';
import {useModelAdjustments} from '../science/modelAdjustments';
import { AtlasCrossSection } from './AtlasCrossSection';
import './SideAnatomyPanel.css';

type Props = { motion: RefObject<AnatomyMotionState> };

export function SideAnatomyPanel({ motion }: Props) {
  const model=useModelAdjustments();
  const status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let request = 0;
    const draw = () => {
      const state = motion.current;
      if (status.current) status.current.textContent = state.demo ? 'DEMO MOTION' : state.tongue.visible ? 'NEURAL TIP · DEPTH ESTIMATED' : state.frame ? 'SHARED CAMERA MOTION' : 'REFERENCE · WAITING FOR CAMERA';
      request = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(request);
  }, [motion]);

  return <div className="side-anatomy-panel">
    <section className="side-anatomy-tile" aria-label="Unified vocal tract and head and neck cross-section">
      <header><strong>{model?'NATIVE TRACT BOUNDARIES':'VOCAL TRACT'}</strong><span>HEAD & NECK OVERLAY</span></header>
      <AtlasCrossSection motion={motion}/>
      <div className="side-anatomy-key"><i className="lumen"/>{model?'Native tract boundaries':'Airway cast'}<i className="tongue"/>Tongue<i className="oral"/>Mouth & lips<span>20% anatomy</span></div>
      <div className="atlas-credit"><a href="https://commons.wikimedia.org/wiki/File:Head_sagittal_mouth.jpg" target="_blank" rel="noreferrer">Patrick J. Lynch · C. Carl Jaffe</a><span>Animated adaptation · <a href="https://creativecommons.org/licenses/by/2.5/" target="_blank" rel="noreferrer">CC BY 2.5</a></span></div>
    </section>
    <footer><span ref={status}>REFERENCE · WAITING FOR CAMERA</span><p>{model?'Native open boundaries and tongue surface; green/red compare exported envelopes, not a measured lumen. ':''}Detected tip height and learned depth drive the reference shape. Sideways motion is out of this plane; internal shape is not measured.</p></footer>
  </div>;
}
