/** Synthetic inputs for science/scripts/import_probe_science.ts: the fixture generator's capture plus a declared
 * software calibration configuration. Kept out of the test file so the Python tests can load it through `node -e`
 * without running the TypeScript tests. The caller removes `root`. */
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { makeFixture } from '../../scripts/acoustic-probe-fixture.ts'

export async function setupFixture() {
  const root = await mkdtemp(join(tmpdir(), 'probe-science-'))
  const capture = join(root, 'capture'), native = await makeFixture(capture)
  const evidence = Buffer.from('Declared software calibration: unit test fixture, not measured hardware.')
  const digest = createHash('sha256').update(evidence).digest('hex')
  await writeFile(join(root, 'calibration-evidence.txt'), evidence)
  const indices = [80, 100, 128], f = indices.map(i => i * 16000 / 4096)
  const manifestHash = createHash('sha256').update(await readFile(join(capture, 'manifest.json'))).digest('hex')
  const config = { capture_binding: { manifest_sha256: manifestHash, pose: 'a', placement_id: 'placement', route_id: 'fixture-route' }, schema_version: '0.1.0', kind: 'probe_science_import_configuration', trial_id: 'native-filter', pose: 'a', pose_state: 'held-quiet', comparison: 'complex', selected_indices: indices,
    evidence: [{ path: 'calibration-evidence.txt', sha256: digest, byteCount: evidence.length }],
    placement: { placement_id: 'placement', coordinate_frame: 'fixture-meters', source_m: [.15, 0, 0], microphone_m: [.12, .05, 0], mouth_m: [0, 0, 0] },
    calibration: { calibration_id: 'fixture-calibration', route_id: 'fixture-route', placement_id: 'placement', kind: 'synthetic-fixture', frequency_hz: f, source_volume_velocity_real: [1e-5, 1e-5, 1e-5], source_volume_velocity_imag: [0, 0, 0], microphone_gain_real: [.01, .01, .01], microphone_gain_imag: [0, 0, 0], source_hashes: [digest], delay_s: 0 },
    processing: { kind: 'declared-software-fixture', evidence_id: 'known-fir', route_id: 'fixture-route', source_hashes: [digest] },
    nuisance_prior: { prior_id: 'fixture-prior', source_hashes: [digest], bounds: { gain: [1, 1], direct_gain: [1, 1], coupling_gain: [1, 1], delay_s: [0, 0] } },
    bands: [{ low_hz: 300, high_hz: 501, sigma: .01, weight: 1 }],
    conditions: { termination: 'rigid', termination_resistance_pa_s_m3: null, attenuation_np_per_m: .5 } }
  const configPath = join(root, 'config.json')
  await writeFile(configPath, JSON.stringify(config))
  return { root, capture, native, config, configPath }
}

// A self-declared "measured" package (hand-written arrays, typed placement) is metadata, not measurement.
export async function declaredMeasuredPackage(provenance: 'human-recording' | 'physical-reference') {
  const fixture = await setupFixture(), { capture, native, config, configPath } = fixture
  Object.assign(native, { provenance, pose: 'a' }); native.calibration = { ...native.calibration, placementId: 'placement', levelCheck: { routeSignature: 'declared-route' } }
  await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  config.calibration.kind = 'measured'; Object.assign(config.processing, { kind: 'characterized-measurement' })
  Object.assign(config.capture_binding, { manifest_sha256: createHash('sha256').update(await readFile(join(capture, 'manifest.json'))).digest('hex'), native_route_signature: 'declared-route' })
  await writeFile(configPath, JSON.stringify(config))
  return fixture
}
