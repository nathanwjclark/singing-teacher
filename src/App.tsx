import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowUpRight, Camera, CircleHelp, Eye, MicVocal, Play, ShieldCheck, Square } from 'lucide-react'
import CameraPanel from './components/CameraPanel'
import AnatomyPanel from './components/AnatomyPanel'
import { CoachingPanel } from './components/CoachingPanel'
import { getTips } from './lib/coaching'
import type { Metrics, TrackingFrame, TrackingStatus } from './types'
import './App.css'

const demoFrame: TrackingFrame = {
  face: Array.from({ length: 478 }, () => ({ x: .5, y: .5 })),
  pose: Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 })),
  metrics: { mouthOpen: .09, headTilt: 12, shoulderTilt: 9, brightness: 140, motion: .01 }, timestamp: 0,
}

const demoScenarios: { name: string; title: string; detail: string; metrics: Partial<Metrics> }[] = [
  { name: 'Vowel space', title: 'A little room to open up.', detail: 'Explore mouth opening and a balanced head position.', metrics: {} },
  { name: 'Head & neck', title: 'Find an easy center.', detail: 'See how turning and lifting the head relates to the neck muscles.', metrics: { mouthOpen: .25, headTilt: 3, shoulderTilt: 2, headYaw: 24, headPitch: 18 } },
  { name: 'Body balance', title: 'Give the phrase a steady base.', detail: 'Explore torso alignment and shoulders rotating in depth.', metrics: { mouthOpen: .25, headTilt: 2, shoulderTilt: 11, shoulderDepth: .18, torsoLean: 15 } },
  { name: 'Lip shape', title: 'Let the vowel take shape.', detail: 'Explore visible lip shape without forcing a smile or a pucker.', metrics: { mouthOpen: .25, headTilt: 2, shoulderTilt: 2, lipWidth: 1.02, jawAsymmetry: .2 } },
]

