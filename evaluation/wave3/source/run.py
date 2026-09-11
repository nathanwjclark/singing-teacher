"""Frozen equal-budget source-family comparison (protocol.json) through the production phonation pipeline.

PYTHONPATH=science/src science/.venv/bin/python evaluation/wave3/source/run.py --output /tmp/wave3-source-run

Full fit, bank and score artifacts go to --output (must be new). Compact per-generator
results and the report go to results/ next to this file.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import time

from singing_physics.engine import Engine
from singing_physics.phonation import (_frame, _metadata, adapter_dependencies, extractor_signature, fit_phonation,
    forecast_phonation_bank, measure_phonation, score_phonation_bank, source_capability, synthesize_phonation, SOURCE_VERSION)

HERE = Path(__file__).resolve().parent
PROTOCOL_PATH = HERE/'protocol.json'
ROOT = HERE.parents[2]
FAMILIES = ('geometric', 'two_mass')
SCORES = {'primary': ('score', 'score'), 'pitch_excluded': ('score_excluding_pitch', 'score_excluding_pitch')}
RANGES = {'PS': .4, 'XB': .01, 'EAA': .005, 'DF': .3}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n')


def worktree():
    """The commit this run executes and whether the checkout differs from it."""
    try:
        run = lambda *args: subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True, check=True, timeout=30).stdout
        changed = [line[3:] for line in run('status', '--porcelain', '--untracked-files=all').splitlines()]
        return {'commit': run('rev-parse', 'HEAD').strip(), 'dirty': bool(changed), 'changed_paths': changed}
    except (OSError, subprocess.SubprocessError) as exc:
        return {'commit': None, 'dirty': None, 'reason': 'git state unavailable: '+str(exc)}


def candidates(p, observed_f0):
    """Twelve candidates in a fixed order; F0 controls are the generator's measured calibration pitch."""
    return [{'candidate_id': f't{i}-{family}-{j}', 'anatomy': dict(tract),
             'trials': {t['id']: {'JA': t['JA'], 'F0': observed_f0[t['id']], 'PR': t['PR'], 'gain': t['gain'], **shape} for t in p['calibration_trials']}}
            for family in FAMILIES for i, tract in enumerate(p['tract_options']) for j, shape in enumerate(p['families'][family])]


def family_of(candidate_id):
    return candidate_id.split('-', 1)[1].rsplit('-', 1)[0]


def nearest(p, generator):
    """Scoring-only: grid candidate nearest to a generator, per the protocol rule."""
    tract = 0 if generator['anatomy_fraction'] < .5 else 1
    shapes = p['families'][generator['family']]
    distance = lambda shape: math.fsum(((shape[k]-generator['shape'][k])/RANGES[k])**2 for k in RANGES if k in shape)
    index = min(range(len(shapes)), key=lambda j: (distance(shapes[j]), j))
    return f"t{tract}-{generator['family']}-{index}"


def observe(engine, anatomy, shape, pose, controls, identity):
    """One generator frame through the same framing and gain path as predictions."""
    engine.set_anatomy(anatomy)
    audio, native = synthesize_phonation(engine, pose=pose, JA=controls['JA'], F0=controls['F0'], PR=controls['PR'], **shape)
    pcm, _ = _frame(audio, 48000)
    pcm = pcm*controls['gain']
    sha = hashlib.sha256(pcm.astype('<f4').tobytes()).hexdigest()
    return pcm, _metadata(identity, 48000, sha, 'engine-generated'), native


def selected(fit, family, field):
    """Family's joint candidate with the lowest calibration score; None when none is scorable."""
    rows = [r for r in fit.get('joint', {}).get('candidates', []) if family_of(r['candidate_id']) == family and r['status'] == 'scored' and r[field] is not None]
    return min(rows, key=lambda r: (r[field], r['candidate_id']))['candidate_id'] if rows else None


