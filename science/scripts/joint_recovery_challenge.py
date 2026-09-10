"""Predeclared Lead-A synthetic anatomy/articulation separation challenge.

This is an investigator's same-simulator check, not B's independent evaluation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from singing_physics.engine import Engine
from singing_physics.joint import ANATOMY_BOUNDS, fit_joint, KIND

PROTOCOL = {
    'version': 'joint-recovery-challenge-1', 'case_seeds': [72103, 84317, 95609, 106631],
    'optimizer_seed': 81, 'budget_per_model': 160, 'starts': 2,
    'calibration_poses': ['a', 'i', 'u'], 'held_out_pose': 'e',
    'hard_spectrum_limit': 3900, 'spectral_noise_sd_db': 0.,
    'selection': 'existing fit_joint calibration objective, no held-out selection',
    'held_out_control': 'known generating JA supplied only during scoring; conditional anatomy generalization',
    'case_sampling': 'independent uniform anatomy within joint bounds and JA within [-5,-1]',
    'acceptance': {'max_anatomy_absolute_error_cm': .1, 'max_calibration_applied_JA_error_deg': .5,
                   'held_out_rmse_db': 1.},
    'evidence_level': 'Lead-A same-simulator direct-transfer experiment, not independent evaluation',
}


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n')


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def generating_case(seed, poses):
    rng = np.random.default_rng(seed)
    return {'anatomy': {key: float(rng.uniform(*bounds)) for key, bounds in ANATOMY_BOUNDS.items()},
            'JA': {pose: float(rng.uniform(-5., -1.)) for pose in poses}}


def calibration_document(engine, truth, poses):
    """Return observations with no generating anatomy or generating JA attached."""
    engine.set_anatomy(truth['anatomy'])
    rows, applied = [], {}
    for pose in poses:
        _, controls = engine.pose(pose, {'JA': truth['JA'][pose]})
        applied[pose] = controls['JA']['applied']
        frequency, magnitude, _ = engine.spectrum(pose, {'JA': truth['JA'][pose]}, bins=512)
        mask = (frequency >= 100) & (frequency <= 6000)
        rows.append({'id': pose, 'split': 'calibration', 'pose': pose,
                     'frequency_hz': frequency[mask].tolist(), 'magnitude_db': magnitude[mask].tolist()})
    return {'schema_version': '0.1.0', 'kind': KIND, 'sample_rate_hz': engine.sample_rate,
            'spectrum_bins': 512, 'spectral_sigma_db': 1., 'provenance': dict(engine.provenance),
            'observations': rows}, applied


def score_model(engine, model, truth, applied_truth, held_out, target):
    best = model['best']
    engine.set_anatomy(best['anatomy'])
    frequency, db, _ = engine.spectrum(held_out, {'JA': truth['JA'][held_out]}, bins=512)
    mask = (frequency >= 100) & (frequency <= 6000)
    anatomy_errors = {key: best['anatomy'][key]-truth['anatomy'][key] for key in ANATOMY_BOUNDS}
    articulation_errors = {pose: best['trial_controls'][pose]['JA']['applied']-value for pose, value in applied_truth.items()}
    return {'anatomy_error_cm': anatomy_errors, 'applied_JA_error_deg': articulation_errors,
            'calibration_rmse_db': best['rmse_db'],
            'held_out_known_JA_rmse_db': float(np.sqrt(np.mean((db[mask]-target)**2))),
            'selected_termination': best['termination'],
            'all_terminations': [candidate['termination'] for candidate in model['candidates']],
            'residual_calls': model['residual_calls'], 'spectrum_calls': model['spectrum_calls']}


def run(output, protocol=None):
    config = json.loads(json.dumps(PROTOCOL if protocol is None else protocol))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    write(output/'protocol.json', config)
    counters = {'actual_spectrum_calls': 0}
    cases = []
    with Engine() as engine:
        native = engine.spectrum
        def counted(*args, **kwargs):
            if counters['actual_spectrum_calls'] >= config['hard_spectrum_limit']:
                raise RuntimeError('predeclared hard spectrum budget exhausted')
            counters['actual_spectrum_calls'] += 1
            return native(*args, **kwargs)
        engine.spectrum = counted
        provenance = dict(engine.provenance)
        for index, seed in enumerate(config['case_seeds']):
            folder = output/f'case-{index}'
            folder.mkdir()
            start = counters['actual_spectrum_calls']
            truth = generating_case(seed, [*config['calibration_poses'], config['held_out_pose']])
            write(folder/'generating-truth.json', truth)
            case = {'case': index, 'seed': seed, 'status': 'failed'}
            try:
                document, applied = calibration_document(engine, truth, config['calibration_poses'])
                write(folder/'observations.json', document)
                engine.set_anatomy({})
                fit = fit_joint(engine, document, budget_per_model=config['budget_per_model'],
                                starts=config['starts'], seed=config['optimizer_seed'])
                write(folder/'frozen-fit.json', fit)
                case['frozen_fit_sha256'] = canonical_hash(fit)
                # The held-out target spectrum does not exist until fit selection is frozen.
                engine.set_anatomy(truth['anatomy'])
                frequency, db, _ = engine.spectrum(config['held_out_pose'],
                    {'JA': truth['JA'][config['held_out_pose']]}, bins=512)
                mask = (frequency >= 100) & (frequency <= 6000)
                target = db[mask]
                write(folder/'held-out-scoring-only.json', {'pose': config['held_out_pose'],
                    'known_JA': truth['JA'][config['held_out_pose']],
                    'frequency_hz': frequency[mask].tolist(), 'magnitude_db': target.tolist()})
                scores = {name: score_model(engine, fit[name], truth, applied,
                    config['held_out_pose'], target) for name in ('joint', 'fixed_anatomy_baseline')}
                acceptance = config['acceptance']
                joint = scores['joint']
                passed = (max(abs(x) for x in joint['anatomy_error_cm'].values()) <= acceptance['max_anatomy_absolute_error_cm']
                    and max(abs(x) for x in joint['applied_JA_error_deg'].values()) <= acceptance['max_calibration_applied_JA_error_deg']
                    and joint['held_out_known_JA_rmse_db'] <= acceptance['held_out_rmse_db'])
                case.update(status='scored', scores=scores, acceptance_pass=passed,
                            reported_fit_spectrum_calls=fit['spectrum_calls'])
            except Exception as exc:
                case['error'] = f'{type(exc).__name__}: {exc}'
            finally:
                case['actual_spectrum_calls'] = counters['actual_spectrum_calls']-start
                engine.set_anatomy({})
                write(folder/'score.json', case)
                cases.append(case)
    result = {'protocol': config, 'protocol_sha256': canonical_hash(config), 'provenance': provenance,
              'cases': cases, **counters,
              'limitations': ['Same simulator and noiseless transfer; not human recordings',
                  'Held-out JA known only for conditional scoring, not blind motor prediction',
                  'Bounded search can fail before reaching best fit; nonconvergence retained',
                  'A low predictive error does not establish unique anatomy',
                  'Investigator-run challenge, not independent B evaluation']}
    write(output/'result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = run(args.output)
    print(json.dumps({'actual_spectrum_calls': result['actual_spectrum_calls'],
                      'cases': [{k: case[k] for k in ('case', 'status', 'acceptance_pass') if k in case}
                                for case in result['cases']]}, indent=2))


if __name__ == '__main__':
    main()
