import {Component, lazy, Suspense, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {getAstraStatus} from '../components/science/astraClient';
import type {AstraStatus} from '../components/science/astraClient';
import {EVIDENCE_MODES, MECHANISMS, getCue, getMechanism} from './mechanisms';
import type {DemonstrationId, EvidenceMode} from './mechanisms';
import {comparisonRows, getTeachingStatus, prepareTeaching, teachingAssetBlob} from './teachingClient';
import type {TeachingAsset, TeachingCanonical, TeachingStatus} from './teachingClient';
import './TeachingPanel.css';

const Illustration = lazy(() => import('./MechanismIllustration').then(module => ({default: module.MechanismIllustration})));
class IllustrationFallback extends Component<{children: ReactNode; text: string}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {return this.state.failed ? <p>{this.props.text}</p> : this.props.children;}
}
const format = (value: number | null) => value === null ? 'Unavailable' : Number(value.toPrecision(4)).toString();
function Comparison({before, after, labels}: {before?: TeachingCanonical; after?: TeachingCanonical; labels: [string, string]}) {
  const rows = comparisonRows(before, after);
  return rows.length ? <div className="teaching-table"><table><thead><tr><th>Acoustic measure</th><th>{labels[0]}</th><th>{labels[1]}</th><th>Difference</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.name + row.unit}><th>{row.name} ({row.unit})</th><td>{format(row.before)}</td><td>{format(row.after)}</td><td>{format(row.difference)}</td></tr>)}</tbody></table></div>
    : <p>Compatible acoustic measurements are unavailable. No numerical change is inferred.</p>;
}
function VerifiedMedia({asset, label, audio = false}: {asset?: TeachingAsset; label: string; audio?: boolean}) {
  const [loaded, setLoaded] = useState<{key: string; url: string} | null>(null), [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const key = asset ? asset.url + asset.sha256 : '';
  useEffect(() => () => {active.current?.abort(); if (loaded) URL.revokeObjectURL(loaded.url);}, [loaded, key]);
  async function load() {
    if (!asset) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller; setError('');
    try {const blob = await teachingAssetBlob(asset, controller.signal); if (!controller.signal.aborted) setLoaded({key, url: URL.createObjectURL(blob)});}
    catch (reason) {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Media unavailable.');}
  }
  const url = loaded?.key === key ? loaded.url : null;
  return <figure className="teaching-media"><figcaption>{label}</figcaption>
    {!asset ? <p>This media was not retained.</p> : !url ? <button type="button" onClick={() => void load()}>Load {label}</button>
      : audio ? <audio controls preload="none" src={url} aria-label={label} onPlay={event => {
        document.querySelectorAll<HTMLAudioElement>('.teaching-panel audio').forEach(player => {if (player !== event.currentTarget) player.pause();});
      }} onError={() => setError('Audio cannot play in this browser. The measurements and text remain available.')}/>
        : <img src={url} alt={label + '; native model hypothesis, not measured anatomy'} onError={() => setError('Image cannot display. The text and numerical comparison remain available.')}/>}
    {error && <p role="status">{error}</p>}
  </figure>;
}

/** Independent teaching view over existing scientific/Astra records; never owns capture or a new ledger. */
export default function TeachingPanel({refreshKey = 0}: {refreshKey?: number | string}) {
  const [mode, setMode] = useState<EvidenceMode>('general-explanation');
  const [chosen, setChosen] = useState<DemonstrationId>('cricothyroid-pitch');
  const [astra, setAstra] = useState<AstraStatus | null>(null), [status, setStatus] = useState<TeachingStatus | null>(null);
  const [expanded, setExpanded] = useState(false), [refresh, setRefresh] = useState(0), [error, setError] = useState(''), [preparing, setPreparing] = useState(false);
  const prepareController = useRef<AbortController | null>(null);
  useEffect(() => () => prepareController.current?.abort(), []);
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    window.addEventListener('singing:science-result', update);
    return () => window.removeEventListener('singing:science-result', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const [a, s] = await Promise.allSettled([getAstraStatus(controller.signal), getTeachingStatus(controller.signal)]);
      if (controller.signal.aborted) return;
      setAstra(a.status === 'fulfilled' ? a.value : null);
      setStatus(s.status === 'fulfilled' ? s.value : null);
      setError(s.status === 'rejected' ? 'Personalized teaching is unavailable. General explanations remain available.' : '');
      timer = setTimeout(() => void load(), s.status === 'fulfilled' && s.value.status === 'running' ? 1500 : 5000);
    }
    void load(); return () => {controller.abort(); clearTimeout(timer);};
  }, [refresh, refreshKey]);
  const decision = astra?.latest?.decision as (NonNullable<AstraStatus['latest']>['decision'] & {demonstrationId?: string | null; cueId?: string | null}) | undefined;
  const selectedMechanism = getMechanism(decision?.demonstrationId);
  const mechanism = getMechanism(mode === 'general-explanation' ? chosen : selectedMechanism?.id) || getMechanism(chosen)!;
  const cue = getCue(decision?.demonstrationId, decision?.cueId);
  const result = status?.result;
  const matched = !!result && result.designId === astra?.latest?.designId && result.modelId === astra?.latest?.modelId
    && result.demonstrationId === selectedMechanism?.id;
  const canPrepare = status?.enabled && astra?.latestCurrent && decision?.action === 'record' && selectedMechanism?.id === 'tongue-jaw-vowels'
    && !!astra.latest?.modelId && !!astra.latest.designId;
  async function prepare() {
    if (!canPrepare || preparing || !astra?.latest?.modelId || !astra.latest.designId) return;
    setPreparing(true); setError(''); const controller = new AbortController(); prepareController.current = controller;
    try {await prepareTeaching(selectedMechanism!.id, astra.latest.modelId, astra.latest.designId, controller.signal); if (!controller.signal.aborted) setRefresh(value => value + 1);}
    catch (reason) {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Comparison could not be prepared.');}
    finally {if (!controller.signal.aborted) setPreparing(false);}
  }
  return <section className="teaching-panel" aria-label="Understand your singing cue">
    <div className="teaching-heading"><h3>Understand your singing cue</h3><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh teaching view</button></div>
    {decision ? <div className="teaching-current-cue"><p><strong>{astra?.latestCurrent ? 'Current Astra instruction' : 'Previous Astra instruction'}</strong></p><p>{decision.cue}</p>
      {!selectedMechanism && <p>This instruction has no linked demonstration. Explore the general explanations below.</p>}
      {selectedMechanism && <button type="button" onClick={() => {setChosen(selectedMechanism.id); setMode('general-explanation'); setExpanded(true);}}>Explain this instruction</button>}
    </div> : <p>Explore how voice production works, or ask Astra for an experiment after fitting a recording.</p>}
    <fieldset className="teaching-modes"><legend>What are you viewing?</legend>{(Object.keys(EVIDENCE_MODES) as EvidenceMode[]).map(key =>
      <label key={key}><input type="radio" name="teaching-mode" checked={mode === key} onChange={() => setMode(key)}/>{EVIDENCE_MODES[key].label}</label>)}</fieldset>
    <p>{EVIDENCE_MODES[mode].explanation}</p>
    {error && <p role="status">{error}</p>}
    {mode === 'general-explanation' ? <>
      <label>Explore a mechanism<select value={chosen} onChange={event => setChosen(event.target.value as DemonstrationId)}>{MECHANISMS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <h4>{mechanism.title}</h4><p>{mechanism.mechanism}</p>
      <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>See before and after</summary>
        {expanded && <IllustrationFallback key={mechanism.id} text={`${mechanism.illustration.before} → ${mechanism.illustration.after}. ${mechanism.illustration.caption}`}><Suspense fallback={<p>{mechanism.illustration.before} → {mechanism.illustration.after}. {mechanism.illustration.caption}</p>}><Illustration demonstrationId={mechanism.id}/></Suspense></IllustrationFallback>}
      </details>
      <p><strong>What to notice:</strong> {cue && selectedMechanism?.id === mechanism.id ? cue.notice : mechanism.cues[0].notice}</p>
      <ul>{mechanism.limits.map(limit => <li key={limit}>{limit}</li>)}</ul><p>{mechanism.comfort}</p>
      <details><summary>References and interpretation</summary>{mechanism.sources.map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> — {source.scope}</p>)}<p>Reference-checked educational content; no personal anatomical measurement or specialist approval is implied.</p></details>
    </> : <>
      {!matched ? <p>{selectedMechanism?.id === 'tongue-jaw-vowels' ? 'Prepare the comparison for the current committed instruction.' : 'This mechanism currently has a general explanation only. No personalized hidden movement is simulated.'}</p>
        : <><p>{status?.current ? 'Bound to the current model and committed experiment.' : 'Historical comparison: the model or experiment has advanced. This is not a new recording instruction.'}</p>
          <p>Prediction committed <time dateTime={result!.committedAt}>{new Date(result!.committedAt).toLocaleString()}</time>. Showing hypothesis {result!.hypothesisId} of {result!.hypothesisCount}; other retained hypotheses can disagree.</p>
          {mode === 'model-prediction' ? <>
            {result!.capabilities.geometry.available ? <div className="teaching-pair"><VerifiedMedia asset={result!.before.geometry?.svg} label="Before: model geometry"/><VerifiedMedia asset={result!.after.geometry?.svg} label="After: model geometry"/></div> : <p>{result!.capabilities.geometry.reason || 'Personalized geometry is unavailable.'}</p>}
            <Comparison before={result!.before.prediction.canonical} after={result!.after.prediction.canonical} labels={['Before prediction', 'After prediction']}/>
            <p>Model synthesis is not your future voice. Playback is optional; start either sample yourself.</p>
            {result!.playback && <p>Playback uses {result!.playback.normalization} (gain {result!.playback.gainApplied}). Stored measurements are unchanged.</p>}
            {result!.capabilities.synthesis.available ? <div className="teaching-pair"><VerifiedMedia audio asset={result!.before.audio} label="A: model sound before"/><VerifiedMedia audio asset={result!.after.audio} label="B: model sound after"/></div> : <p>{result!.capabilities.synthesis.reason || 'Model audio is unavailable.'}</p>}
          </> : result!.outcome ? <>
            <p>Recorded <time dateTime={result!.outcome.observedAt}>{new Date(result!.outcome.observedAt).toLocaleString()}</time> · {result!.outcome.sourceKind}</p>
            <Comparison before={result!.after.prediction.canonical} after={result!.outcome.canonical} labels={['Frozen prediction', 'Recorded measurement']}/>
            <p>{result!.outcome.interpretation}</p><p>{result!.outcome.modelUpdated ? 'The recorded result updated the model.' : 'The model was retained without an update.'}</p>
            {result!.outcome.originalAudio.available && result!.outcome.originalAudio.asset ? <VerifiedMedia audio asset={result!.outcome.originalAudio.asset} label="Your recorded attempt"/> : <p>{result!.outcome.originalAudio.reason || 'Recorded audio playback is unavailable; no substitute sound is used.'}</p>}
          </> : <p>No matching scored recording is available. Record the committed instruction and score the new capture in the existing scientific panel.</p>}
          <details><summary>Conditions and evidence</summary><p>Model {result!.modelId} · design {result!.designId}</p><p>Before: vowel {result!.before.pose}, pitch {result!.before.controls.f0_hz} Hz, jaw {result!.before.controls.JA}°, gain {result!.before.controls.gain}. After: vowel {result!.after.pose}, pitch {result!.after.controls.f0_hz} Hz, jaw {result!.after.controls.JA}°, gain {result!.after.controls.gain}.</p><ul>{result!.assumptions.map(value => <li key={value}>{value}</li>)}</ul></details>
        </>}
      {mode === 'model-prediction' && <button type="button" disabled={!canPrepare || preparing || status?.status === 'running'} onClick={() => void prepare()}>{preparing || status?.status === 'running' ? 'Preparing comparison…' : 'Prepare this model comparison'}</button>}
      {status?.reason && <p role="status">{status.reason}</p>}
    </>}
    <p>Use the existing recording controls to try a committed instruction, then save how it felt in Personal cue memory. Viewing or scrubbing this explanation does not start a recording or change your model.</p>
  </section>;
}
