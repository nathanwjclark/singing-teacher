"""Frozen independent native-PCM comparison; run after the wave-three spectral module lands.

PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/run.py --output /tmp/wave3-run
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

from singing_physics.engine import Engine
from singing_physics.pcm_inverse import FEATURES, _features, extract_pcm
from singing_physics.phonation import synthesize_phonation

PROTOCOL_PATH = Path(__file__).with_name('protocol.json')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n')


def transformed(pcm, case, pose, protocol):
    result = np.asarray(pcm, dtype=float).copy()
    stress = protocol['stress']
    if case == 'gain':
        result *= stress['gain_factor']
    elif case == 'tilt':
        alpha = np.exp(-2*np.pi*stress['lowpass_cutoff_hz']/protocol['sample_rate_hz'])
        result = lfilter([1-alpha], [1, -alpha], result)
    elif case == 'noise':
        seed = stress['noise_seed']+{'a': 0, 'i': 1, 'e': 2}[pose]
        sigma = np.sqrt(np.mean(result**2))*10**(-stress['noise_snr_db']/20)
        result += np.random.default_rng(seed).normal(0, sigma, len(result))
    elif case == 'all-missing':
        result[:] = 0
    elif case not in ('clean', 'wrong-fixed-control', 'outside-support', 'degeneracy'):
        raise ValueError('Unknown frozen case')
    return result.astype('<f4')


def retained_minima(rows):
    finite = [r for r in rows if r['mean_square'] is not None]
    if not finite:
        return []
    lowest = min(r['mean_square'] for r in finite)
    tolerance = max(1e-12, abs(lowest)*1e-12)
    return [r['candidate_id'] for r in finite if abs(r['mean_square']-lowest) <= tolerance]


def run(output):
    # Importing the production objective makes its policy/hash the actual tested implementation.
    from singing_physics.pcm_spectral import discrepancy, extract_spectral, policy

    p = json.loads(PROTOCOL_PATH.read_text())
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    write(output/'protocol.json', p)
    write(output/'objective-policy.json', policy())
    calls = 0
    extracts = {'canonical': 0, 'spectral': 0}
    frames, evidence, failures = {}, {}, []
    native = None
    candidates = [
        {'candidate_id': f'anatomy-{i}-source-{j}', 'anatomy': anatomy, 'PS': ps}
        for i, anatomy in enumerate(p['candidate_anatomies'])
        for j, ps in enumerate(p['candidate_source_skews'])
    ]
    write(output/'candidate-grid.json', candidates)

    def save_frame(identity, pcm, metadata):
        values = np.asarray(pcm, dtype='<f4')
        payload = values.tobytes()
        path = output/(identity+'.pcm.f32')
        path.write_bytes(payload)
        record = {**metadata, 'frame_sha256': hashlib.sha256(payload).hexdigest(),
                  'source_kind': 'development-fixture', 'path': path.name}
        write(output/(identity+'.json'), record)
        frames[identity] = values
        evidence[identity] = record
        return identity

    def generate(engine, identity, pose, anatomy, controls, ps):
        nonlocal calls, native
        if calls >= p['hard_synthesis_limit']:
            raise RuntimeError('Independent hard native synthesis budget exhausted')
        if native is None:
            native = dict(engine.provenance)
        if native != engine.provenance or engine.sample_rate != p['sample_rate_hz']:
            raise RuntimeError('Native provenance or sampling rate changed during evaluation')
        engine.set_anatomy(anatomy)
        calls += 1
        try:
            pcm, control_receipt = synthesize_phonation(engine, pose=pose, **controls, PS=ps,
                                                        duration_s=p['duration_s'])
            start, size = p['frame_start_sample'], p['frame_size']
            frame = pcm[start:start+size]*p['pose_gain'][pose]
            if len(frame) != size:
                raise ValueError('Native frame length differs from the frozen protocol')
            return save_frame(identity, frame, {'pose': pose, 'anatomy': engine.anatomy(),
                'controls': control_receipt, 'pose_gain': p['pose_gain'][pose],
                'raw_synthesis_sha256': hashlib.sha256(np.asarray(pcm, dtype='<f4').tobytes()).hexdigest()})
        except (ValueError, RuntimeError) as exc:
            failures.append({'stage': 'synthesis', 'identity': identity, 'reason': str(exc)})
            return None

    # Forecast every candidate, including the target vowel, before generating any target outcome.
    bank = {}
    with Engine() as engine:
        for candidate in candidates:
            bank[candidate['candidate_id']] = {pose: generate(engine,
                candidate['candidate_id']+'-'+pose, pose, candidate['anatomy'],
                p['nominal_controls'], candidate['PS'])
                for pose in [*p['calibration_poses'], p['heldout_pose']]}
        for group in ('nominal', 'wrong-fixed-control', 'outside-support'):
            for pose in p['calibration_poses']:
                generate(engine, 'truth-'+group+'-'+pose, pose,
                    p['outside_anatomy'] if group == 'outside-support' else p['generating_anatomy'],
                    p['mismatched_controls'] if group == 'wrong-fixed-control' else p['nominal_controls'],
                    p['generating_source_skew'])
    bank_receipt = {'candidate_predictions': bank, 'frames': evidence.copy(), 'native_provenance': native,
                    'actual_synthesis_calls': calls, 'committed_at': datetime.now(timezone.utc).isoformat()}
    write(output/'frozen-prediction-bank.json', bank_receipt)

    cache = {}
    def measurements(identity, need_spectral):
        if identity is None or identity not in frames:
            raise ValueError('Native evidence is missing')
        if identity in cache and (not need_spectral or cache[identity][1] is not None):
            return cache[identity]
        values = frames[identity]
        # Detect accidental/intentional corpus edits before extracting or scoring.
        if hashlib.sha256((output/evidence[identity]['path']).read_bytes()).hexdigest() != evidence[identity]['frame_sha256']:
            raise ValueError('Frozen PCM bytes changed')
        if identity in cache:
            coarse = cache[identity][0]
        else:
            extracts['canonical'] += 1
            canonical = extract_pcm(values, p['sample_rate_hz'], measurement_id=identity,
                observation_id=identity+'-observation', artifact_id=identity+'-artifact',
                start_ms=p['frame_start_sample']/p['sample_rate_hz']*1000, source_kind='development-fixture')
            coarse = _features(canonical['measurement'])
            if sum(row['value'] is not None for row in coarse.values()) < 3:
                raise ValueError('Insufficient canonical descriptors')
            cache[identity] = coarse, None
        if need_spectral:
            extracts['spectral'] += 1
            spectral = extract_spectral(values, p['sample_rate_hz'], source_artifact_id=identity+'-artifact',
                                        source_artifact_hashes=[evidence[identity]['frame_sha256']],
                                        frame_start_sample=p['frame_start_sample'])
            cache[identity] = coarse, spectral
        return cache[identity]

    def observed(case, pose):
        group = case if case in ('wrong-fixed-control', 'outside-support') else 'nominal'
        identity = 'observed-'+case+'-'+pose
        truth = 'truth-'+group+'-'+pose
        if truth not in frames:
            return None
        if identity not in frames:
            save_frame(identity, transformed(frames[truth], case, pose, p),
                       {'parent_frame_sha256': evidence[truth]['frame_sha256'], 'case': case, 'pose': pose})
        return identity

    def score(prediction_id, observation_id, objective):
        try:
            predicted, ps = measurements(prediction_id, objective != 'canonical-coarse-v1')
            target, os = measurements(observation_id, objective != 'canonical-coarse-v1')
            if objective == 'canonical-coarse-v1':
                residuals = []
                for name, (_, scale) in FEATURES.items():
                    if target[name]['value'] is not None:
                        if predicted[name]['value'] is None:
                            raise ValueError('Required predicted descriptor is missing: '+name)
                        scale = max(scale, target[name]['uncertainty'] or 0.)
                        residuals.append((predicted[name]['value']-target[name]['value'])/scale)
                return {'mean_square': float(np.mean(np.square(residuals))), 'reason': None}
            result = discrepancy(ps, os,
                predicted_features={k: v['value'] for k, v in predicted.items()},
                observed_features={k: v['value'] for k, v in target.items()})
            return {**result, 'reason': None}
        except (ValueError, RuntimeError) as exc:
            return {'mean_square': None, 'reason': str(exc)}

    frozen_rankings = []
    for case in p['cases']:
        members = bank if case != 'degeneracy' else {
            'identical-a': bank[candidates[0]['candidate_id']],
            'identical-b': bank[candidates[0]['candidate_id']]}
        for objective in ('canonical-coarse-v1', 'multires-log-spectrum-v1'):
            rows = []
            for candidate_id, predictions in members.items():
                per_pose = {pose: score(predictions[pose], observed(case, pose), objective)
                            for pose in p['calibration_poses']}
                values = [row['mean_square'] for row in per_pose.values()]
                rows.append({'candidate_id': candidate_id, 'per_pose': per_pose,
                    'mean_square': float(np.mean(values)) if all(v is not None for v in values) else None})
            frozen_rankings.append({'case': case, 'objective': objective, 'candidates': rows,
                                    'tied_best_ids': retained_minima(rows)})
    rankings_receipt = {'prediction_bank_sha256': digest(bank_receipt), 'rankings': frozen_rankings,
                        'committed_at': datetime.now(timezone.utc).isoformat()}
    write(output/'frozen-calibration-rankings.json', rankings_receipt)
    # The held-out outcomes cannot affect any of the above ranks.
    with Engine() as engine:
        for group in ('nominal', 'wrong-fixed-control', 'outside-support'):
            generate(engine, 'truth-'+group+'-'+p['heldout_pose'], p['heldout_pose'],
                p['outside_anatomy'] if group == 'outside-support' else p['generating_anatomy'],
                p['mismatched_controls'] if group == 'wrong-fixed-control' else p['nominal_controls'],
                p['generating_source_skew'])
    results = []
    for row in frozen_rankings:
        pose = p['heldout_pose']
        heldout = []
        for candidate in row['candidates']:
            identity = candidate['candidate_id']
            prediction = bank[candidates[0]['candidate_id']] if row['case'] == 'degeneracy' else bank[identity]
            heldout.append({'candidate_id': identity, **score(prediction[pose], observed(row['case'], pose), row['objective'])})
        results.append({**row, 'heldout_all_candidates': heldout,
            'heldout_selected': [r for r in heldout if r['candidate_id'] in row['tied_best_ids']],
            'heldout_best_ids_scoring_only': retained_minima(heldout)})
    report = {'protocol_sha256': digest(p), 'frozen_prediction_bank_sha256': digest(bank_receipt),
        'frozen_calibration_rankings_sha256': digest(rankings_receipt), 'native_provenance': native,
        'actual_synthesis_calls': calls, 'actual_extraction_calls': extracts, 'objective_policy': policy(),
        'evidence_source': 'development-fixture', 'failures': failures, 'cases': results,
        'anatomical_identifiability': 'not_established', 'uncertainty_calibration': 'not_measured',
        'completed_at': datetime.now(timezone.utc).isoformat(),
        'limitations': ['Both objectives reuse exactly the same synthesized forecasts.',
            'Held-out e is a new vowel in the same native speaker, not a held-out human.',
            'Compare within-objective rankings and failures, not unlike numerical objective scales.',
            'Four candidates cannot establish recovery, uniqueness or coverage of real anatomy.',
            'Coarse and spectral objectives each use the production canonical quality gate.']}
    write(output/'report.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = run(args.output)
    print(json.dumps({'report': str(args.output/'report.json'), 'native_calls': report['actual_synthesis_calls'],
                      'failed_syntheses': len(report['failures'])}))
