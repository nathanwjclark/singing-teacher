import {CaptureProcessingOverlay} from './components/science/CaptureProcessingOverlay';
import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Camera, CircleHelp, MicVocal, Play, Square } from 'lucide-react'
import CameraPanel from './components/CameraPanel'
import AnatomyPanel from './components/AnatomyPanel'
import { SideAnatomyPanel } from './components/anatomy/SideAnatomyPanel'
import { useAnatomyMotion } from './hooks/useAnatomyMotion'
import AudioPanel from './components/AudioPanel'
import { CoachingPanel } from './components/CoachingPanel'
import type { VoiceActivity } from './lib/voiceActivity'
import { useRecentTips } from './hooks/useRecentTips'
import type { Metrics, TrackingFrame, TrackingStatus } from './types'
import PhonePairing from './components/phone/PhonePairing'
import PhoneCapturePage from './components/phone/PhoneCapturePage'
import { RecordingControls } from './components/recording/RecordingControls'
import type { RecordingController } from './components/recording/RecordingControls'
import type { FinishedRecording } from './lib/recording'
import type { AudioMeasurement, ObservationBundle, CandidateAnatomy, ContractRecord } from './contracts'
import { measureRecording } from './lib/recordingMeasurements'
import ExperimentDashboard from './components/experiments/ExperimentDashboard'
import { ExperimentRunner } from './components/experiments/ExperimentRunner'
import { AnatomyModes } from './components/anatomy/AnatomyModes'
import { ReproducibilityPanel } from './components/experiments/ReproducibilityPanel'
import { AcousticMappingPanel } from './components/experiments/AcousticMappingPanel'
import { DepthProtocolPanel } from './components/experiments/DepthProtocolPanel'
import { readExperimentLedger, subscribeExperimentLedger } from './experiment/ledger'
import { evaluatePrediction } from './evaluation'
import type { PredictionCommit } from './contracts'
import { MotionCapturePanel } from './components/motion/MotionCapturePanel'
import CoachLearningPanel from './components/coach/CoachLearningPanel'
import LearningMemoryPanel from './components/coach/LearningMemoryPanel'
import PhonationPanel from './phonation/PhonationPanel'
import { SourceInferencePanel } from './phonation/SourceInferencePanel'
import { LidarFusionPanel } from './components/lidar/LidarFusionPanel'
import SessionReplayPanel from './components/science/SessionReplayPanel'
import { ScientificModelPanel } from './components/science/ScientificModelPanel'
import { AstraCoachPanel } from './components/science/AstraCoachPanel'
import { ScientificSideView } from './components/science/ScientificGeometry'
import { NativePullButton } from './components/phone/NativePullButton'
import {ModelAdjustmentControls} from './components/science/ModelAdjustmentControls'
import {setModelAdjustments} from './components/science/modelAdjustments'
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
  { name: 'Tongue', title: 'Explore the visible tongue.', detail: 'A sample tongue moving side to side. Live estimates need an open mouth, visible tongue, and good light.', metrics: {mouthOpen:.8} },
  { name: 'Lip shape', title: 'Let the vowel take shape.', detail: 'Explore visible lip shape without forcing a smile or a pucker.', metrics: { mouthOpen: .25, headTilt: 2, shoulderTilt: 2, lipWidth: 1.02, jawAsymmetry: .2 } },
]