def joint_ranking(score, field):
    rows = [r for r in score['alternatives'] if r['family'] == 'joint' and r[field] is not None]
    return [r['candidate_id'] for r in sorted(rows, key=lambda r: (r[field], r['candidate_id']))]


def case_metrics(p, generator, fit, score):
    """Paired family comparison, ranks and unscorable counts for one (generator, held-out vowel) case."""
    rows = {r['candidate_id']: r for r in score['alternatives'] if r['family'] == 'joint'} if score else {}
    result = {}
    for name, (calibration_field, heldout_field) in SCORES.items():
        ranking = joint_ranking(score, heldout_field) if score else []
        chosen = {family: selected(fit, family, calibration_field) if fit else None for family in FAMILIES}
        discrepancy = {family: rows[c][heldout_field] if c in rows else None for family, c in chosen.items()}
        both = all(v is not None for v in discrepancy.values())
        own = [i+1 for i, c in enumerate(ranking) if family_of(c) == generator['family']]
        result[name] = {'selected': chosen, 'heldout_discrepancy': discrepancy,
            'difference_two_mass_minus_geometric': discrepancy['two_mass']-discrepancy['geometric'] if both else None,
            'winner': winner(discrepancy, p['tie_margin']), 'failures': {f: discrepancy[f] is None for f in FAMILIES},
            'true_family_rank': own[0] if own else None,
            'nearest_grid_rank': ranking.index(generator['nearest_grid'])+1 if generator['nearest_grid'] in ranking else None,
            'joint_ranking': ranking}
    result['unscorable_alternatives'] = {f: sum(1 for c, r in rows.items() if family_of(c) == f and r['score'] is None) if score else 6 for f in FAMILIES}
    return result


def winner(discrepancy, margin):
    g, m = discrepancy['geometric'], discrepancy['two_mass']
    if g is None and m is None:return 'none'
    if g is None:return 'two_mass'
    if m is None:return 'geometric'
    return 'two_mass' if m < g-margin else 'geometric' if g < m-margin else 'tie'


def decide(cases):
    """Frozen decision rule over all (generator, held-out vowel) cases."""
    wins = {name: {f: sum(c[name]['winner'] == f for c in cases) for f in FAMILIES} for name in SCORES}
    failures = {f: sum(c['primary']['failures'][f] for c in cases) for f in FAMILIES}
    threshold = 6
    if all(wins[n]['two_mass'] >= threshold for n in SCORES) and failures['two_mass'] <= failures['geometric']:outcome = 'positive'
    elif all(wins[n]['geometric'] >= threshold for n in SCORES) and failures['geometric'] <= failures['two_mass']:outcome = 'negative'
    else:outcome = 'inconclusive'
    return {'outcome': outcome, 'wins': wins, 'failures': failures, 'cases': len(cases), 'threshold': threshold}


def f0_rows(fit, banks):
    """Requested and simulated F0 for every calibration prediction and bank alternative."""
    rows = []
    for row in (fit or {}).get('joint', {}).get('candidates', []):
        for prediction in row['predictions']:
            rows.append({'stage': 'calibration:'+prediction['trial_id'], 'candidate_id': row['candidate_id'], 'family': family_of(row['candidate_id']),
                'requested_f0_hz': prediction['requested_f0_hz'], 'simulated_f0_hz': prediction['simulated_f0_hz']})
    for pose, bank in banks.items():
        for row in bank['forecast']['alternatives']:
            if row['family'] == 'joint':
                rows.append({'stage': 'heldout:'+pose, 'candidate_id': row['candidate_id'], 'family': family_of(row['candidate_id']),
                    'requested_f0_hz': row['requested_f0_hz'], 'simulated_f0_hz': row['simulated_f0_hz']})
    return rows


