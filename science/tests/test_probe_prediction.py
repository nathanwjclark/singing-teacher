from copy import deepcopy
from datetime import datetime, timezone
import hashlib

import numpy as np
import pytest

from singing_physics.acoustic_probe import predict_external_probe
from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.prediction import Artifact, _encode
from singing_physics.probe_prediction import predict_probe


def now():
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def snapshot():
    with Engine() as engine:
        provenance = engine.provenance
    return freeze_pcm_hypotheses(model_id='probe-model', evidence_ids=['fit-source'], evidence_hashes=['a'*64],
        provenance=provenance, frozen_at=now(), hypotheses=[
            {'hypothesis_id': 'first', 'anatomy': {'hard_palate_length': 4.3}},
            {'hypothesis_id': 'second', 'anatomy': {'hard_palate_length': 4.9}}])


def inputs(snapshot):
    frequencies = [100., 200., 400., 800., 1600., 10000.]
    placement = {'placement_id': 'placement', 'coordinate_frame': 'synthetic-metres',
        'source_m': [.15, 0., 0.], 'microphone_m': [.12, .05, 0.], 'mouth_m': [0., 0., 0.]}
    calibration = {'calibration_id': 'calibration', 'kind': 'synthetic-fixture', 'route_id': 'route',
        'placement_id': 'placement', 'frequency_hz': frequencies,
        'source_volume_velocity_real': [1e-5]*6, 'source_volume_velocity_imag': [0.]*6,
        'microphone_gain_real': [.01]*6, 'microphone_gain_imag': [0.]*6,
        'source_hashes': ['b'*64], 'delay_s': 0.}
    return dict(expected_digest=snapshot.sha256, prediction_id='probe-forecast', target_evidence_id='target-capture',
        generated_at=now(), pose='a', frequency_hz=frequencies, placement=placement, calibration=calibration,
        calibration_evidence_ids=['calibration-reference'], calibration_frozen_at=snapshot.data['frozen_at'])


def test_actual_external_drive_predictions_match_shared_operator_and_preserve_artifact(snapshot, tmp_path):
    arguments = inputs(snapshot); original = deepcopy(arguments)
    artifact = predict_probe(snapshot, **arguments)
    result = artifact.data
    assert arguments == original
    assert result['quantity'] == 'recorded_pcm_per_digital_drive'
    assert result['actual_operator_calls'] == 2
    assert result['availability'] == 'available'
    assert result['common_valid_mask'][0] and not result['common_valid_mask'][-1]
    assert result['phase_comparison_supported'] is False
    assert result['calibration_sha256'] == hashlib.sha256(_encode(arguments['calibration'])).hexdigest()
    with Engine() as engine:
        for frozen, predicted in zip(snapshot.data['hypotheses'], result['predictions']):
            engine.set_anatomy(frozen['anatomy'])
            direct = predict_external_probe(engine, **{k: arguments[k] for k in ('pose', 'frequency_hz', 'placement', 'calibration')})
            assert predicted['operator_prediction'] == direct
            for i, valid in enumerate(direct['valid_mask']):
                if valid:
                    assert predicted['response_magnitude'][i] == pytest.approx(np.hypot(direct['response_real'][i], direct['response_imag'][i]))
                else:
                    assert predicted['response_magnitude'][i] is None
    assert result['predictions'][0]['operator_prediction']['geometry_sha256'] != result['predictions'][1]['operator_prediction']['geometry_sha256']
    repeat = predict_probe(snapshot, **arguments)
    assert repeat.data['predictions'] == result['predictions']
    artifact.write(tmp_path/'forecast.json')
    with pytest.raises(FileExistsError):
        repeat.write(tmp_path/'forecast.json')
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


@pytest.mark.parametrize('change', [
    {'expected_digest': 'stale'}, {'max_operator_calls': 1}, {'max_operator_calls': True},
    {'channel': 'nasal_external'}, {'target_evidence_id': 'fit-source'},
    {'target_evidence_id': 'calibration-reference'}, {'target_evidence_id': 'calibration'},
    {'calibration_evidence_ids': []}, {'calibration_evidence_ids': ['same', 'same']},
    {'generated_at': '2025-01-01T00:00:00Z'},
    {'calibration_frozen_at': '2099-01-01T00:00:00Z'},
    {'comparison': 'complex'},
    {'comparison': 'complex', 'timing': {'phase_verified': True, 'uncertainty_s': .1}},
    {'articulation': {'VO': .5}}, {'termination': 'nasal-junction'},
])
def test_unsupported_lineage_timing_and_budget_rejected_cleanly(snapshot, change):
    with pytest.raises(ValueError):
        predict_probe(snapshot, **(inputs(snapshot)|change))
    with Engine() as engine:
        assert engine.anatomy() == engine.base_anatomy


def test_shared_calibration_validation_and_native_provenance(snapshot):
    for change in ({'source_hashes': []}, {'placement_id': 'changed'}, {'frequency_hz': [100., 201., 400., 800., 1600., 10000.]},
                   {'microphone_gain_real': [float('nan')]*6}, {'kind': 'unmeasured-phone'}):
        arguments = inputs(snapshot)
        arguments['calibration'].update(change)
        with pytest.raises(ValueError):
            predict_probe(snapshot, **arguments)
    data = snapshot.data; data['provenance']['geometry_basis'] = 'different-basis'
    changed = Artifact(_encode(data))
    with pytest.raises(ValueError, match='provenance'):
        predict_probe(changed, **inputs(changed))


def test_supported_complex_timing_and_no_valid_band_are_explicit(snapshot):
    arguments = inputs(snapshot)
    complex_result = predict_probe(snapshot, **arguments, comparison='complex',
        timing={'phase_verified': True, 'uncertainty_s': 1e-7}).data
    assert complex_result['phase_comparison_supported'] is True
    arguments['frequency_hz'] = [10000.]
    for key in ('frequency_hz', 'source_volume_velocity_real', 'source_volume_velocity_imag', 'microphone_gain_real', 'microphone_gain_imag'):
        arguments['calibration'][key] = arguments['calibration'][key][-1:]
    unavailable = predict_probe(snapshot, **arguments).data
    assert unavailable['availability'] == 'unavailable'
    assert unavailable['missing_reason'] == 'no_common_supported_frequency_band'
    assert unavailable['common_valid_mask'] == [False]
