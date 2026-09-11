import { useState } from 'react'
import { saveProbeSetup } from './probeClient'
import type { ProbeSetupStatus, ProbeProfile, ProbePlacement } from './probeClient'

type CalibrationPackage = {
  kind: string; schema_version: string; pose?: string; trial_id?: string; placement?: ProbePlacement;
  calibration: { kind: string; calibration_id: string; placement_id: string; route_id: string; frequency_hz: number[] };
  nuisance_prior: { bounds: Record<string, number[]> };
  evidence: { path: string; sha256: string; byteCount: number }[];
}
const controls = ['JA', 'gain', 'direct_gain', 'coupling_gain', 'delay_s'] as const
const labels = { JA: 'Declared jaw control (−5 to −1)', gain: 'Overall gain', direct_gain: 'Direct-path gain', coupling_gain: 'Cavity-coupling gain', delay_s: 'Residual delay (seconds)' }
const positions = ['source_m', 'microphone_m', 'mouth_m'] as const
const positionLabels = { source_m: 'Loudspeaker position (m)', microphone_m: 'Microphone position (m)', mouth_m: 'Mouth position (m)' }
async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
function numeric(value: string, label: string) {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`Enter a finite value for ${label}.`)
  return Number(value)
}

export function ProbeSetupPanel({ status, busy, onSaved }: { status?: ProbeSetupStatus; busy: boolean; onSaved: () => void }) {
  const [packageFile, setPackageFile] = useState<File | null>(null), [calibration, setCalibration] = useState<CalibrationPackage | null>(null)
  const [files, setFiles] = useState<File[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false)
  const [placementId, setPlacementId] = useState(''), [frame, setFrame] = useState(''), [pose, setPose] = useState(''), [trial, setTrial] = useState('')
  const [coordinates, setCoordinates] = useState<Record<string, string[]>>({ source_m: ['', '', ''], microphone_m: ['', '', ''], mouth_m: ['', '', ''] })
  const [profile, setProfile] = useState<Record<string, string>>({ JA: '', gain: '', direct_gain: '', coupling_gain: '', delay_s: '' })
  const [declared, setDeclared] = useState(false)
  const capture = status?.capture
  async function loadPackage(file?: File) {
    setError(''); setNotice(''); setDeclared(false); setCalibration(null); setPackageFile(null); setFiles([])
    if (!file) return
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Calibration package exceeds 2 MB.')
      const value: CalibrationPackage = JSON.parse(await file.text())
      if (value?.schema_version !== '0.1.0' || !['probe_calibration_package', 'probe_science_import_configuration'].includes(value.kind) || !value.calibration || !Array.isArray(value.calibration.frequency_hz) || !Array.isArray(value.evidence) || !value.evidence.length || !value.nuisance_prior?.bounds) throw new Error('Use a calibration package with frequency calibration, nuisance priors and original evidence descriptors.')
      setPackageFile(file); setCalibration(value)
      setPlacementId(value.calibration.placement_id ?? capture?.placementId ?? '')
      setFrame(value.placement?.coordinate_frame ?? '')
      setPose(capture?.pose ?? value.pose ?? '')
      setTrial(value.trial_id ?? (capture ? `probe-${capture.captureId}` : ''))
      setCoordinates(Object.fromEntries(positions.map(key => [key, value.placement?.[key]?.map(String) ?? ['', '', '']])))
      setProfile(Object.fromEntries(controls.map(key => {
        const bound = value.nuisance_prior.bounds[key]
        return [key, bound?.length === 2 && bound[0] === bound[1] ? String(bound[0]) : '']
      })))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  async function save() {
    setError(''); setNotice(''); setSaving(true)
    try {
      if (!capture || !packageFile || !calibration || !declared) throw new Error('Import a probe, load calibration evidence and declare its placement first.')
      if (files.length !== calibration.evidence.length || files.some(file => file.size > 16 * 1024 * 1024) || files.reduce((n, file) => n + file.size, 0) > 16 * 1024 * 1024) throw new Error('Upload every listed original evidence file (16 MB total maximum).')
      const placement: ProbePlacement = { placement_id: placementId.trim(), coordinate_frame: frame.trim(), source_m: [], microphone_m: [], mouth_m: [] }
      for (const key of positions) placement[key] = coordinates[key].map((v, i) => numeric(v, `${positionLabels[key]} ${'XYZ'[i]}`))
      const fixed = Object.fromEntries(controls.map(key => [key, numeric(profile[key], labels[key])])) as unknown as ProbeProfile
      const [packageBase64, evidence] = await Promise.all([base64(packageFile), Promise.all(files.map(async file => ({ name: file.name, base64: await base64(file) })))])
      const result = await saveProbeSetup({ requestId: crypto.randomUUID(), importId: capture.importId, manifestSha256: capture.manifestSha256,
        packageBase64, evidence, placement, profile: fixed, trialId: trial.trim(), pose: pose.trim() })
      setNotice(`Calibration setup saved: ${result.setup.setupId}. Analyze latest probe to use these exact verified settings.`)
      setDeclared(false); onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setSaving(false) }
  }
  return <details className="probe-setup">
    <summary>Calibration setup</summary>
    <section aria-label="Probe calibration setup" aria-busy={saving}>
      <p>Import a calibration package from your measurement workflow and its original evidence files. The app verifies hashes and capture compatibility. File verification does not establish physical calibration accuracy; a level check alone does not measure speaker or microphone response.</p>
      {!capture && <p>Analyze the latest probe first to retain and identify its original capture.</p>}
      {capture && <p>Capture: {capture.captureId} · {capture.provenance}. {capture.provenance === 'software-fixture' && <strong>Generated software evidence; not a human or device measurement.</strong>}</p>}
      {status?.legacyConfiguration && <p>An existing private configuration is available. Saving here replaces the active setup while preserving its files.</p>}
      {status?.error && <p role="alert">{status.error}</p>}
      <fieldset disabled={!capture || busy || saving}>
        <legend>Original calibration evidence</legend>
        <label>Calibration package JSON<input type="file" accept="application/json,.json" onChange={event => void loadPackage(event.currentTarget.files?.[0])}/></label>
        {calibration && <>
          <p>{calibration.calibration.calibration_id} · {calibration.calibration.kind} · route {calibration.calibration.route_id}. {calibration.calibration.frequency_hz.length} exact frequency bins.</p>
          <ul>{calibration.evidence.map(item => <li key={item.path}>{item.path} · {item.byteCount} bytes · SHA-256 <code>{item.sha256}</code></li>)}</ul>
          <label>Original calibration evidence files<input type="file" multiple onChange={event => { setFiles(Array.from(event.currentTarget.files ?? [])); setDeclared(false) }}/></label>
          <div className="probe-setup-grid">
            <label>Placement ID<input value={placementId} onChange={e => { setPlacementId(e.target.value); setDeclared(false) }}/></label>
            <label>Coordinate frame<input value={frame} onChange={e => { setFrame(e.target.value); setDeclared(false) }}/></label>
            <label>Held-quiet pose<input value={pose} onChange={e => { setPose(e.target.value); setDeclared(false) }}/></label>
            <label>Probe trial ID<input value={trial} onChange={e => { setTrial(e.target.value); setDeclared(false) }}/></label>
          </div>
          {positions.map(key => <fieldset key={key}><legend>{positionLabels[key]}</legend><div className="probe-coordinate-grid">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`${positionLabels[key]} ${axis}`} type="number" step="any" value={coordinates[key][i]} onChange={e => { setCoordinates(old => ({ ...old, [key]: old[key].map((v, n) => n === i ? e.target.value : v) })); setDeclared(false) }}/></label>)}</div></fieldset>)}
          <p>Controls below are declared experimental assumptions. Jaw control is a model parameter, not a measured jaw angle. Gain and delay must stay within the supplied calibration prior.</p>
          <div className="probe-setup-grid">{controls.map(key => <label key={key}>{labels[key]}<input type="number" step="any" value={profile[key]} onChange={e => { setProfile(old => ({ ...old, [key]: e.target.value })); setDeclared(false) }}/>{key !== 'JA' && <small>Prior: {calibration.nuisance_prior.bounds[key]?.join(' to ')}</small>}</label>)}</div>
          <label className="probe-declaration"><input type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)}/>I declare that this calibration, route, placement and held-quiet pose apply to the selected capture.</label>
          <button disabled={!declared || !files.length} onClick={() => void save()}>Verify and save calibration setup</button>
        </>}
      </fieldset>
      {error && <p role="alert" className="probe-error">{error}</p>}
      {(saving || notice) && <p role="status">{saving ? 'Verifying original evidence and exact response frequencies…' : notice}</p>}
      {status?.setup && <details><summary>Saved setup and evidence lineage</summary><p>Setup {status.setup.setupId} · {status.setup.calibrationKind}. {status.setup.frequencyHz.length} verified frequency bins. Included in fit: no; use the fitting action after analysis.</p><p>Configuration SHA-256: <code>{status.setup.configurationSha256}</code><br/>Controls SHA-256: <code>{status.setup.profileSha256}</code></p></details>}
    </section>
  </details>
}
