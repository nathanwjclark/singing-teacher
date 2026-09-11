"""Frozen independent native-PCM comparison, protocol revision 2 (protocol-2.json).

PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/run.py --output /tmp/wave3-run-2

Revision 1 (protocol.json) ran with the harness from b442c1e (identical at ba38700); its
results in results/first-*.json are kept unchanged and are not re-scored here.
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
from singing_physics.pcm_inverse import candidate_discrepancy, extract_pcm, observation_target, score_prediction
from singing_physics.pcm_spectral import COARSE_OBJECTIVE, SPECTRAL_OBJECTIVE, extract_spectral, policy
from singing_physics.phonation import synthesize_phonation

PROTOCOL_PATH = Path(__file__).with_name('protocol-2.json')
OBJECTIVES = (COARSE_OBJECTIVE, SPECTRAL_OBJECTIVE)
GROUPS = ('nominal', 'wrong-fixed-control', 'outside-support')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n')


def candidates(p):
    """The four grid candidates plus the declared near duplicate, in a fixed order."""
    grid = [{'candidate_id': f'anatomy-{i}-source-{j}', 'anatomy': anatomy, 'PS': skew}
            for i, anatomy in enumerate(p['candidate_anatomies']) for j, skew in enumerate(p['candidate_source_skews'])]
    base = next(c for c in grid if c['candidate_id'] == p['near_duplicate']['of'])
    near = {'candidate_id': 'near-duplicate', 'PS': base['PS'],
            'anatomy': {k: round(v+p['near_duplicate']['anatomy_offset'].get(k, 0.), 6) for k, v in base['anatomy'].items()}}
    return grid+[near]


def nearest(p, anatomy, skew):
    """Scoring-only: grid candidate closest to a generating truth, in grid-span units."""
    grid = candidates(p)[:-1]
    span = {k: abs(p['candidate_anatomies'][1][k]-p['candidate_anatomies'][0][k]) for k in anatomy}
    skew_span = abs(p['candidate_source_skews'][1]-p['candidate_source_skews'][0])
    distance = lambda c: sum(((c['anatomy'][k]-anatomy[k])/span[k])**2 for k in anatomy)+((c['PS']-skew)/skew_span)**2
    return min(grid, key=lambda c: (distance(c), c['candidate_id']))['candidate_id']


def transformed(pcm, case, pose, protocol):
    result = np.asarray(pcm, dtype=float).copy()
    stress = protocol['stress']
    if case == 'gain':
        result *= stress['gain_factor']
    elif case == 'tilt':
        alpha = np.exp(-2*np.pi*stress['lowpass_cutoff_hz']/protocol['sample_rate_hz'])
        result = lfilter([1-alpha], [1, -alpha], result)
    elif case == 'noise':
        poses = [*protocol['calibration_poses'], *protocol['heldout_poses']]
        sigma = np.sqrt(np.mean(result**2))*10**(-stress['noise_snr_db']/20)
        result += np.random.default_rng(stress['noise_seed']+poses.index(pose)).normal(0, sigma, len(result))
    elif case == 'all-missing':
        result[:] = 0
    elif case not in ('clean', 'wrong-fixed-control', 'outside-support', 'degeneracy', 'near-degeneracy'):
        raise ValueError('Unknown frozen case')
    return result.astype('<f4')


def pose_gains(native, protocol):
    """Per-vowel digital gain from the frozen prediction bank: loudest candidate peak at the target."""
    target = 10**(protocol['gain_rule']['peak_target_dbfs']/20)
    return {pose: float(target/max(float(np.max(np.abs(frames[pose]))) for frames in native.values()))
            for pose in [*protocol['calibration_poses'], *protocol['heldout_poses']]}


def level_jumps(native, protocol):
    """RMS level spread between the two anatomies at each source skew, per vowel, from the bank only."""
    rows = {}
    for pose in [*protocol['calibration_poses'], *protocol['heldout_poses']]:
        level = {c: 20*np.log10(float(np.sqrt(np.mean(np.square(frames[pose]))))) for c, frames in native.items()}
        pairs = {f'source-{j}': abs(level[f'anatomy-0-source-{j}']-level[f'anatomy-1-source-{j}'])
                 for j in range(len(protocol['candidate_source_skews']))}
        rows[pose] = {'rms_dbfs_native': level, 'neighbour_anatomy_difference_db': pairs,
                      'flagged': bool(max(pairs.values()) > protocol['level_jump_check']['threshold_db'])}
    return rows


def retained(rows, margin):
    """Candidates within the declared standardized-RMS margin of the best scorable one."""
    finite = {r['candidate_id']: np.sqrt(r['mean_square']) for r in rows if r['mean_square'] is not None}
    if not finite:
        return []
    lowest = min(finite.values())
    return sorted(c for c, value in finite.items() if value-lowest <= margin)


def run(output):
    p = json.loads(PROTOCOL_PATH.read_text())
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    write(output/'protocol.json', p)
    write(output/'objective-policy.json', policy())
    poses = [*p['calibration_poses'], *p['heldout_poses']]
    members = candidates(p)
    write(output/'candidate-grid.json', members)
    calls, failures, frames, evidence = 0, [], {}, {}
    counts = {'observation_canonical': 0, 'observation_spectral': 0, 'prediction_scores': 0}
    native = None

    def synthesize(engine, anatomy, pose, controls, skew):
        nonlocal calls, native
        if calls >= p['hard_synthesis_limit']:
            raise RuntimeError('Independent hard native synthesis budget exhausted')
        native = native or dict(engine.provenance)
        if native != engine.provenance or engine.sample_rate != p['sample_rate_hz']:
            raise RuntimeError('Native provenance or sampling rate changed during evaluation')
        engine.set_anatomy(anatomy)
        calls += 1
        pcm, receipt = synthesize_phonation(engine, pose=pose, **controls, PS=skew, duration_s=p['duration_s'])
        start, size = p['frame_start_sample'], p['frame_size']
        return pcm[start:start+size], {'pose': pose, 'anatomy': engine.anatomy(), 'controls': receipt,
                                       'raw_synthesis_sha256': hashlib.sha256(np.asarray(pcm, dtype='<f4').tobytes()).hexdigest()}

    def save(identity, pcm, metadata):
        values = np.asarray(pcm, dtype='<f4')
        (output/(identity+'.pcm.f32')).write_bytes(values.tobytes())
        evidence[identity] = {**metadata, 'frame_sha256': hashlib.sha256(values.tobytes()).hexdigest(),
                              'source_kind': 'development-fixture', 'path': identity+'.pcm.f32'}
        write(output/(identity+'.json'), evidence[identity])
        frames[identity] = values

    # 1. Forecast every member for every vowel before any truth exists; gains and
    #    level checks come from these predictions only.
    raw, receipts = {}, {}
    with Engine() as engine:
        for member in members:
            raw[member['candidate_id']], receipts[member['candidate_id']] = {}, {}
            for pose in poses:
                raw[member['candidate_id']][pose], receipts[member['candidate_id']][pose] = synthesize(
                    engine, member['anatomy'], pose, p['nominal_controls'], member['PS'])
    gains = pose_gains(raw, p)
    levels = level_jumps({c: v for c, v in raw.items() if c != 'near-duplicate'}, p)
    for member in members:
        for pose in poses:
            save(member['candidate_id']+'-'+pose, raw[member['candidate_id']][pose]*gains[pose],
                 {**receipts[member['candidate_id']][pose], 'pose_gain': gains[pose]})
    bank = {'predictions': {m['candidate_id']: {pose: m['candidate_id']+'-'+pose for pose in poses} for m in members},
            'pose_gains': gains, 'level_jumps': levels, 'frames': dict(evidence), 'native_provenance': native,
            'actual_synthesis_calls': calls, 'committed_at': datetime.now(timezone.utc).isoformat()}
    write(output/'frozen-prediction-bank.json', bank)

    def truths(group_poses):
        with Engine() as engine:
            for group in GROUPS:
                for pose in group_poses:
                    anatomy = p['outside_anatomy'] if group == 'outside-support' else p['generating_anatomy']
                    controls = p['mismatched_controls'] if group == 'wrong-fixed-control' else p['nominal_controls']
                    try:
                        frame, receipt = synthesize(engine, anatomy, pose, controls, p['generating_source_skew'])
                        save('truth-'+group+'-'+pose, frame*gains[pose], {**receipt, 'pose_gain': gains[pose], 'group': group})
                    except (ValueError, RuntimeError) as exc:
                        failures.append({'stage': 'truth synthesis', 'group': group, 'pose': pose, 'reason': str(exc)})

    observations = {}
    def observation(case, pose):
        """Canonical and spectral observation of one stressed truth frame, or its failure reason."""
        key = (case, pose)
        if key in observations:
            return observations[key]
        group = case if case in ('wrong-fixed-control', 'outside-support') else 'nominal'
        truth, identity = 'truth-'+group+'-'+pose, 'observed-'+case+'-'+pose
        if truth not in frames:
            observations[key] = {'reason': 'Truth frame was not synthesized'}
            return observations[key]
        save(identity, transformed(frames[truth], case, pose, p), {'parent_frame_sha256': evidence[truth]['frame_sha256'], 'case': case, 'pose': pose})
        values, start = frames[identity], p['frame_start_sample']
        trial = {'id': identity, 'sample_rate_hz': p['sample_rate_hz'], 'frame_start_sample': start}
        try:
            counts['observation_canonical'] += 1
            canonical = extract_pcm(values, p['sample_rate_hz'], measurement_id=identity, observation_id=identity+'-observation',
                artifact_id=identity+'-artifact', start_ms=start/p['sample_rate_hz']*1000, source_kind='development-fixture')
            target = observation_target(canonical['measurement'])
        except ValueError as exc:
            observations[key] = {'reason': str(exc)}
            return observations[key]
        try:
            counts['observation_spectral'] += 1
            trial['spectral_observation'] = extract_spectral(values, p['sample_rate_hz'], source_artifact_id=identity+'-artifact',
                source_artifact_hashes=[evidence[identity]['frame_sha256']], frame_start_sample=start)
        except ValueError as exc:
            trial['spectral_reason'] = str(exc)
        observations[key] = {'trial': trial, 'target': target, 'dbfs': target['dbfs']['value']}
        return observations[key]

    def score(prediction, case, pose, objective):
        """One member's production fit_pcm score for one vowel, or its reason."""
        seen = observation(case, pose)
        if 'trial' not in seen:
            return {'mean_square': None, 'reason': seen['reason']}
        if objective == SPECTRAL_OBJECTIVE and 'spectral_observation' not in seen['trial']:
            return {'mean_square': None, 'reason': seen['trial']['spectral_reason']}
        counts['prediction_scores'] += 1
        try:
            item = score_prediction(frames[prediction], seen['trial'], seen['target'], objective=objective,
                                    measurement_id=prediction+'@'+case+'-'+pose)
        except ValueError as exc:  # Invalid predicted audio stays an explicit failure for this member.
            return {'mean_square': None, 'reason': str(exc)}
        predicted_dbfs = None if item['clipped'] else next(m['value'] for m in item['canonical']['measurement']['measurements'] if m['name'] == 'dbfs')
        return {'item': item, 'level_difference_db': None if predicted_dbfs is None or seen['dbfs'] is None else seen['dbfs']-predicted_dbfs}

    def combine(scored, objective):
        if any('item' not in row for row in scored):
            return None, [row['reason'] for row in scored if 'item' not in row]
        value, missing = candidate_discrepancy([row['item'] for row in scored], objective)
        return value, [m['reason'] for m in missing]

    def case_members(case):
        if case == 'degeneracy':
            return {'identical-a': 'anatomy-0-source-0', 'identical-b': 'anatomy-0-source-0'}
        if case == 'near-degeneracy':
            return {'anatomy-0-source-0': 'anatomy-0-source-0', 'near-duplicate': 'near-duplicate'}
        return {m['candidate_id']: m['candidate_id'] for m in members if m['candidate_id'] != 'near-duplicate'}

    # 2. Calibration truth and frozen rankings before any held-out truth exists.
    truths(p['calibration_poses'])
    rankings = []
    for case in p['cases']:
        for objective in OBJECTIVES:
            rows = []
            for row_id, member in case_members(case).items():
                scored = [score(member+'-'+pose, case, pose, objective) for pose in p['calibration_poses']]
                value, reasons = combine(scored, objective)
                rows.append({'candidate_id': row_id, 'member': member, 'mean_square': value, 'missing_reasons': reasons,
                             'components': [row['item']['objective_components'] for row in scored if 'item' in row]})
            rankings.append({'case': case, 'objective': objective, 'candidates': rows,
                             'retained_ids': retained(rows, p['tie_margin_standardized_rms'])})
    rankings_receipt = {'prediction_bank_sha256': digest(bank), 'rankings': rankings,
                        'committed_at': datetime.now(timezone.utc).isoformat()}
    write(output/'frozen-calibration-rankings.json', rankings_receipt)

    # 3. Held-out truth; scores cannot affect the rankings written above.
    truths(p['heldout_poses'])
    nearest_ids = {'nominal': nearest(p, p['generating_anatomy'], p['generating_source_skew']),
                   'outside-support': nearest(p, p['outside_anatomy'], p['generating_source_skew'])}
    cases = []
    for ranking in rankings:
        case, objective = ranking['case'], ranking['objective']
        heldout = {}
        for pose in p['heldout_poses']:
            rows = []
            for row in ranking['candidates']:
                scored = score(row['member']+'-'+pose, case, pose, objective)
                value, reasons = combine([scored], objective)
                rows.append({'candidate_id': row['candidate_id'], 'mean_square': value, 'missing_reasons': reasons,
                             'level_difference_db': scored.get('level_difference_db'),
                             'components': scored['item']['objective_components'] if 'item' in scored else None})
            best = retained(rows, p['tie_margin_standardized_rms'])
            rms = {r['candidate_id']: np.sqrt(r['mean_square']) for r in rows if r['mean_square'] is not None}
            selected = [c for c in ranking['retained_ids'] if c in rms]
            evaluable = bool(ranking['retained_ids']) and bool(best)
            heldout[pose] = {'candidates': rows, 'retained_ids_scoring_only': best, 'evaluable': evaluable,
                'hit': bool(set(ranking['retained_ids']) & set(best)) if evaluable else None,
                'regret_standardized_rms': float(min(rms[c] for c in selected)-min(rms.values())) if evaluable and selected else None,
                'level_jump_flagged': levels[pose]['flagged']}
        group = 'outside-support' if case == 'outside-support' else 'nominal'
        cases.append({**ranking, 'heldout': heldout,
            'nearest_grid_candidate_scoring_only': nearest_ids[group],
            'nearest_grid_hit': nearest_ids[group] in ranking['retained_ids'] if ranking['retained_ids'] and case in p['evaluable_cases'] else None})
    summary = {}
    for objective in OBJECTIVES:
        pairs = [(c['case'], pose, c['heldout'][pose]) for c in cases if c['objective'] == objective and c['case'] in p['evaluable_cases'] for pose in p['heldout_poses']]
        regrets = [h['regret_standardized_rms'] for _, _, h in pairs if h['regret_standardized_rms'] is not None]
        summary[objective] = {'evaluable_pairs': sum(h['evaluable'] for _, _, h in pairs), 'unscorable_pairs': sum(not h['evaluable'] for _, _, h in pairs),
            'hits': sum(bool(h['hit']) for _, _, h in pairs), 'mean_regret_standardized_rms': float(np.mean(regrets)) if regrets else None,
            'nearest_grid_hits': sum(bool(c['nearest_grid_hit']) for c in cases if c['objective'] == objective),
            'retained_set_sizes': {c['case']: len(c['retained_ids']) for c in cases if c['objective'] == objective}}
    spectral, coarse = summary[SPECTRAL_OBJECTIVE], summary[COARSE_OBJECTIVE]
    outcome = ('positive' if spectral['hits']-coarse['hits'] >= 3 and spectral['unscorable_pairs'] <= coarse['unscorable_pairs'] else
               'negative' if coarse['hits']-spectral['hits'] >= 3 else 'inconclusive')
    report = {'protocol_sha256': digest(p), 'frozen_prediction_bank_sha256': digest(bank),
        'frozen_calibration_rankings_sha256': digest(rankings_receipt), 'native_provenance': native,
        'actual_synthesis_calls': calls, 'extraction_counts': counts, 'objective_policy': policy(),
        'pose_gains': gains, 'level_jumps': levels, 'evidence_source': 'synthetic', 'failures': failures,
        'cases': cases, 'summary': summary, 'scientific_outcome': outcome,
        'anatomical_identifiability': 'not_established', 'uncertainty_calibration': 'not_measured',
        'completed_at': datetime.now(timezone.utc).isoformat(),
        'limitations': ['Both objectives reuse exactly the same synthesized forecasts and observation frames.',
            'Held-out e/o/u are new vowels from the same native generator, not a held-out person.',
            'Compare hits, regret, coverage and ambiguity within each objective; the two objectives use different numerical scales.',
            'Four grid candidates cannot establish recovery, uniqueness or coverage of real anatomy.',
            'Per-vowel gains come from the prediction bank; they are fixture acquisition settings, not microphone calibration.']}
    write(output/'report.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = run(args.output)
    print(json.dumps({'report': str(args.output/'report.json'), 'native_calls': report['actual_synthesis_calls'],
                      'failures': len(report['failures']), 'scientific_outcome': report['scientific_outcome'], 'summary': report['summary']}))
