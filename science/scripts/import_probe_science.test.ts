import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { makeFixture } from '../../scripts/acoustic-probe-fixture.ts'
import { importProbeScience, DECLARED_CALIBRATION_REASON } from './import_probe_science.ts'

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

test('exact full B response maps to fitter schema with verified lineage and immutable B record', async () => {
  const { root, capture, config, configPath } = await setupFixture()
  const out = join(root, 'science'), r = await importProbeScience(capture, out, configPath)
  assert.equal(r.receipt.eligible_for_fit, true); assert.equal(r.measurement.includedInFit.value, false)
  assert.equal(r.receipt.included_in_fit, false); assert.equal(r.probe_document!.trials[0].source.kind, 'synthetic-fixture')
  const full = JSON.parse(await readFile(join(out, 'b-import', r.measurement.artifacts.response.path), 'utf8'))
  assert.deepEqual(r.probe_document!.trials[0].response_real, config.selected_indices.map(i => full.real[i]))
  assert.deepEqual(r.probe_document!.trials[0].frequency_hz, config.calibration.frequency_hz)
  assert.equal(r.receipt.original_artifacts.length, 3)
  assert.equal((await stat(out)).mode & 0o777, 0o700)
  for (const path of ['probe-science-document.json', 'probe-science-configuration.json', 'probe-science-receipt.json', 'b-import/probe-measurement.json']) assert.equal((await stat(join(out, path))).mode & 0o777, 0o600)
  assert.equal(r.probe_document!.trials[0].timing.source_hashes[0], r.measurement.sourceHashes.manifest)
  await assert.rejects(importProbeScience(capture, out, configPath), /EEXIST/)
})

test('unusable acquisition, missing processing and unsupported phase stay captured but excluded', async () => {
  const { root, capture, native, config, configPath } = await setupFixture()
  delete (config as any).processing; await writeFile(configPath, JSON.stringify(config))
  let r = await importProbeScience(capture, join(root, 'processing'), configPath)
  assert.equal(r.probe_document, null); assert.match(r.receipt.reasons.join(), /uncharacterized/)
  config.processing = { kind: 'declared-software-fixture', evidence_id: 'known-fir', route_id: 'fixture-route', source_hashes: config.calibration.source_hashes }
  await writeFile(configPath, JSON.stringify(config))
  native.segments = native.segments.slice(0, 1); await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  r = await importProbeScience(capture, join(root, 'single'), configPath)
  assert.equal(r.probe_document, null); assert.equal(r.receipt.captured, true)
  native.segments = Array.from({ length: 3 }, (_, i) => ({ driveStartSample: i * 4096, receivedStartSample: i * 4096, sampleCount: 4096 }))
  native.timing.support = 'estimated'; native.timing.uncertaintySeconds = .001
  await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  r = await importProbeScience(capture, join(root, 'phase'), configPath)
  assert.equal(r.probe_document, null); assert.match(r.receipt.reasons.join(), /phase/)
  config.comparison = 'magnitude'; config.capture_binding.manifest_sha256 = createHash('sha256').update(await readFile(join(capture, 'manifest.json'))).digest('hex'); await writeFile(configPath, JSON.stringify(config))
  r = await importProbeScience(capture, join(root, 'magnitude'), configPath)
  assert.equal(r.receipt.eligible_for_fit, true); assert.equal(r.probe_document!.trials[0].timing.phase_verified, false)
})

test('corrupt source/evidence, incompatible grid and physical fixture calibration rejected', async () => {
  const { root, capture, native, config, configPath } = await setupFixture()
  config.capture_binding.route_id = 'wrong-route'; await writeFile(configPath, JSON.stringify(config))
  const mismatch = await importProbeScience(capture, join(root, 'binding'), configPath)
  assert.equal(mismatch.probe_document, null); assert.match(mismatch.receipt.reasons.join(), /binding/)
  config.capture_binding.route_id = 'fixture-route'
  config.calibration.frequency_hz[0] += 1; await writeFile(configPath, JSON.stringify(config))
  await assert.rejects(importProbeScience(capture, join(root, 'grid'), configPath), /grid/)
  config.calibration.frequency_hz[0] -= 1; await writeFile(configPath, JSON.stringify(config))
  native.provenance = 'physical-reference'; await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  await assert.rejects(importProbeScience(capture, join(root, 'physical'), configPath), /measured/)
  native.provenance = 'human-recording'; await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  const human = await importProbeScience(capture, join(root, 'human'), configPath)
  assert.equal(human.probe_document, null); assert.equal(human.receipt.reasons[0], DECLARED_CALIBRATION_REASON)
  native.provenance = 'software-fixture'; await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  const original = await readFile(join(capture, 'received.f32le')); original[0] ^= 1
  await writeFile(join(capture, 'received.f32le'), original)
  await assert.rejects(importProbeScience(capture, join(root, 'corrupt'), configPath), /hash\/byte/)
  await writeFile(join(root, 'calibration-evidence.txt'), 'changed')
  await assert.rejects(importProbeScience(capture, join(root, 'evidence'), configPath), /evidence hash/)
})

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

test('real-voice capture with a metadata-only calibration package stays ineligible with the declared-calibration reason', async () => {
  const { root, capture, configPath } = await declaredMeasuredPackage('human-recording')
  const r = await importProbeScience(capture, join(root, 'human'), configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.probe_document, null); assert.equal(r.receipt.captured, true)
  assert.deepEqual(r.receipt.reasons, [DECLARED_CALIBRATION_REASON])
  assert.equal(JSON.parse(await readFile(join(root, 'human', 'probe-science-document.json'), 'utf8')), null)
})