def compact_fit(fit):
    return {'status': fit.get('status'), 'reason': fit.get('reason'), 'actual_synthesis_calls': fit.get('actual_synthesis_calls'),
        'per_family_calls': {f: fit[f]['actual_synthesis_calls'] for f in ('joint', 'fixed_source', 'fixed_anatomy') if f in fit},
        'joint': [{'candidate_id': r['candidate_id'], 'status': r['status'], 'score': r['score'], 'score_excluding_pitch': r['score_excluding_pitch'],
                   'failures': r['failures'], 'f0': [{'trial_id': x['trial_id'], 'requested_f0_hz': x['requested_f0_hz'], 'simulated_f0_hz': x['simulated_f0_hz']} for x in r['predictions']]}
                  for r in fit.get('joint', {}).get('candidates', [])],
        'best': {f: (fit[f].get('best') or {}).get('candidate_id') for f in ('joint', 'fixed_source', 'fixed_anatomy') if f in fit}}


def compact_score(score):
    return {'status': score['status'], 'reason': score['reason'], 'canonical_extractions': score['canonical_extractions'], 'actual_synthesis_calls': score['actual_synthesis_calls'],
        'alternatives': [{k: r[k] for k in ('alternative_id', 'status', 'reason', 'score', 'score_excluding_pitch', 'heldout_rank', 'heldout_rank_excluding_pitch', 'requested_f0_hz', 'simulated_f0_hz')} for r in score['alternatives']]}