function App() {
  const [active, setActive] = useState(false)
  const [demo, setDemo] = useState(false)
  const [scenario, setScenario] = useState(0)
  const [selectedTipId, setSelectedTipId] = useState<string>()
  const [frame, setFrame] = useState<TrackingFrame | null>(null)
  const [status, setStatus] = useState<TrackingStatus>('idle')
  const [message, setMessage] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [help, setHelp] = useState(false)
  const onStatus = useCallback((value: TrackingStatus, detail?: string) => { setStatus(previous => value === 'idle' && previous === 'error' ? previous : value); if (value !== 'idle') setMessage(detail ?? ''); if(value === 'error') setActive(false) }, [])
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => setSeconds(s => s + 1), 1000); return () => window.clearInterval(timer) }, [active])
  const exampleFrame: TrackingFrame = { ...demoFrame, metrics: { ...demoFrame.metrics, distanceCm: 65, relativeDepth: 1, headYaw: 0, headPitch: 0, shoulderDepth: 0, torsoLean: 0, ...demoScenarios[scenario].metrics } }
  const shownFrame = demo ? exampleFrame : active && (status === 'tracking' || status === 'no-face') ? frame : null
  const tips = getTips(shownFrame)
  const selectedTip = tips.find(tip => tip.id === selectedTipId) ?? tips[0]
  function toggleCamera() { setDemo(false); setFrame(null); setSeconds(0); setStatus(active ? 'idle' : 'loading'); setMessage(''); setActive(!active) }
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="./"><span className="brand-mark"><MicVocal size={23}/></span> singing<span className="brand-light">teacher</span><span className="beta">BETA</span></a>
        <div className="header-right"><span className="privacy"><ShieldCheck size={15}/> Private by design</span><button className="icon-button" aria-label="How it works" onClick={() => setHelp(!help)}><CircleHelp size={20}/></button></div>
      </header>
      <main>
        <section className="intro">
          <div><div className="eyebrow"><span/> YOUR PERSONAL PRACTICE STUDIO</div><h1>Find your voice.<br/><span>See what’s holding it back.</span></h1><p>Small adjustments. More freedom. A fresh perspective on how you sing.</p></div>
          <div className="session-controls"><button className={active ? 'start-button stop' : 'start-button'} onClick={toggleCamera}>{active ? <Square size={17}/> : <Camera size={19}/>} {active ? 'End session' : 'Start camera'}{!active && <ArrowUpRight size={19}/>}</button><button className="demo-button" onClick={() => { setActive(false); setFrame(null); setStatus('idle'); setMessage(''); setDemo(!demo) }}><Play size={12}/>{demo ? 'Exit demo' : 'Explore a demo'}</button></div>
        </section>
        {help && <aside className="help-box"><strong>Your practice, in three views.</strong> Allow camera access, frame your head and shoulders, and try a comfortable sustained vowel. The 3D movement guide follows facial landmarks and estimated body depth. Drag to orbit the model and select a cue to highlight related muscles. Camera distance is an approximation; use the depth reference to compare your position. Tips are experimental visual prompts, not an assessment of your voice or internal anatomy. Video stays in your browser; no microphone is used. <button onClick={() => setHelp(false)}>Got it</button></aside>}
        <div className="studio-bar"><div className="studio-label"><span className={`status-dot ${active || demo ? 'on' : ''}`}/>{demo ? 'DEMO SESSION' : active ? status === 'loading' ? 'PREPARING STUDIO' : 'LIVE SESSION' : 'READY WHEN YOU ARE'}</div><span className="session-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}<span className="bar-divider">/</span>FREE PRACTICE</span></div>
        <div className="studio-grid">
          <section className="studio-column"><div className="column-title"><span className="column-number">01</span><h2>Your view</h2><Camera size={16}/></div><div className="panel-body camera-wrap"><CameraPanel active={active} onFrame={setFrame} onStatus={onStatus}/>{demo && <div className="demo-cover"><div className="demo-avatar"><MicVocal size={48}/></div><span className="eyebrow">SAMPLE SESSION</span><h3>{demoScenarios[scenario].title}</h3><p>{demoScenarios[scenario].detail}</p><div className="demo-scenarios" aria-label="Demo scenario">{demoScenarios.map((item, index) => <button key={item.name} aria-pressed={scenario === index} onClick={() => { setScenario(index); setSelectedTipId(undefined) }}>{item.name}</button>)}</div><span className="demo-pill">Demo · camera is off</span></div>}</div><div className="panel-footer"><span className="tiny-dot"/>{demo ? 'Example data · not live analysis' : 'Frame your head and shoulders'}</div></section>
          <section className="studio-column"><div className="column-title"><span className="column-number">02</span><h2>Movement map</h2><Activity size={16}/></div><div className="panel-body"><AnatomyPanel frame={shownFrame} activeRegion={selectedTip?.region} activeMuscles={selectedTip?.muscles} demo={demo}/></div><div className="panel-footer"><Eye size={13}/> Anatomical reference · estimated movement</div></section>
          <section className="studio-column coach-column"><div className="column-title"><span className="column-number">03</span><h2>Your next adjustment</h2><span className="live-tag">{demo ? 'DEMO' : active && status === 'tracking' ? 'LIVE' : 'COACH'}</span></div><div className="panel-body"><CoachingPanel tips={tips} demo={demo} tracking={!!shownFrame?.face.length} selectedTipId={selectedTip?.id} onSelectTip={tip => setSelectedTipId(tip.id)}/></div><div className="panel-footer">Select a cue to explore its muscles.</div></section>
        </div>
        {message && <p className={`session-message ${status === 'error' ? 'error' : ''}`} role="status">{message}</p>}
        <section className="practice-note"><div className="note-icon">✳</div><div><span className="eyebrow">A GOOD PLACE TO START</span><p>Sing a comfortable “ah.” Stay curious. Let the next adjustment be a small one.</p></div><span className="note-label">NO PERFECT VOICES REQUIRED</span></section>
      </main>
      <footer className="site-footer"><span>Built for the voice that’s already yours.</span><span><ShieldCheck size={13}/> On-device video processing <span className="footer-dot">·</span> No recording</span></footer>
    </div>
  )
}
export default App
