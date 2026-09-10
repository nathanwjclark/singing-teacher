"""Service-backed calibration/search/design/later-PCM/update research replay."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np

from singing_physics.engine import Engine, digest, write_json
from singing_physics.pcm_inverse import FEATURES, extract_pcm
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.prediction import Artifact
from singing_physics.service import JobService, canonical


def now():
    return datetime.now(timezone.utc).isoformat()


def replay(output, *, rounds=2):
    if type(rounds) is not int or not 1 <= rounds <= 3:
        raise ValueError('Replay rounds must be in [1, 3]')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    # Write protocol before generating any data. Bounds/scales are engineering
    # choices, not tuned on later target outcomes or statistical confidence.
    protocol = {'kind': 'synthetic_pcm_active_protocol', 'maximum_rounds': rounds,
        'generating_anatomy': {'hard_palate_length': 4.37},
        'calibration_control': {'JA': -2., 'f0_hz': 180., 'gain': .8},
        'search_bounds': {'hard_palate_length': [3.8, 5.1]},
        'search_seed': 7, 'search_rounds': 2, 'search_synthesis_cap': 18,
        'shortlist_policy': 'At most four unique scored geometries sorted by calibration discrepancy; retain full search separately',
        'experiments': [{'experiment_id': 'a', 'pose': 'a', 'JA': -3., 'f0_hz': 190., 'gain': 1.},
                        {'experiment_id': 'i', 'pose': 'i', 'JA': -3., 'f0_hz': 190., 'gain': 16.},
                        {'experiment_id': 'e', 'pose': 'e', 'JA': -3., 'f0_hz': 190., 'gain': 32.}],
        'feature_scales': {name: {'unit': unit, 'scale': scale,
            'assumption': 'Predeclared engineering discrepancy scale; not measured noise'}
            for name, (unit, scale) in FEATURES.items()},
        'minimum_separation': .05, 'retention_margin': .05, 'maximum_discrepancy': 2.,
        'no_separation_policy': 'Stop without acquiring a target',
        'maximum_whole_replay_synthesis_calls': 19 + 13 * rounds,
        'claim': 'Finite simulated support and declared execution only; no human anatomy or learning claim'}
    write_json(output / 'protocol.json', protocol)
    with Engine() as engine:
        engine.set_anatomy(protocol['generating_anatomy'])
        control = protocol['calibration_control']
        audio = engine.synthesize('a', {'JA': control['JA']}, f0_hz=control['f0_hz'], duration_s=.25)
        frame = np.asarray(audio[4410:8506] * control['gain'], dtype=np.float32)
        provenance = engine.provenance
        measurement = extract_pcm(frame, 44100, measurement_id='calibration-measurement',
            observation_id='calibration', artifact_id='calibration-pcm', start_ms=100.)['measurement']
    (output / 'calibration.pcm.f32').write_bytes(frame.astype('<f4').tobytes())
    document = {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': [{
        'id': 'calibration', 'pose': 'a', 'measurement': measurement, 'sample_rate_hz': 44100,
        'frame_start_sample': 4410, 'frame_size': 4096, 'duration_s': .25}]}
    write_json(output / 'calibration.json', document)
    jobs, steps, total_calls = [], [], 1
    final_support = []
    with JobService(output / 'jobs', timeout_s=180) as service:
        def run(operation, parameters, key, model_id=None):
            request = {'operation': operation, 'parameters': parameters}
            if model_id is not None:
                request.update(session_id='synthetic-active-session', model_id=model_id)
            job = service.submit(request, idempotency_key=key)
            state = service.wait(job)
            jobs.append({'job_id': job, 'operation': operation, 'status': state['status']})
            if state['status'] != 'succeeded':
                raise RuntimeError(f'{operation} failed: {state["error"]}')
            return job, service.result(job)

        _, search = run('search_pcm', {'observations': document,
            'anatomy_bounds': protocol['search_bounds'],
            'nuisance_profiles': [{'profile_id': 'declared-source', 'trials': {'calibration': control}}],
            'max_synthesis_calls': 18, 'rounds': 2, 'seed': 7}, 'calibration-search')
        write_json(output / 'search.json', search)
        total_calls += search['actual_synthesis_calls']
        scored = sorted((row for row in search['joint']['candidates'] if row['status'] == 'scored'),
            key=lambda row: (row['weighted_mean_square_discrepancy'], row['candidate_id']))
        hypotheses, seen = [], set()
        for row in scored:
            key = canonical(row['anatomy'])
            if key not in seen and len(hypotheses) < 4:
                hypotheses.append({'hypothesis_id': row['candidate_id'], 'anatomy': row['anatomy']})
                seen.add(key)
        if not hypotheses:
            outcome = 'no_scorable_calibration_hypotheses'
        else:
            snapshot = freeze_pcm_hypotheses(model_id='synthetic-active-model',
                evidence_ids=['calibration', 'calibration-measurement', 'calibration-pcm'],
                evidence_hashes=measurement['provenance']['sourceHashes'],
                provenance=provenance, hypotheses=hypotheses, frozen_at=now())
            snapshot.write(output / 'initial-hypotheses.json')
            outcome = 'round_limit'
            for index in range(rounds):
                model_id = snapshot.data['model_id']
                service.register_model('synthetic-active-session', model_id)
                target = f'prospective-{index}'
                design_job, design_data = run('design_pcm', {
                    'snapshot_json': snapshot.content.decode(), 'expected_digest': snapshot.sha256,
                    'design_id': f'design-{index}', 'target_observation_id': target, 'generated_at': now(),
                    'experiments': protocol['experiments'], 'feature_scales': protocol['feature_scales'],
                    'minimum_separation': protocol['minimum_separation'],
                    'retention_margin': protocol['retention_margin'],
                    'maximum_discrepancy': protocol['maximum_discrepancy'],
                    'max_synthesis_calls': 12}, f'design-{index}', model_id)
                design_path = output / 'jobs' / 'artifacts' / design_job / 'design.json'
                design = Artifact(design_path.read_bytes())
                if design.data != design_data:
                    raise RuntimeError('Sealed design differs from verified job result')
                design.write(output / f'design-{index}.json')
                total_calls += design_data['actual_synthesis_calls']
                step = {'round': index, 'design_sha256': design.sha256,
                    'before_count': len(snapshot.data['hypotheses']),
                    'selected_experiment_id': design_data['selected_experiment_id']}
                steps.append(step)
                if design_data['selected_experiment_id'] is None:
                    outcome = 'no_separating_experiment'
                    break
                chosen = next(r['experiment'] for r in design_data['rankings']
                    if r['experiment']['experiment_id'] == design_data['selected_experiment_id'])
                # The selected target is generated only after both immutable
                # service artifact and exported design have been written.
                with Engine() as engine:
                    engine.set_anatomy(protocol['generating_anatomy'])
                    audio = engine.synthesize(chosen['pose'], {'JA': chosen['JA']},
                        f0_hz=chosen['f0_hz'], duration_s=.25)
                    frame = np.asarray(audio[4410:8506] * chosen['gain'], dtype=np.float32)
                total_calls += 1
                observed_at = now()
                (output / f'{target}.pcm.f32').write_bytes(frame.astype('<f4').tobytes())
                _, update = run('update_pcm', {'design_json': design.content.decode(),
                    'snapshot_json': snapshot.content.decode(), 'expected_design_digest': design.sha256,
                    'expected_snapshot_digest': snapshot.sha256, 'experiment_id': chosen['experiment_id'],
                    'observation_id': target, 'artifact_id': target+'-pcm', 'observed_at': observed_at,
                    'pcm': frame.tolist(), 'source_kind': 'engine-generated'}, f'update-{index}', model_id)
                write_json(output / f'update-{index}.json', update)
                snapshot = Artifact(canonical(update['updated_snapshot']).encode())
                if snapshot.sha256 != update['updated_snapshot_sha256']:
                    raise RuntimeError('Updated hypothesis digest mismatch')
                step.update(status=update['status'], after_count=len(snapshot.data['hypotheses']))
                if digest(design_path) != design.sha256:
                    raise RuntimeError('Prospective design changed during update')
                if update['status'] != 'conditional_support_updated':
                    outcome = update['status']
                    break
                if len(snapshot.data['hypotheses']) < 2:
                    outcome = 'one_conditional_candidate_remains'
                    break
            snapshot.write(output / 'final-hypotheses.json')
            final_support = snapshot.data['hypotheses']
    if total_calls > protocol['maximum_whole_replay_synthesis_calls']:
        raise RuntimeError('Whole replay exceeded predeclared native budget')
    summary = {'kind': 'synthetic_pcm_active_replay', 'status': outcome, 'steps': steps, 'jobs': jobs,
        'actual_synthesis_calls': total_calls,
        'maximum_synthesis_calls': protocol['maximum_whole_replay_synthesis_calls'],
        'claim': protocol['claim'], 'shortlist_policy': protocol['shortlist_policy'],
        'selected_support_is_posterior': False,
        'scoring_only_final_anatomy_errors_cm': [{'hypothesis_id': row['hypothesis_id'],
            'hard_palate_length_error_cm': row['anatomy']['hard_palate_length'] - protocol['generating_anatomy']['hard_palate_length']}
            for row in final_support]}
    write_json(output / 'summary.json', summary)
    write_json(output / 'manifest.json', {'files': {p.name: digest(p)
        for p in output.iterdir() if p.is_file()}})
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--rounds', type=int, default=2)
    args = parser.parse_args()
    print(json.dumps(replay(args.output, rounds=args.rounds), indent=2))