def run(output):
    p = json.loads(PROTOCOL_PATH.read_text())
    output.mkdir(parents=True)
    results = HERE/'results'
    results.mkdir(exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    cases, calls, per_generator = [], 0, []
    with Engine() as engine:
        capability = source_capability(engine)
        provenance = {'protocol_sha256': digest(p), 'worktree': worktree(), 'started_at': started, 'source_model_version': SOURCE_VERSION,
            'source_adapter_sha256': capability['source_adapter_sha256'], 'source_adapter_dependencies': adapter_dependencies(),
            'extractor_signature': extractor_signature(), 'capability_sha256': digest(capability), 'native_provenance': engine.provenance}
        write(output/'provenance.json', provenance)
        for generator in p['generators']:
            clock = time.perf_counter()
            record = {'generator': generator['id'], 'family': generator['family'], 'nearest_grid': generator['nearest_grid'], 'native_calls': {}}
            trials, observed_f0 = [], {}
            for t in p['calibration_trials']:
                pcm, metadata, _ = observe(engine, generator['anatomy'], generator['shape'], t['pose'],
                    {'JA': t['JA'], 'F0': t['requested_f0_hz'], 'PR': t['PR'], 'gain': t['gain']}, generator['id']+'-'+t['id'])
                calls += 1
                observed = measure_phonation(pcm, 48000, metadata)
                observed_f0[t['id']] = observed['descriptors']['pitchHz']['value']
                trials.append({'id': t['id'], 'pose': t['pose'], 'pcm': pcm.tolist(), 'sample_rate_hz': 48000, 'metadata': metadata})
            engine.set_anatomy({})
            record['generator_calibration_f0'] = {t['id']: {'requested_f0_hz': t['requested_f0_hz'], 'simulated_f0_hz': observed_f0[t['id']]} for t in p['calibration_trials']}
            if any(v is None for v in observed_f0.values()):
                record.update(status='unevaluable', reason='Generator calibration frame has no measured pitch')
                cases += [{'generator': generator['id'], 'pose': h['pose'], 'primary': {'winner': 'none', 'failures': {f: True for f in FAMILIES}},
                           'pitch_excluded': {'winner': 'none', 'failures': {f: True for f in FAMILIES}}, 'unscorable_alternatives': {f: 6 for f in FAMILIES}} for h in p['heldout_trials']]
                per_generator.append(record)
                continue
            fit = fit_phonation(engine, {'schema_version': 'phonation-fit-1', 'trials': trials}, candidates=candidates(p, observed_f0),
                max_synthesis_calls=p['budgets']['fit_max_synthesis_calls'], enabled=True, timeout_s=p['budgets']['fit_timeout_s'])
            calls += fit.get('actual_synthesis_calls', 0)
            record['native_calls']['fit'] = fit.get('actual_synthesis_calls', 0)
            write(output/f"{generator['id']}-fit.json", fit)
            record['fit'] = compact_fit(fit)
            banks = {}
            if fit.get('status') == 'available':
                for h in p['heldout_trials']:
                    banks[h['pose']] = forecast_phonation_bank(engine, fit, reference_trial_id='cal-a', pose=h['pose'],
                        controls={k: h[k] for k in ('JA', 'F0', 'PR', 'gain')}, target_id=generator['id']+'-heldout-'+h['pose'],
                        max_synthesis_calls=p['budgets']['bank_max_synthesis_calls'], timeout_s=p['budgets']['bank_timeout_s'])
                    calls += banks[h['pose']]['forecast']['actual_synthesis_calls']
                    record['native_calls']['bank-'+h['pose']] = banks[h['pose']]['forecast']['actual_synthesis_calls']
                    write(output/f"{generator['id']}-bank-{h['pose']}.json", banks[h['pose']])
            record['heldout'] = {}
            for h in p['heldout_trials']:
                # Held-out generator frames exist only after both banks are frozen.
                pcm, metadata, _ = observe(engine, generator['anatomy'], generator['shape'], h['pose'], h, generator['id']+'-heldout-'+h['pose'])
                calls += 1
                engine.set_anatomy({})
                score = score_phonation_bank(banks[h['pose']], pcm, metadata) if h['pose'] in banks else None
                if score:write(output/f"{generator['id']}-score-{h['pose']}.json", score)
                metrics = case_metrics(p, generator, fit if fit.get('status') == 'available' else None, score)
                cases.append({'generator': generator['id'], 'pose': h['pose'], **metrics})
                record['heldout'][h['pose']] = {'bank_coverage': banks[h['pose']]['forecast']['coverage'] if h['pose'] in banks else None,
                    'bank_sha256': banks[h['pose']]['sha256'] if h['pose'] in banks else None,
                    'score': compact_score(score) if score else None, 'metrics': metrics}
            record['f0'] = f0_rows(fit, banks)
            record['wall_s'] = round(time.perf_counter()-clock, 2)
            record['status'] = 'evaluated'
            per_generator.append(record)
            write(results/f"{generator['id']}.json", record)
            print(generator['id'], record['native_calls'], record['wall_s'], 's', flush=True)
    f0 = [row for g in per_generator for row in g.get('f0', [])]
    mismatch = {f: summary([r['simulated_f0_hz']-r['requested_f0_hz'] for r in f0 if r['family'] == f and r['simulated_f0_hz'] is not None],
                           sum(1 for r in f0 if r['family'] == f and r['simulated_f0_hz'] is None)) for f in FAMILIES}
    report = {'protocol_version': p['version'], 'provenance': provenance, 'finished_at': datetime.now(timezone.utc).isoformat(),
        'native_calls': calls, 'hard_total_native_calls': p['budgets']['hard_total_native_calls'], 'evidence_source': 'synthetic',
        'decision': decide(cases), 'cases': cases, 'f0_mismatch_hz': mismatch,
        'generators': [{k: g[k] for k in ('generator', 'family', 'status', 'native_calls', 'generator_calibration_f0') if k in g} | {'wall_s': g.get('wall_s')} for g in per_generator]}
    if calls > p['budgets']['hard_total_native_calls']:raise RuntimeError('Native call budget exceeded')
    write(results/'report.json', report)
    return report


def summary(values, missing):
    if not values:return {'count': 0, 'missing_pitch': missing}
    ordered = sorted(values)
    return {'count': len(values), 'missing_pitch': missing, 'mean': math.fsum(values)/len(values), 'median': ordered[len(ordered)//2],
            'min': ordered[0], 'max': ordered[-1], 'mean_absolute': math.fsum(abs(v) for v in values)/len(values)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    result = run(parser.parse_args().output)
    print(json.dumps(result['decision'], indent=2))
