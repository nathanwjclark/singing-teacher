from copy import deepcopy
import shutil

import numpy as np
import pytest
from singing_physics.engine import Engine
from singing_physics.pcm_inverse import extract_pcm, fit_pcm

NODE = shutil.which('node')


def make_trial(engine, name, pose, control, anatomy):
    engine.set_anatomy(anatomy)
    audio = engine.synthesize(pose, {'JA': control['JA']}, f0_hz=control['f0_hz'], duration_s=.25)
    start = 4410
    measurement = extract_pcm(audio[start:start+4096]*control['gain'], engine.sample_rate,
        measurement_id=name+'-measurement', observation_id=name, artifact_id=name+'-audio',
        start_ms=100., node_binary=NODE)['measurement']
    return {'id': name, 'pose': pose, 'measurement': measurement, 'sample_rate_hz': engine.sample_rate,
            'frame_start_sample': start, 'frame_size': 4096, 'duration_s': .25}


def fixture(engine):
    anatomy = {'hard_palate_length': 4.2, 'pharynx_length': 7.0}
    controls = {'a': {'JA': -2., 'f0_hz': 180., 'gain': .8},
                'i': {'JA': -4., 'f0_hz': 180., 'gain': 16.}}
    trials = [make_trial(engine, pose, pose, controls[pose], anatomy) for pose in controls]
    candidates = [
        {'candidate_id': 'candidate-0', 'anatomy': {}, 'trials': deepcopy(controls)},
        {'candidate_id': 'candidate-1', 'anatomy': anatomy, 'trials': deepcopy(controls)},
        {'candidate_id': 'candidate-2', 'anatomy': anatomy, 'trials': {pose: {**c, 'f0_hz': 220., 'gain': c['gain']*1.5} for pose, c in controls.items()}},
    ]
    return {'schema_version': '0.1.0', 'kind': 'canonical_pcm_observations', 'trials': trials}, candidates


def test_native_pcm_fit_exact_extractor_baseline_budget_and_heldout():
    with Engine() as engine:
        doc, candidates = fixture(engine)
        saved = engine.anatomy()
        result = fit_pcm(engine, doc, candidates=candidates, max_synthesis_calls=12, node_binary=NODE)
        assert engine.anatomy() == saved
        assert result['actual_synthesis_calls'] == 12
        assert result['joint']['actual_synthesis_calls'] == result['fixed_anatomy_baseline']['actual_synthesis_calls'] == 6
        best = result['joint']['best']
        assert best['candidate_id'] == 'candidate-1'
        assert best['weighted_mean_square_discrepancy'] < 1e-10
        assert result['fixed_anatomy_baseline']['best']['weighted_mean_square_discrepancy'] > 1e-4
        assert result['canonical_extractor']['extractorVersion'] == '1.1.0'
        assert result['identifiability'] == 'not_established'
        # Generate new vowel only after selection. Known control makes this conditional scoring.
        control = {'JA': -3., 'f0_hz': 190., 'gain': 32.}
        held = make_trial(engine, 'held', 'e', control, candidates[1]['anatomy'])
        predicted = make_trial(engine, 'prediction', 'e', control, best['anatomy'])
        h = {m['name']: m['value'] for m in held['measurement']['measurements']}
        p = {m['name']: m['value'] for m in predicted['measurement']['measurements']}
        assert sum(v is not None for v in h.values()) >= 3
        assert h == p
        assert held['measurement']['id'] not in result['evidence_ids']


def test_reject_bad_units_provenance_offsets_missing_and_budget():
    with Engine() as engine:
        doc, candidates = fixture(engine)
        for mutate in (
            lambda d: d['trials'][0].update(sample_rate_hz=48000),
            lambda d: d['trials'][0]['measurement'].update(method='tract-transfer'),
            lambda d: d['trials'][0]['measurement']['measurements'][0].update(unit='Hz'),
            lambda d: d['trials'][0]['measurement']['provenance'].update(sourceHashes=[]),
            lambda d: d['trials'][0]['measurement']['provenance'].update(sourceIds=['unbound']),
            lambda d: d['trials'][0]['measurement']['quality'].update(flags=['clipping']),
            lambda d: d['trials'][0].update(frame_start_sample=4400),
        ):
            bad = deepcopy(doc); mutate(bad)
            with pytest.raises(ValueError):
                fit_pcm(engine, bad, candidates=candidates, node_binary=NODE)
        with pytest.raises(ValueError, match='budget'):
            fit_pcm(engine, doc, candidates=candidates, max_synthesis_calls=11, node_binary=NODE)
        quiet = extract_pcm(np.zeros(4096), 44100, measurement_id='quiet', observation_id='q', artifact_id='q-a', start_ms=100., node_binary=NODE)['measurement']
        bad = deepcopy(doc); bad['trials'][0]['measurement'] = quiet
        with pytest.raises(ValueError, match='Insufficient'):
            fit_pcm(engine, bad, candidates=candidates, node_binary=NODE)


def test_nonfinite_pcm_and_invalid_source_fail():
    for audio in (np.full(4096, np.nan), np.ones((2, 4096))):
        with pytest.raises(ValueError):
            extract_pcm(audio, 44100, measurement_id='x', observation_id='x', artifact_id='x', node_binary=NODE)


def test_duplicate_source_interval_and_predicted_clipping_are_not_silent():
    with Engine() as engine:
        doc, candidates = fixture(engine)
        duplicate = deepcopy(doc)
        duplicate['trials'][1]['measurement']['provenance']['sourceHashes'] = duplicate['trials'][0]['measurement']['provenance']['sourceHashes']
        with pytest.raises(ValueError, match='Duplicate source audio interval'):
            fit_pcm(engine, duplicate, candidates=candidates, node_binary=NODE)
        clipped = deepcopy(candidates[1])
        clipped['trials']['a']['gain'] = 100.
        result = fit_pcm(engine, doc, candidates=[clipped], max_synthesis_calls=4, node_binary=NODE)
        assert result['actual_synthesis_calls'] == 4
        assert result['joint']['best'] is None
        assert result['joint']['candidates'][0]['missing_features'][0]['reason'] == 'predicted_pcm_clipping'
