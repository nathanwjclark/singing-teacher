"""Bounded native PCM -> canonical descriptor -> finite-grid fit plumbing check."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from singing_physics.engine import Engine
from singing_physics.pcm_inverse import extract_pcm, fit_pcm


def write(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    anatomy = {'hard_palate_length': 4.2, 'pharynx_length': 7.0}
    controls = {'a': {'JA': -2., 'f0_hz': 180., 'gain': .8},
                'i': {'JA': -4., 'f0_hz': 180., 'gain': 16.}}
    candidates = [{'candidate_id': 'candidate-0', 'anatomy': {}, 'trials': deepcopy(controls)},
        {'candidate_id': 'candidate-1', 'anatomy': anatomy, 'trials': deepcopy(controls)},
        {'candidate_id': 'candidate-2', 'anatomy': anatomy,
         'trials': {p: {**c, 'f0_hz': 220., 'gain': c['gain']*1.5} for p, c in controls.items()}}]
    write(args.output/'candidate-grid.json', candidates)
    write(args.output/'generating-truth.json', {'anatomy': anatomy, 'controls': controls,
        'interpretation': 'Generator intentionally included in finite grid; integration check, not blind recovery'})
    with Engine() as engine:
        def trial(name, pose, geometry, control):
            engine.set_anatomy(geometry)
            audio = engine.synthesize(pose, {'JA': control['JA']}, f0_hz=control['f0_hz'], duration_s=.25)
            canonical = extract_pcm(audio[4410:8506]*control['gain'], engine.sample_rate,
                measurement_id=name+'-measurement', observation_id=name, artifact_id=name+'-pcm', start_ms=100.)
            return {'id': name, 'pose': pose, 'measurement': canonical['measurement'],
                'sample_rate_hz': engine.sample_rate, 'frame_start_sample': 4410, 'frame_size': 4096, 'duration_s': .25}
        observations = {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations',
            'trials': [trial(p, p, anatomy, c) for p, c in controls.items()]}
        write(args.output/'observations.json', observations)
        fit = fit_pcm(engine, observations, candidates=candidates, max_synthesis_calls=12)
        write(args.output/'frozen-fit.json', fit)
        selected = fit['joint']['best']
        if selected is None:
            raise RuntimeError('No scored candidate; retained fit reports missing predicted features')
        held_control = {'JA': -3., 'f0_hz': 190., 'gain': 32.}
        held = trial('heldout', 'e', anatomy, held_control)
        prediction = trial('predicted', 'e', selected['anatomy'], held_control)
        write(args.output/'heldout-scoring-only.json', {'observed': held, 'predicted': prediction,
            'controls': held_control, 'interpretation': 'Known held-out JA/F0/gain, conditional scoring after fit frozen'})
        truth = {m['name']: m['value'] for m in held['measurement']['measurements']}
        pred = {m['name']: m['value'] for m in prediction['measurement']['measurements']}
        summary = {'selected_candidate': selected['candidate_id'],
            'joint_objective': selected['weighted_mean_square_discrepancy'],
            'baseline_objective': fit['fixed_anatomy_baseline']['best']['weighted_mean_square_discrepancy'],
            'heldout_errors': {k: pred[k]-value if value is not None and pred[k] is not None else None for k, value in truth.items()},
            'fit_synthesis_calls': fit['actual_synthesis_calls'], 'whole_demo_synthesis_calls': 16,
            'frozen_fit_file_sha256': hashlib.sha256((args.output/'frozen-fit.json').read_bytes()).hexdigest(),
            'interpretation': 'Noiseless same-generator finite-grid integration check; not physiological identifiability'}
        write(args.output/'summary.json', summary)
        print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
