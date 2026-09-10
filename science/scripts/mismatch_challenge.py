"""Fixed-budget development challenge; synthetic mismatch is not human evidence."""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from singing_physics.engine import Engine, write_json
from singing_physics.inverse import FREE, fit, make_observations

TRUTH = {'hard_palate_length': 4.42, 'pharynx_length': 6.83}
SEED = 47
BUDGET = 900


def tilt(document):
    changed = deepcopy(document)
    for row in changed['observations']:
        frequency = np.asarray(row['frequency_hz'])
        row['magnitude_db'] = (np.asarray(row['magnitude_db']) + 3 * np.log2(frequency / 1000)).tolist()
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    cases = [('clean', {}, False), ('fixed_geometry_mismatch', {'palate_depth': 4.2}, False),
             ('smooth_transfer_tilt', {}, True)]
    scores = []
    with Engine() as engine:
        provenance = deepcopy(engine.provenance)
        for name, perturbation, apply_tilt in cases:
            destination = args.output / name
            destination.mkdir()
            try:
                observations = make_observations(engine, {**TRUTH, **perturbation})
                if apply_tilt:
                    observations = tilt(observations)
                # The fit receives no truth, perturbation parameters, or held-out data.
                write_json(destination / 'observations.json', observations)
                fitted = fit(engine, observations, seed=SEED, starts=1, max_spectrum_evaluations=BUDGET)
                write_json(destination / 'fit.json', fitted)
                # Scoring begins only after the complete fit artifact has been written.
                held_out = make_observations(engine, {**TRUTH, **perturbation}, poses=('e',))
                if apply_tilt:
                    held_out = tilt(held_out)
                target = held_out['observations'][0]
                engine.set_anatomy(fitted['best']['anatomy'])
                hz, predicted, _ = engine.spectrum('e', bins=512)
                mask = (hz >= 100) & (hz <= 6000)
                score = {'case': name, 'status': 'completed', 'truth_cm': TRUTH,
                         'generating_fixed_parameter_overrides': perturbation,
                         'transfer_tilt_db_per_octave': 3 if apply_tilt else 0,
                         'fitted_anatomy_cm': fitted['best']['anatomy'],
                         'absolute_error_cm': {key: abs(fitted['best']['anatomy'][key]-TRUTH[key]) for key in FREE},
                         'calibration_rmse_db': fitted['best']['rmse_db'],
                         'held_out_rmse_db': float(np.sqrt(np.mean((predicted[mask]-target['magnitude_db'])**2))),
                         'baseline_rmse_db': fitted['fixed_anatomy_rmse_db'],
                         'termination': fitted['termination'],
                         'spectrum_evaluations': fitted['spectrum_evaluations'],
                         'candidate_spread_is_calibrated_posterior': fitted['candidate_spread_is_calibrated_posterior'],
                         'fitter_has_model_mismatch_detector': False}
            except Exception as exc:
                score = {'case': name, 'status': 'failed', 'error': f'{type(exc).__name__}: {exc}'}
            write_json(destination / 'score.json', score)
            scores.append(score)
            print(json.dumps(score, allow_nan=False), flush=True)
    clean = next((s for s in scores if s['case'] == 'clean' and s['status'] == 'completed'), None)
    if clean is not None:
        for score in scores:
            if score['status'] == 'completed':
                score['drift_from_clean_cm'] = {key: score['fitted_anatomy_cm'][key]-clean['fitted_anatomy_cm'][key] for key in FREE}
    write_json(args.output / 'report.json', {
        'kind': 'synthetic_development_mismatch_challenge', 'schema_version': '0.1.0',
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'seed': SEED, 'spectrum_budget_per_case': BUDGET, 'starts': 1,
        'provenance': provenance, 'cases': scores,
        'limitations': ['Known template articulation and direct simulator transfer functions',
                        'One development anatomy; not independent EVAL-01 or human evidence',
                        'Capture proxy is only smooth spectral tilt, not a microphone/room simulation',
                        'Budget-limited optimization can confound mismatch with optimization failure',
                        'Candidate spread is not calibrated; no automatic mismatch detector exists']})
    if any(s['status'] != 'completed' for s in scores):
        raise SystemExit('One or more attempts failed; inspect preserved report.json')


if __name__ == '__main__':
    main()
