#!/usr/bin/env python3
"""Frozen-ranking synthetic challenge with retained failures and honest ambiguity."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path

import numpy as np

from singing_physics.engine import Engine, digest, write_json
from singing_physics.identifiability import freeze_hypotheses, rank_interventions


def now():
    return datetime.now(timezone.utc).isoformat()


def challenge(output, *, seed=7):
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError('seed must be an unsigned 32-bit integer')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    rng = np.random.default_rng(seed)
    sigma = .5
    truth = {'anatomy': {'hard_palate_length': 4.5, 'pharynx_length': 6.6}, 'articulation': {'JA': -3.}}
    interventions = [{'intervention_id': pose, 'kind': 'named_pose', 'pose': pose, 'articulation': {}}
                     for pose in ('a', 'i', 'u')]
    interventions.append({'intervention_id': 'jaw-clamp-a', 'kind': 'named_pose', 'pose': 'a', 'articulation': {'JA': -2.}})
    protocol = {'kind': 'synthetic_identifiability_protocol', 'seed': seed,
        'calibration_band_hz': [100., 600.], 'ranking_band_hz': [100., 6000.], 'noise_sigma_db': sigma,
        'noise_generation': 'independent Gaussian noise per returned direct-transfer dB feature',
        'retention': 'lowest calibration RMSE, at most six hypotheses with RMSE <= 2 * noise sigma',
        'grid': {'hard_palate_length_cm': [4.3, 4.5, 4.7], 'pharynx_length_cm': [6.4, 6.6, 6.8],
                 'JA_deg': [-3.4, -3., -2.6]}, 'interventions': interventions,
        'ranking_criterion': 'worst retained-pair RMS divided by assumed noise SD',
        'threshold': 1., 'maximum_native_calls': 53}
    write_json(output / 'protocol.json', protocol)
    with Engine() as engine:
        provenance = engine.provenance
        engine.set_anatomy(truth['anatomy'])
        hz, magnitude, _ = engine.spectrum('a', truth['articulation'], bins=512)
        mask = (hz >= 100) & (hz <= 600)
        calibration = magnitude[mask] + rng.normal(0, sigma, int(mask.sum()))
        write_json(output / 'calibration.json', {'kind': 'synthetic_direct_transfer', 'evidence_id': 'calibration',
            'frequency_hz': hz[mask].tolist(), 'magnitude_db': calibration.tolist()})
        trials = []
        for palate in (4.3, 4.5, 4.7):
            for pharynx in (6.4, 6.6, 6.8):
                for jaw in (-3.4, -3., -2.6):
                    candidate = {'hypothesis_id': f'palate-{palate}-pharynx-{pharynx}-jaw-{jaw}',
                        'anatomy': {'hard_palate_length': palate, 'pharynx_length': pharynx}, 'articulation': {'JA': jaw}}
                    try:
                        engine.set_anatomy(candidate['anatomy'])
                        _, predicted, _ = engine.spectrum('a', candidate['articulation'], bins=512)
                        rmse = float(np.sqrt(np.mean((predicted[mask] - calibration) ** 2)))
                        trials.append({'hypothesis': candidate, 'status': 'evaluated', 'rmse_db': rmse})
                    except (ValueError, RuntimeError) as exc:
                        trials.append({'hypothesis': candidate, 'status': 'failed', 'error': str(exc)})
    write_json(output / 'all-grid-trials.json', trials)
    retained = sorted([row for row in trials if row['status'] == 'evaluated' and row['rmse_db'] <= 2*sigma],
                      key=lambda row: (row['rmse_db'], row['hypothesis']['hypothesis_id']))[:6]
    if len(retained) < 2:
        result = {'kind': 'synthetic_identifiability_challenge', 'status': 'insufficient_retained_hypotheses',
                  'retained_count': len(retained), 'claim': 'No pair discrimination experiment was run'}
    else:
        frozen = freeze_hypotheses(model_id='synthetic-grid-model', evidence_ids=['calibration'],
            provenance=provenance, hypotheses=[row['hypothesis'] for row in retained], frozen_at=now())
        frozen.write(output / 'hypotheses.json')
        ranking = rank_interventions(frozen, expected_digest=frozen.sha256, ranking_id='pretarget-ranking',
            target_evidence_id='heldout-target', generated_at=now(), interventions=interventions,
            noise_sigma_db=sigma, noise_assumption='Predeclared synthetic independent Gaussian dB sensor SD',
            max_native_calls=24)
        ranking.write(output / 'ranking.json')
        chosen = ranking.data['rankings'][0]['intervention']
        # No held-out observation exists until this ranking is persisted.
        with Engine() as engine:
            engine.set_anatomy(truth['anatomy'])
            hz, magnitude, _ = engine.spectrum(chosen['pose'], {**truth['articulation'], **chosen['articulation']}, bins=512)
        mask = (hz >= 100) & (hz <= 6000)
        observed = magnitude[mask] + rng.normal(0, sigma, int(mask.sum()))
        write_json(output / 'heldout.json', {'evidence_id': 'heldout-target', 'observed_at': now(),
            'kind': 'synthetic_direct_transfer', 'ranking_sha256': ranking.sha256,
            'frequency_hz': hz[mask].tolist(), 'magnitude_db': observed.tolist(), 'intervention': chosen})
        scores = [{'hypothesis_id': row['hypothesis_id'],
                   'heldout_rmse_db': float(np.sqrt(np.mean((np.array(row['magnitude_db']) - observed) ** 2)))}
                  for row in ranking.data['rankings'][0]['predictions']]
        scores.sort(key=lambda row: (row['heldout_rmse_db'], row['hypothesis_id']))
        result = {'kind': 'synthetic_identifiability_challenge', 'status': ranking.data['rankings'][0]['status'],
            'retained_count': len(retained), 'ranking_sha256': ranking.sha256, 'chosen_intervention': chosen,
            'worst_pair_standardized_rms': ranking.data['rankings'][0]['worst_pair_standardized_rms'],
            'heldout_scores': scores, 'ranking_native_calls': ranking.data['native_calls'],
            'claim': 'Finite-grid synthetic discrimination only; no anatomical identifiability established'}
    write_json(output / 'generation-truth.json', truth)
    write_json(output / 'result.json', result)
    write_json(output / 'manifest.json', {'files': {p.name: digest(p) for p in output.iterdir() if p.is_file()}})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--seed', type=int, default=7)
    args = parser.parse_args()
    print(json.dumps(challenge(args.output, seed=args.seed), indent=2))


if __name__ == '__main__':
    main()
