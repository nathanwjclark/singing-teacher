import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { makeFixture } from '../../scripts/acoustic-probe-fixture.ts'
import { importProbeScience, DECLARED_CALIBRATION_REASON } from './import_probe_science.ts'

// Exported helpers keep their files (the Python tests read them after `node -e`); each test removes its own.
function owned<T extends { root: string }>(t: TestContext, fixture: T) { t.after(() => rm(fixture.root, { recursive: true, force: true })); return fixture }

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

test('exact full B response maps to fitter schema with verified lineage and immutable B record', async t => {
  const { root, capture, config, configPath } = owned(t, await setupFixture())
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

test('unusable acquisition, missing processing and unsupported phase stay captured but excluded', async t => {
  const { root, capture, native, config, configPath } = owned(t, await setupFixture())
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

test('corrupt source/evidence, incompatible grid and physical fixture calibration rejected', async t => {
  const { root, capture, native, config, configPath } = owned(t, await setupFixture())
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

test('real-voice capture with a metadata-only calibration package stays ineligible with the declared-calibration reason', async t => {
  const { root, capture, configPath } = owned(t, await declaredMeasuredPackage('human-recording'))
  const r = await importProbeScience(capture, join(root, 'human'), configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.probe_document, null); assert.equal(r.receipt.captured, true)
  assert.deepEqual(r.receipt.reasons, [DECLARED_CALIBRATION_REASON])
  assert.equal(JSON.parse(await readFile(join(root, 'human', 'probe-science-document.json'), 'utf8')), null)
})

test('reference-object and synthetic captures keep the existing calibrated import path', async t => {
  const reference = owned(t, await declaredMeasuredPackage('physical-reference'))
  const r = await importProbeScience(reference.capture, join(reference.root, 'reference'), reference.configPath)
  assert.equal(r.receipt.eligible_for_fit, true); assert.equal(r.probe_document!.trials[0].source.kind, 'physical-reference')
  const synthetic = owned(t, await setupFixture())
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

test('relabelling an iPhone recording as a fixture or reference object does not make it eligible', async t => {
  const synthetic = owned(t, await setupFixture())
  await relabelled(synthetic, 'software-fixture')
  let r = await importProbeScience(synthetic.capture, join(synthetic.root, 'as-fixture'), synthetic.configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.receipt.provenance, 'human-recording'); assert.equal(r.receipt.declared_provenance, 'software-fixture')
  assert.equal(r.receipt.reasons[0], DECLARED_CALIBRATION_REASON); assert.match(r.receipt.reasons[1], /carries iPhone recorder fields \(route, playbackSchedule, calibration.deviceResponseCalibrated\)/)
  assert.equal(r.measurement.provenance, 'human-recording')
  const reference = owned(t, await declaredMeasuredPackage('physical-reference'))
  await relabelled(reference, 'physical-reference')
  r = await importProbeScience(reference.capture, join(reference.root, 'as-reference'), reference.configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.probe_document, null); assert.match(r.receipt.reasons.join(), /Manifest says physical-reference but carries iPhone recorder fields/)
  // A fixture label without the fixture generator's marker is not accepted either.
  const unmarked = owned(t, await setupFixture()); unmarked.native.calibration = {}
  await writeFile(join(unmarked.capture, 'manifest.json'), JSON.stringify(unmarked.native))
  unmarked.config.capture_binding.manifest_sha256 = createHash('sha256').update(await readFile(join(unmarked.capture, 'manifest.json'))).digest('hex'); await writeFile(unmarked.configPath, JSON.stringify(unmarked.config))
  r = await importProbeScience(unmarked.capture, join(unmarked.root, 'unmarked'), unmarked.configPath)
  assert.equal(r.receipt.eligible_for_fit, false); assert.match(r.receipt.reasons.join(), /lacks the software fixture generator's marker/)
})

// The app's USB pull output: `original.zip` and its `usb-receipt.json`. The importer hashes the archive; it never unzips it.
async function pulled(root: string, acquisition: unknown, archive = Buffer.from('archive bytes for the pull-receipt tests')) {
  const receipt = { schemaVersion: 'native-pull-receipt-2', name: 'probe-12345678-1234-1234-1234-123456789abc.zip', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), ...(acquisition === undefined ? {} : { acquisition }) }
  await writeFile(join(root, 'original.zip'), archive); await writeFile(join(root, 'usb-receipt.json'), JSON.stringify(receipt))
  return join(root, 'usb-receipt.json')
}
const devicectl = { transport: 'devicectl', connection: { transportType: 'wired', tunnelState: 'connected' }, container: { domainType: 'appDataContainer', bundleId: 'com.singingteacher.depth', path: 'Documents/probe-12345678-1234-1234-1234-123456789abc.zip' },
  device: { coreDeviceId: '0B1C2D3E-4F50-4A6B-8C7D-9E0F1A2B3C4D', udid: '00008130-000A1B2C3D4E5F60', productType: 'iPhone16,1', osVersion: '26.0' } }

test('a pull receipt decides whether a fixture label counts, and must match its archive', async t => {
  const { root, capture, configPath } = owned(t, await setupFixture())
  // A repository-fixture receipt on a marked fixture keeps the synthetic path and is recorded.
  const fixtureReceipt = await pulled(root, { transport: 'repository-fixture', generator: 'science/scripts/import_probe_science.test.ts' })
  let r = await importProbeScience(capture, join(root, 'fixture'), configPath, fixtureReceipt)
  assert.equal(r.receipt.eligible_for_fit, true); assert.equal(r.receipt.attestation, 'repository-fixture-receipt'); assert.deepEqual(r.receipt.acquisition, { transport: 'repository-fixture', generator: 'science/scripts/import_probe_science.test.ts' })
  // The attack: the same stripped, marked manifest arriving through a devicectl pull is a human recording.
  r = await importProbeScience(capture, join(root, 'pulled'), configPath, await pulled(root, devicectl))
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.probe_document, null); assert.equal(r.receipt.provenance, 'human-recording'); assert.equal(r.receipt.declared_provenance, 'software-fixture')
  assert.equal(r.receipt.attestation, 'devicectl-receipt'); assert.deepEqual(r.receipt.acquisition, devicectl)
  assert.deepEqual(r.receipt.reasons.slice(0, 2), [DECLARED_CALIBRATION_REASON, 'Manifest says software-fixture but its pull receipt shows it was copied from an iPhone by devicectl; it is treated as a human recording.'])
  // A receipt from before transport recording cannot vouch for a fixture either.
  r = await importProbeScience(capture, join(root, 'legacy'), configPath, await pulled(root, undefined))
  assert.equal(r.receipt.eligible_for_fit, false); assert.equal(r.receipt.attestation, 'legacy-receipt'); assert.equal(r.receipt.acquisition, null); assert.match(r.receipt.reasons.join(), /does not name a known transport/)
  // Without a receipt (direct command-line import) the manifest-only rule applies and says so.
  r = await importProbeScience(capture, join(root, 'direct'), configPath)
  assert.equal(r.receipt.eligible_for_fit, true); assert.equal(r.receipt.attestation, 'none'); assert.equal(r.receipt.acquisition, null)
  // An archive that differs from its receipt is refused before any output is written.
  const receipt = await pulled(root, devicectl), archive = await readFile(join(root, 'original.zip')); archive[0] ^= 1; await writeFile(join(root, 'original.zip'), archive)
  await assert.rejects(importProbeScience(capture, join(root, 'changed'), configPath, receipt), /does not match its pull receipt/)
  await writeFile(join(root, 'usb-receipt.json'), JSON.stringify({ name: 'probe.zip', acquisition: devicectl }))
  await assert.rejects(importProbeScience(capture, join(root, 'no-hash'), configPath, receipt), /lacks the archive hash/)
  await assert.rejects(stat(join(root, 'changed')), { code: 'ENOENT' })
})

test('a repository-fixture receipt that contradicts the manifest refuses the import', async t => {
  const human = owned(t, await declaredMeasuredPackage('human-recording')), repository = { transport: 'repository-fixture', generator: 'science/scripts/import_probe_science.test.ts' }
  await assert.rejects(importProbeScience(human.capture, join(human.root, 'human'), human.configPath, await pulled(human.root, repository)), /Repository-fixture pull receipt contradicts the capture manifest/)
  const reference = owned(t, await declaredMeasuredPackage('physical-reference'))
  await assert.rejects(importProbeScience(reference.capture, join(reference.root, 'reference'), reference.configPath, await pulled(reference.root, repository)), /contradicts the capture manifest/)
  // A devicectl receipt keeps a reference-object label as declared.
  assert.equal((await importProbeScience(reference.capture, join(reference.root, 'pulled'), reference.configPath, await pulled(reference.root, devicectl))).receipt.provenance, 'physical-reference')
  const phoneShaped = owned(t, await setupFixture()); await relabelled(phoneShaped, 'software-fixture')
  await assert.rejects(importProbeScience(phoneShaped.capture, join(phoneShaped.root, 'phone'), phoneShaped.configPath, await pulled(phoneShaped.root, repository)), /contradicts the capture manifest/)
  await assert.rejects(stat(join(human.root, 'human')), { code: 'ENOENT' })
})

// This test runs the genuine native consumer; the Python runtime must have science dependencies.
import { execFileSync } from 'node:child_process'
test('original known-filter PCM traverses joint native fitter and reports nonzero mismatch', async t => {
  const { root, capture, configPath } = owned(t, await setupFixture())
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
