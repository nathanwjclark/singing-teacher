import { useCallback, useEffect, useState } from 'react'
import { Activity, Camera, CircleHelp, MicVocal, Play, Square } from 'lucide-react'
import CameraPanel from './components/CameraPanel'
import AnatomyPanel from './components/AnatomyPanel'
import AudioPanel from './components/AudioPanel'
import { CoachingPanel } from './components/CoachingPanel'
import { useRecentTips } from './hooks/useRecentTips'
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
  { name: 'Expression', title: 'Let your face join in.', detail: 'Watch brows, cheeks, and each shoulder move independently.', metrics: { mouthOpen: .24, headTilt: 0, shoulderTilt: 0 } },
  { name: 'Lip shape', title: 'Let the vowel take shape.', detail: 'Explore visible lip shape without forcing a smile or a pucker.', metrics: { mouthOpen: .25, headTilt: 2, shoulderTilt: 2, lipWidth: 1.02, jawAsymmetry: .2 } },
]

function App() {
  const [active, setActive] = useState(true)
  const [demo, setDemo] = useState(false)
  const [scenario, setScenario] = useState(0)
  const [demoTime, setDemoTime] = useState(0)
  const [selectedTipId, setSelectedTipId] = useState<string>()
  const [frame, setFrame] = useState<TrackingFrame | null>(null)
  const [status, setStatus] = useState<TrackingStatus>('loading')
  const [message, setMessage] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [help, setHelp] = useState(false)
  const onStatus = useCallback((value: TrackingStatus, detail?: string) => { setStatus(previous => value === 'idle' && previous === 'error' ? previous : value); if (value !== 'idle') setMessage(detail ?? ''); if(value === 'error') setActive(false) }, [])
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => setSeconds(s => s + 1), 1000); return () => window.clearInterval(timer) }, [active])
  useEffect(() => {
    if (!demo) return;
    const start = performance.now();
    const timer = window.setInterval(() => setDemoTime((performance.now() - start) / 1000), 100);
    return () => clearInterval(timer);
  }, [demo, scenario]);
  const expressive = demoScenarios[scenario].name === 'Expression';
  const shoulderLift = (expressive || scenario === 2) && demoTime > 1 ? (1 - Math.cos((demoTime - 1) * 1.8)) * .035 : 0;
  const brow = expressive ? (1 - Math.cos(demoTime * 1.5)) * .45 : 0;
  const examplePose = demoFrame.pose.map(p => ({...p}));
  examplePose[11] = {x:.68,y:.55 - shoulderLift,z:0,visibility:1};
  examplePose[12] = {x:.32,y:.55,z:0,visibility:1};
  examplePose[23] = {x:.61,y:.95,z:0,visibility:1};
  examplePose[24] = {x:.39,y:.95,z:0,visibility:1};
  const exampleWorld = examplePose.map(() => ({x:0,y:0,z:0,visibility:1}));
  exampleWorld[11] = {x:.18,y:-.52-shoulderLift,z:scenario === 2 ? .09 : 0,visibility:1};
  exampleWorld[12] = {x:-.18,y:-.52,z:scenario === 2 ? -.09 : 0,visibility:1};
  exampleWorld[23] = {x:.14,y:0,z:0,visibility:1};
  exampleWorld[24] = {x:-.14,y:0,z:0,visibility:1};
  const exampleFrame: TrackingFrame = { ...demoFrame, pose: examplePose, worldPose: exampleWorld, blendshapes: {browInnerUp:brow,browOuterUpLeft:brow,browOuterUpRight:brow*.6,cheekSquintLeft:brow*.5,cheekSquintRight:brow*.5,mouthSmileLeft:brow*.7,mouthSmileRight:brow*.7}, metrics: { ...demoFrame.metrics, distanceCm: 65, relativeDepth: 1, headYaw: 0, headPitch: 0, shoulderDepth: 0, torsoLean: 0, ...demoScenarios[scenario].metrics } }
  const shownFrame = demo ? exampleFrame : active && (status === 'tracking' || status === 'no-face') ? frame : null
  const { tips, now: cueNow } = useRecentTips(shownFrame, demo ? 'demo' : active ? 'live' : 'idle')
  const selectedTip = tips.find(tip => tip.id === selectedTipId) ?? tips[0]
  function toggleCamera() { setDemo(false); setFrame(null); setSeconds(0); setStatus(active ? 'idle' : 'loading'); setMessage(''); setActive(!active) }
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="./"><span className="brand-mark"><MicVocal size={19}/></span>singing<span className="brand-light">teacher</span></a>
        <div className="studio-label"><span className={`status-dot ${active || demo ? 'on' : ''}`}/>{demo ? 'DEMO' : active ? status === 'loading' ? 'CONNECTING' : 'LIVE' : 'CAMERA OFF'}<span className="session-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span></div>
        <div className="header-controls">
          <button className={active ? 'start-button stop' : 'start-button'} onClick={toggleCamera}>{active ? <Square size={12}/> : <Camera size={15}/>} {active ? 'Stop camera' : 'Start camera'}</button>
          <button className="demo-button" onClick={() => { setActive(false); setFrame(null); setStatus('idle'); setMessage(''); setDemo(!demo) }}><Play size={11}/>{demo ? 'Exit demo' : 'Demo'}</button>
          <button className="icon-button" aria-label="How it works" onClick={() => setHelp(!help)}><CircleHelp size={17}/></button>
        </div>
      </header>
      <main>
        {help && <aside className="help-box"><strong>Your practice, in three views.</strong> Allow camera access, frame your head and shoulders, and try a comfortable sustained vowel. The 3D movement guide follows facial landmarks and estimated body depth. Drag to orbit the model and select a cue to highlight related muscles. Camera distance is an approximation; use the depth reference to compare your position. Tips are experimental visual prompts, not an assessment of your voice or internal anatomy. Video and audio stay in your browser. Camera and microphone start automatically when browser permissions allow. If your browser pauses audio, use Enable audio in the audio pane. You can stop either device at any time. <button onClick={() => setHelp(false)}>Got it</button></aside>}
        <div className="studio-grid">
          <section className="studio-column"><div className="column-title"><span className="column-number">01</span><h2>Your view</h2><Camera size={16}/></div><div className="panel-body camera-wrap"><CameraPanel active={active} onFrame={setFrame} onStatus={onStatus}/>{demo && <div className="demo-cover"><div className="demo-avatar"><MicVocal size={48}/></div><span className="eyebrow">SAMPLE SESSION</span><h3>{demoScenarios[scenario].title}</h3><p>{demoScenarios[scenario].detail}</p><div className="demo-scenarios" aria-label="Demo scenario">{demoScenarios.map((item, index) => <button key={item.name} aria-pressed={scenario === index} onClick={() => { setScenario(index); setDemoTime(0); setSelectedTipId(undefined) }}>{item.name}</button>)}</div><span className="demo-pill">Demo · camera is off</span></div>}</div></section>
          <section className="studio-column"><div className="column-title"><span className="column-number">02</span><h2>Movement map</h2><Activity size={16}/></div><div className="panel-body"><AnatomyPanel frame={shownFrame} activeRegion={selectedTip?.region} activeMuscles={selectedTip?.muscles} demo={demo}/></div></section>
          <section className="studio-column coach-column"><div className="column-title"><span className="column-number">03</span><h2>Your next adjustments</h2><span className="live-tag">{demo ? 'DEMO' : active && status === 'tracking' ? 'LIVE' : 'COACH'}</span></div><div className="panel-body"><CoachingPanel tips={tips} demo={demo} tracking={!!shownFrame?.face.length} selectedTipId={selectedTip?.id} now={cueNow} onSelectTip={tip => setSelectedTipId(tip.id)}/></div></section>
        </div>
        {message && status === 'error' && <p className={`session-message ${status === 'error' ? 'error' : ''}`} role="status">{message}</p>}
        <AudioPanel demo={demo} autoStart/>
      </main>

    </div>
  )
}
export default App