test('reference-object and synthetic captures keep the existing calibrated import path', async () => {
  const reference = await declaredMeasuredPackage('physical-reference')
  const r = await importProbeScience(reference.capture, join(reference.root, 'reference'), reference.configPath)
  assert.equal(r.receipt.eligible_for_fit, true); assert.equal(r.probe_document!.trials[0].source.kind, 'physical-reference')
  const synthetic = await setupFixture()
  assert.equal((await importProbeScience(synthetic.capture, join(synthetic.root, 'synthetic'), synthetic.configPath)).probe_document!.trials[0].source.kind, 'synthetic-fixture')
})

// An iPhone-shaped manifest (fields only the recorder writes) whose provenance string alone was edited.
async function relabelled(fixture: Awaited<ReturnType<typeof setupFixture>>, provenance: string) {
  const { capture, native, config, configPath } = fixture
  Object.assign(native, { provenance, route: { output: 'Speaker' }, playbackSchedule: { hostTime: '1', hostClock: 'mach_absolute_time', actualAcousticStartVerified: false } })
  native.calibration = { ...native.calibration, deviceResponseCalibrated: false }
  await writeFile(join(capture, 'manifest.json'), JSON.stringify(native))
  config.capture_binding.manifest_sha256 = createHash('sha256').update(await readFile(join(capture, 'manifest.json'))).digest('hex')
  await writeFile(configPath, JSON.stringify(config))
}

test('relabelling an iPhone recording as a fixture or reference object does not make it eligible', async () => {
  const synthetic = await setupFixture()
  await relabelled(synthetic, 'software-fixture')
  let r = await importProbeScience(synthetic.capture, join(synthetic.root, 'as-fixture'), synthetic.configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.receipt.provenance, 'human-recording'); assert.equal(r.receipt.declared_provenance, 'software-fixture')
  assert.equal(r.receipt.reasons[0], DECLARED_CALIBRATION_REASON); assert.match(r.receipt.reasons[1], /carries iPhone recorder fields \(route, playbackSchedule, calibration.deviceResponseCalibrated\)/)
  assert.equal(r.measurement.provenance, 'human-recording')
  const reference = await declaredMeasuredPackage('physical-reference')
  await relabelled(reference, 'physical-reference')
  r = await importProbeScience(reference.capture, join(reference.root, 'as-reference'), reference.configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.probe_document, null); assert.match(r.receipt.reasons.join(), /Manifest says physical-reference but carries iPhone recorder fields/)
  // A fixture label without the fixture generator's marker is not accepted either.
  const unmarked = await setupFixture(); unmarked.native.calibration = {}
  await writeFile(join(unmarked.capture, 'manifest.json'), JSON.stringify(unmarked.native))
  unmarked.config.capture_binding.manifest_sha256 = createHash('sha256').update(await readFile(join(unmarked.capture, 'manifest.json'))).digest('hex'); await writeFile(unmarked.configPath, JSON.stringify(unmarked.config))
  r = await importProbeScience(unmarked.capture, join(unmarked.root, 'unmarked'), unmarked.configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.match(r.receipt.reasons.join(), /lacks the software fixture generator's marker/)
})

// This test runs the genuine native consumer; the Python runtime must have science dependencies.
import { execFileSync } from 'node:child_process'
test('original known-filter PCM traverses joint native fitter and reports nonzero mismatch', async () => {
  const { root, capture, configPath } = await setupFixture()
  const out = join(root, 'end-to-end')
  await importProbeScience(capture, out, configPath)
  const code = `
import json, os, runpy
from singing_physics.engine import Engine
from singing_physics.probe_inverse import fit_probe_pcm
fixture = runpy.run_path(os.environ['PROBE_FIXTURE_TEST'])['probe_fixture']
with Engine() as e:
    pcm, _, candidates = fixture(e)
    probes = json.load(open(os.environ['PROBE_BRIDGE_DOCUMENT']))
    for candidate in candidates:
        candidate['probe_trials']['native-filter'] = candidate['probe_trials'].pop('probe')
    result = fit_probe_pcm(e, pcm, probes, candidates=candidates, max_native_calls=12, node_binary=os.environ['PROBE_NODE'])
    assert result['status'] == 'joint_probe_evidence_used', result['probe_records']
    assert result['actual_operator_calls'] == 12
    assert all(row['probe_discrepancy'] > 100 for row in result['joint']['candidates'])
    assert result['identifiability'] == 'not_established'
    print(json.dumps({'status': result['status'], 'calls': result['actual_operator_calls'], 'probe_discrepancies': [r['probe_discrepancy'] for r in result['joint']['candidates']]}))
`
  const output = execFileSync(process.env.PROBE_PYTHON ?? resolve('science/.venv/bin/python'), ['-c', code], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONPATH: [resolve('.'), resolve('science/src'), process.env.PYTHONPATH].filter(Boolean).join(':'), PROBE_NODE: process.execPath, PROBE_BRIDGE_DOCUMENT: join(out, 'probe-science-document.json'), PROBE_FIXTURE_TEST: process.env.PROBE_FIXTURE_TEST ?? join(process.cwd(), 'science/tests/test_probe_inverse.py') } })
  assert.match(output, /joint_probe_evidence_used/)
  console.log(output.trim())
})
