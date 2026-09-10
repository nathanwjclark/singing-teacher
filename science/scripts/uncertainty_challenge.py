"""Predeclared multistart sensitivity challenge, never interval calibration."""
from copy import deepcopy
import argparse
import hashlib
import inspect
import json
from pathlib import Path

import numpy as np

from singing_physics.engine import Engine, write_json
from singing_physics.joint import ANATOMY_BOUNDS, KIND, fit_joint

TRUTHS = [(4.50, 6.60), (4.40, 6.50), (4.47, 6.57)]
SETTINGS = {'budget_per_model': 75, 'starts': 3, 'seed': 53}
THRESHOLDS = {'good_calibration_rmse_db': 1.0, 'small_near_range_cm': .02,
              'large_anatomy_error_cm': .05}


def observation_document(engine, anatomy):
    engine.set_anatomy(anatomy)
    rows = []
    for pose in ('a', 'i', 'u'):
        hz, db, _ = engine.spectrum(pose, overrides={'JA': -3.}, bins=512)
        selected = (hz >= 100) & (hz <= 6000)
        rows.append({'id': pose, 'pose': pose, 'split': 'calibration',
                     'frequency_hz': hz[selected].tolist(), 'magnitude_db': db[selected].tolist()})
    return {'schema_version': '0.1.0', 'kind': KIND, 'provenance': deepcopy(engine.provenance),
            'sample_rate_hz': engine.sample_rate, 'spectrum_bins': 512,
            'spectral_sigma_db': 1., 'observations': rows}


def score_saved_fit(path, truth):
    """Truth is scoring-only; a fit must already exist before scoring starts."""
    raw = Path(path).read_bytes()
    fit = json.loads(raw)
    model = fit['joint']
    candidates = model['candidates']
    best = model['best']
    names = list(ANATOMY_BOUNDS)
    errors = {name: abs(best['anatomy'][name]-truth[name]) for name in names}
    ranges = {name: float(np.ptp([candidate['anatomy'][name] for candidate in candidates])) for name in names}
    near_ranges = model['near_optimal_anatomy_spread_cm']
    multiple_near = model['near_optimal_candidates'] >= 2
    large_error = max(errors.values()) > THRESHOLDS['large_anatomy_error_cm']
    good_fit = best['rmse_db'] <= THRESHOLDS['good_calibration_rmse_db']
    small_range = max(near_ranges.values()) <= THRESHOLDS['small_near_range_cm']
    return {'fit_sha256': hashlib.sha256(raw).hexdigest(), 'truth_cm': truth,
            'fitted_anatomy_cm': {name: best['anatomy'][name] for name in names},
            'absolute_error_cm': errors, 'candidate_count': len(candidates),
            'candidate_range_cm': ranges, 'near_candidate_count': model['near_optimal_candidates'],
            'near_candidate_range_cm': near_ranges, 'singleton_near_range_noninformative': not multiple_near,
            'calibration_rmse_db': best['rmse_db'],
            'fixed_anatomy_baseline_rmse_db': fit['fixed_anatomy_baseline']['best']['rmse_db'],
            'candidate_terminations': [candidate['termination'] for candidate in candidates],
            'baseline_candidate_terminations': [candidate['termination'] for candidate in fit['fixed_anatomy_baseline']['candidates']],
            'spectrum_calls': fit['spectrum_calls'],
            'multiple_near_small_range_large_error': multiple_near and small_range and large_error,
            'good_calibration_large_error': good_fit and large_error,
            'spread_is_calibrated_posterior': model['spread_is_calibrated_posterior']}


def run(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    protocol = {'kind': 'predeclared_synthetic_multistart_development_challenge',
                'settings': SETTINGS, 'diagnostic_thresholds': THRESHOLDS,
                'threshold_scope': 'Illustrative diagnostics, not clinical accuracy or calibrated confidence',
                'scoring_truths_cm': [dict(zip(ANATOMY_BOUNDS, values)) for values in TRUTHS],
                'conditions': {'clean': {}, 'omitted_palate_depth': {'palate_depth': 4.2}},
                'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'fitter_source_sha256': hashlib.sha256(Path(inspect.getfile(fit_joint)).read_bytes()).hexdigest()}
    # Publish the full development protocol before any case is fitted; none of
    # this scoring metadata is passed as a fitter argument.
    write_json(output / 'protocol.json', protocol)
    scores = []
    with Engine() as engine:
        provenance = deepcopy(engine.provenance)
        for index, values in enumerate(TRUTHS):
            truth = dict(zip(ANATOMY_BOUNDS, values))
            for condition, perturbation in protocol['conditions'].items():
                case_id = f'{index}-{condition}'
                destination = output / case_id
                destination.mkdir()
                try:
                    anatomy = {**truth, **perturbation}
                    observations = observation_document(engine, anatomy)
                    write_json(destination / 'observations.json', observations)
                    fitted = fit_joint(engine, observations, **SETTINGS)
                    write_json(destination / 'fit.json', fitted)
                    score = score_saved_fit(destination / 'fit.json', truth)
                    # Conditional held-out check uses a fixed, predeclared JA,
                    # not a state optimized against the held-out spectrum.
                    engine.set_anatomy(anatomy)
                    hz, target, _ = engine.spectrum('e', {'JA': -3.}, bins=512)
                    engine.set_anatomy(fitted['joint']['best']['anatomy'])
                    _, predicted, _ = engine.spectrum('e', {'JA': -3.}, bins=512)
                    selected = (hz >= 100) & (hz <= 6000)
                    score.update(case_id=case_id, status='completed', condition=condition,
                        omitted_parameters=perturbation,
                        held_out_known_JA_rmse_db=float(np.sqrt(np.mean((predicted[selected]-target[selected])**2))))
                except Exception as exc:
                    score = {'case_id': case_id, 'status': 'failed', 'error': f'{type(exc).__name__}: {exc}'}
                write_json(destination / 'score.json', score)
                scores.append(score)
                print(json.dumps(score, allow_nan=False), flush=True)
    report = {'protocol': protocol, 'provenance': provenance, 'cases': scores,
              'limitations': ['Six paired development cases, not independent final evaluation',
                  'No calibrated intervals, posterior probabilities or uncertainty coverage',
                  'Optimization exhaustion can confound physical mismatch with optimization error',
                  'Generated articulation is known only to scoring; calibration JA is fitted',
                  'Held-out score is conditional on predeclared JA, not cue-execution prediction',
                  'No microphone or capture-response experiment']}
    write_json(output / 'report.json', report)
    if any(score['status'] != 'completed' for score in scores):
        raise RuntimeError('Some attempts failed; all outcomes preserved in report.json')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    run(parser.parse_args().output)