function StudioApp() {
  const [pairOpen,setPairOpen]=useState(false)
  const [tab,setTab]=useState<'studio'|'experiments'>('studio')
  const [learningRecall,setLearningRecall]=useState(false)
  const setLearningAssistance=useCallback((hidden:boolean)=>{setLearningRecall(hidden);if(hidden)setTab('experiments')},[])
  const [videoStream,setVideoStream]=useState<MediaStream|null>(null)
  const [audioStream,setAudioStream]=useState<MediaStream|null>(null)
  const [phoneMicrophone,setPhoneMicrophone]=useState<MediaStream|null>(null)
  const [observations,setObservations]=useState<ObservationBundle[]>([])
  const [measurements,setMeasurements]=useState<AudioMeasurement[]>([])
  const [candidates,setCandidates]=useState<CandidateAnatomy[]>([])
  const [importedRecords,setImportedRecords]=useState<ContractRecord[]>([])
  const [solverCalls,setSolverCalls]=useState('')
  const [articulationCount,setArticulationCount]=useState('')
  const [heldOut,setHeldOut]=useState(false)
  const [scoreWindow,setScoreWindow]=useState('0')
  const [ledger,setLedger]=useState(readExperimentLedger)
  useEffect(()=>subscribeExperimentLedger(()=>setLedger(readExperimentLedger())),[])
  const latestTrial=ledger.at(-1)
  const [recordingNotice,setRecordingNotice]=useState('Recording is off until you start it.')
  const recorder=useRef<RecordingController|null>(null)
  const captureContext=useRef<{predictionId:string;trialId:string;task:string}|null>(null)
  const transformRecording=useCallback((recording:FinishedRecording)=>{
    const context=captureContext.current
    if(!context)return recording
    const observationBundle={...recording.observationBundle,predictionId:context.predictionId,trialId:context.trialId,task:context.task}
    return {...recording,observationBundle,manifest:{...recording.manifest,observation:observationBundle}}
  },[])
  const onRecording=useCallback((recording:FinishedRecording)=>{
    setObservations(old=>[recording.observationBundle,...old.filter(o=>o.id!==recording.observationBundle.id)].slice(0,20))
    setRecordingNotice('Recording saved in this tab. Extracting acoustic measurements…')
    void measureRecording(recording).then(rows=>{
      setMeasurements(old=>[...rows,...old.filter(m=>m.observationId!==recording.observationBundle.id)].slice(0,12000))
      setRecordingNotice(rows.length?`Saved recording; ${rows.length} acoustic windows measured.`:'Saved recording; no decodable audio windows.')
    }).catch(()=>setRecordingNotice('Saved recording. This browser could not decode its audio for measurement; download it for offline analysis.'))
  },[])
  const startExperiment=useCallback(async(context:{predictionId:string;trialId:string;task:string})=>{
    if(!recorder.current)throw new Error('Recorder is unavailable')
    captureContext.current=context
    try{recorder.current.start()}catch(error){captureContext.current=null;throw error}
  },[])
  const stopExperiment=useCallback(async()=>{
    if(!recorder.current)throw new Error('Recorder is unavailable')
    try{const recording=await recorder.current.stop();return {observationBundle:recording.observationBundle}}finally{captureContext.current=null}
  },[])
  const scoreExperiment=useCallback(async({commit,observation,captureStartedAt}:{commit:PredictionCommit;observation:ObservationBundle;captureStartedAt:string})=>{
    if(!heldOut)throw new Error('Confirm held-out evidence before scoring.')
    if(solverCalls===''||articulationCount==='')throw new Error('Enter the actual solver-call and articulation-parameter counts from the engine run.')
    const audio=measurements.filter(m=>m.observationId===observation.id)[Number(scoreWindow)]
    if(!audio)throw new Error('Wait for recording measurements, then select an available scoring window.')
    return evaluatePrediction({commit,observation,audio,captureStartedAt,heldOut:{observationIds:[observation.id]},solverCallsUsed:Number(solverCalls),articulationParameterCount:Number(articulationCount)})
  },[heldOut,solverCalls,articulationCount,measurements,scoreWindow])
  const [active, setActive] = useState(true)
  const [demo, setDemo] = useState(false)
  const [scenario, setScenario] = useState(0)
  const [demoTime, setDemoTime] = useState(0)
  const voiceActivity=useRef<VoiceActivity|null>(null)
  const [selectedTipId, setSelectedTipId] = useState<string>()
  const [frame, setFrame] = useState<TrackingFrame | null>(null)
  const [status, setStatus] = useState<TrackingStatus>('loading')
  const [message, setMessage] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [help, setHelp] = useState(false)
  const [trackingEpoch,setTrackingEpoch]=useState(0)
  const [scientificPreview,setScientificPreview]=useState(false)
  useEffect(() => {
    const showScience = () => setTab('experiments');
    const showModel = () => { setScientificPreview(false); setTab('studio'); };
    window.addEventListener('singing:show-science', showScience);
    window.addEventListener('singing:show-model', showModel);
    return () => {
      window.removeEventListener('singing:show-science', showScience);
      window.removeEventListener('singing:show-model', showModel);
    };
  }, []);
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
  const exampleFrame: TrackingFrame = { ...demoFrame, tongue: demoScenarios[scenario].name === 'Tongue' ? {x:.5,y:.5,lateral:Math.sin(demoTime*1.5)*.8,lift:.5+Math.sin(demoTime)*.3,visibleFraction:.45,extension:(1+Math.sin(demoTime*1.2))*.35,elevation:Math.sin(demoTime*1.8)*.8} : undefined, pose: examplePose, worldPose: exampleWorld, blendshapes: {browInnerUp:brow,browOuterUpLeft:brow,browOuterUpRight:brow*.6,cheekSquintLeft:brow*.5,cheekSquintRight:brow*.5,mouthSmileLeft:brow*.7,mouthSmileRight:brow*.7}, metrics: { ...demoFrame.metrics, distanceCm: 65, relativeDepth: 1, headYaw: 0, headPitch: 0, shoulderDepth: 0, torsoLean: 0, ...demoScenarios[scenario].metrics } }
  const shownFrame = demo ? exampleFrame : active && (status === 'tracking' || status === 'no-face') ? frame : null
  const anatomyMotion = useAnatomyMotion(shownFrame, demo, trackingEpoch)
  const { tips, now: cueNow } = useRecentTips(shownFrame, `${trackingEpoch}:${demo ? 'demo' : active ? 'live' : 'idle'}`, {voice:voiceActivity,demo})
  const selectedTip = tips.find(tip => tip.id === selectedTipId) ?? tips[0]
  async function resetTracking(){await recorder.current?.stop().catch(()=>{});setModelAdjustments(null);setFrame(null);setDemo(false);setScientificPreview(false);setSelectedTipId(undefined);setSeconds(0);setStatus('loading');setMessage('');setTrackingEpoch(n=>n+1);setActive(true);
    try{const response=await fetch('/api/astra-review/reset',{method:'POST',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Reset failed');window.dispatchEvent(new Event('singing:astra-reset'))}
    catch{window.alert('Tracking reset, but the saved model review could not be cleared. Try Reset tracking again when the local server is available.')}
  }

  function toggleCamera() { setDemo(false); setFrame(null); setSeconds(0); setStatus(active ? 'idle' : 'loading'); setMessage(''); setActive(!active) }
  return (
    <div className="app-shell">
      <CaptureProcessingOverlay/>
      <header className="site-header">
        <a className="brand" href="./" aria-label="Tract Star home"><img src="/brand/tract-star-mark.png" alt="" width={32} height={32} style={{marginRight:8,objectFit:'contain'}}/>tract<span className="brand-light">star</span></a>
        <div className="studio-label"><span className={`status-dot ${active || demo ? 'on' : ''}`}/>{demo ? 'DEMO' : active ? status === 'loading' ? 'CONNECTING' : 'LIVE' : 'CAMERA OFF'}<span className="session-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span></div>
        <div className="header-controls">
          <button className={active ? 'start-button stop' : 'start-button'} onClick={toggleCamera}>{active ? <Square size={12}/> : <Camera size={15}/>} {active ? 'Stop camera' : 'Start camera'}</button>
          <button className="demo-button" onClick={()=>void resetTracking()} title="Reset tracking, calibration and model review; preserve saved recordings and the learned tongue profile">Reset tracking</button>
          <button className="demo-button" onClick={() => { setActive(false); setFrame(null); setStatus('idle'); setMessage(''); setDemo(!demo) }}><Play size={11}/>{demo ? 'Exit demo' : 'Demo'}</button>
          <button className="icon-button" aria-label="How it works" onClick={() => setHelp(!help)}><CircleHelp size={17}/></button>
        </div>
      </header>
      <div className="workspace-tools">
        <nav aria-label="Workspace"><button aria-pressed={tab==='studio'} disabled={learningRecall} onClick={()=>setTab('studio')}>Studio</button><button aria-pressed={tab==='experiments'} onClick={()=>setTab('experiments')}>Experiments</button></nav>
        <button onClick={()=>setPairOpen(true)}>Connect phone / QR</button>
        <ModelAdjustmentControls/><NativePullButton/>
        {phoneMicrophone && <span>Phone microphone connected</span>}
        <RecordingControls controllerRef={recorder} videoStream={videoStream} audioStream={audioStream} onRecording={onRecording} transformRecording={transformRecording}/>
      </div>
      <main style={tab==='studio'&&!learningRecall?undefined:{display:'none'}}>
        {help && <aside className="help-box"><strong>Your practice, in three views.</strong> Allow camera access, frame your head and shoulders, and try a comfortable sustained vowel. The 3D movement guide follows facial landmarks and estimated body depth. Drag to orbit the model and select a cue to highlight related muscles. Camera distance is an approximation; use the depth reference to compare your position. Tips are experimental visual prompts, not an assessment of your voice or internal anatomy. Live analysis stays in your browser. Explicit phone snapshots go to your local capture server; recordings are saved only when you press Start recording. Camera and microphone start automatically when browser permissions allow. If your browser pauses audio, use Enable audio in the audio pane. You can stop either device at any time. <button onClick={() => setHelp(false)}>Got it</button></aside>}
        <div className="studio-grid">
          <section className="studio-column"><div className="column-title"><span className="column-number">01</span><h2>Your view</h2><Camera size={16}/></div><div className="panel-body camera-wrap"><CameraPanel key={trackingEpoch} active={active} onFrame={setFrame} onStatus={onStatus} onStream={setVideoStream}/>{demo && <div className="demo-cover"><div className="demo-avatar"><MicVocal size={48}/></div><span className="eyebrow">SAMPLE SESSION</span><h3>{demoScenarios[scenario].title}</h3><p>{demoScenarios[scenario].detail}</p><div className="demo-scenarios" aria-label="Demo scenario">{demoScenarios.map((item, index) => <button key={item.name} aria-pressed={scenario === index} onClick={() => { setScenario(index); setDemoTime(0); setSelectedTipId(undefined) }}>{item.name}</button>)}</div><span className="demo-pill">Demo · camera is off</span></div>}</div></section>
          <section className="studio-column"><div className="column-title"><span className="column-number">02</span><h2>Movement map</h2><Activity size={16}/></div><div className="panel-body"><AnatomyModes candidates={candidates} scientificPreview={scientificPreview} onScientificPreview={setScientificPreview}><AnatomyPanel motion={anatomyMotion} frame={shownFrame} activeRegion={selectedTip?.region} activeMuscles={selectedTip?.muscles} demo={demo}/></AnatomyModes></div></section>
          <section className="studio-column"><div className="column-title"><span className="column-number">03</span><h2>Inside view</h2><Activity size={16}/></div><div className="panel-body">{scientificPreview?<ScientificSideView/>:<SideAnatomyPanel motion={anatomyMotion}/>}</div></section>
          <section className="studio-column coach-column"><div className="column-title"><span className="column-number">04</span><h2>Your next adjustments</h2><span className="live-tag">{demo ? 'DEMO' : active && status === 'tracking' ? 'LIVE' : 'COACH'}</span></div><div className="panel-body"><CoachingPanel tips={tips} demo={demo} tracking={!!shownFrame?.face.length} selectedTipId={selectedTip?.id} now={cueNow} onSelectTip={tip => setSelectedTipId(tip.id)}/></div></section>
        </div>
        {message && status === 'error' && <p className={`session-message ${status === 'error' ? 'error' : ''}`} role="status">{message}</p>}
        <AudioPanel onVoiceActivity={value=>{voiceActivity.current=value}} demo={demo} autoStart externalStream={phoneMicrophone} onStream={setAudioStream}/>
      </main>
      <main className="research-workspace" style={tab==='experiments'||learningRecall?undefined:{display:'none'}}>
        <h2>Experiments and evidence</h2><p>{recordingNotice}</p>
        {learningRecall&&<p role="status">Coaching cues are hidden during this unprompted learning phase. Return to the prompted phase to show them again.</p>}
        <div data-learning-assistance style={learningRecall?{display:'none'}:undefined}>
        <ScientificModelPanel onPreview={()=>{setScientificPreview(true);setTab('studio')}}/>
        <AstraCoachPanel/>
        <LearningMemoryPanel/>
        <PhonationPanel audioStream={audioStream}/>
        <SourceInferencePanel/>
        <LidarFusionPanel/>
        <SessionReplayPanel/>
        <AcousticMappingPanel/>
        <MotionCapturePanel frame={!demo&&active?frame:null} videoStream={videoStream} audioStream={audioStream}/>
        </div>
        <CoachLearningPanel videoStream={videoStream} audioStream={audioStream} onAssistanceHiddenChange={setLearningAssistance}/>
        <div data-learning-assistance style={learningRecall?{display:'none'}:undefined}>
        <p>{observations.length} recorded observations · {measurements.length} measured audio windows</p>
        <p>The native scientific engine is available locally. Import validated engine artifacts to inspect them; human-audio fitting and measured phone depth remain separate acceptance steps.</p>
        <ExperimentDashboard observations={observations} measurements={measurements} onCandidates={setCandidates} onRecords={setImportedRecords}>
        <ExperimentRunner onStartCapture={startExperiment} onStopCapture={stopExperiment} onEvaluate={scoreExperiment}/>
        <section className="scoring-setup"><h3>Independent scoring setup</h3><p>Use the actual engine-run counts. These declarations are recorded by the evaluator; they do not generate a forecast.</p>
          <label>Solver calls used <input type="number" min="0" value={solverCalls} onChange={e=>setSolverCalls(e.target.value)}/></label>
          <label>Articulation parameters <input type="number" min="0" value={articulationCount} onChange={e=>setArticulationCount(e.target.value)}/></label>
          <label>Recorded audio window <input type="number" min="0" value={scoreWindow} onChange={e=>setScoreWindow(e.target.value)}/></label>
          <label><input type="checkbox" checked={heldOut} onChange={e=>setHeldOut(e.target.checked)}/> This observation was held out from fitting</label>
        </section>
        <ReproducibilityPanel records={[...observations,...measurements,...importedRecords]} trials={ledger}/>
        <DepthProtocolPanel observation={latestTrial?.observation??observations[0]} commit={latestTrial?.commit??undefined} captureStartedAt={latestTrial?.captureStartedAt??undefined}/>
        </ExperimentDashboard>
        </div>
      </main>
      <PhonePairing open={pairOpen} onClose={()=>setPairOpen(false)} onMicrophoneStream={setPhoneMicrophone}/>
    </div>
  )
}
export default function App(){return window.location.pathname==='/phone'?<PhoneCapturePage/>:<StudioApp/>}
