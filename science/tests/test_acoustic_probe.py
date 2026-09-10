import copy
import json

import numpy as np
import pytest

from singing_physics.acoustic_probe import C, RHO, predict_external_probe, tube_impedance
from singing_physics.engine import Engine


def setup_probe():
    f = [100., 200., 400., 800., 1600., 10000.]
    placement = dict(placement_id="fixture-placement", coordinate_frame="fixture-meters",
                     source_m=[.15, 0, 0], microphone_m=[.12, .05, 0], mouth_m=[0, 0, 0])
    calibration = dict(calibration_id="fixture-calibration", kind="synthetic-fixture", route_id="fixture-route",
                       placement_id=placement['placement_id'], frequency_hz=f,
                       source_volume_velocity_real=[1e-5]*len(f), source_volume_velocity_imag=[0.]*len(f),
                       microphone_gain_real=[.01]*len(f), microphone_gain_imag=[0.]*len(f),
                       source_hashes=['a'*64], delay_s=0.)
    return dict(pose='a', frequency_hz=f, placement=placement, calibration=calibration)


def test_uniform_analytic_cascade_and_matched_load():
    f = np.array([100., 300., 600.])
    area, length = .0003, .17
    zc = RHO*C/area
    for termination, expected in [('rigid', -1j*zc/np.tan(2*np.pi*f*length/C)),
                                   ('pressure-release', 1j*zc*np.tan(2*np.pi*f*length/C))]:
        actual = tube_impedance(f, [length], [area], termination=termination, attenuation_np_per_m=0)
        np.testing.assert_allclose(actual, expected, rtol=1e-12)
        np.testing.assert_allclose(tube_impedance(f, [length/10]*10, [area]*10, termination=termination,
                                                attenuation_np_per_m=0), expected, rtol=1e-12)
    np.testing.assert_allclose(tube_impedance(f, [length], [area], termination='resistive',
                                            termination_resistance_pa_s_m3=zc), zc, rtol=1e-12)


def test_passivity_nonuniform_and_validation():
    f = np.linspace(20, 4000, 200)
    z = tube_impedance(f, [.03, .1, .04], [.0004, .0001, .0002])
    assert np.min(z.real) >= 0
    z0 = RHO*C/.0004
    assert np.max(abs((z-z0)/(z+z0))) <= 1+1e-12
    for kwargs in [dict(area_m2=[0]), dict(attenuation_np_per_m=-1), dict(termination='invented'),
                   dict(termination_resistance_pa_s_m3=1)]:
        args = dict(frequency_hz=[100], length_m=[.1], area_m2=[.001]) | kwargs
        with pytest.raises(ValueError):
            tube_impedance(**args)


def test_actual_native_external_components_state_and_masks():
    args = setup_probe()
    with Engine() as e:
        e.set_anatomy({'hard_palate_length':4.4})
        before = e.anatomy()
        result = predict_external_probe(e, **args)
        assert e.anatomy() == before
        assert result == predict_external_probe(e, **args)
        assert result['valid_mask'][0] and not result['valid_mask'][-1]
        assert result['response_real'][-1] is None
        for part in ('real', 'imag'):
            valid = np.array(result['valid_mask'])
            for i in np.where(valid)[0]:
                assert result['response_'+part][i] == pytest.approx(result['direct_response_'+part][i]+result['mouth_response_'+part][i])
        changed = copy.deepcopy(args)
        changed['calibration']['source_volume_velocity_real'] = [2e-5]*len(args['frequency_hz'])
        doubled = predict_external_probe(e, **changed)
        np.testing.assert_allclose(doubled['response_real'][:3], 2*np.array(result['response_real'][:3]))
        swapped = copy.deepcopy(args)
        swapped['placement']['source_m'], swapped['placement']['microphone_m'] = args['placement']['microphone_m'], args['placement']['source_m']
        reciprocal = predict_external_probe(e, **swapped)
        np.testing.assert_allclose(reciprocal['response_real'][:3], result['response_real'][:3])
        e.set_anatomy({'hard_palate_length':5.1})
        other = predict_external_probe(e, **args)
        assert other['geometry_sha256'] != result['geometry_sha256']
        assert other['mouth_response_real'][:3] != result['mouth_response_real'][:3]
        json.dumps(result, allow_nan=False)


def test_external_rejects_missing_calibration_grid_nearfield_and_open_velum():
    with Engine() as e:
        for mutate, message in [
            (lambda a: a['calibration'].update(source_hashes=[]), 'source_hashes'),
            (lambda a: a['calibration'].update(frequency_hz=[101.,200.,400.,800.,1600.,10000.]), 'grid'),
            (lambda a: a['calibration'].update(placement_id='other'), 'placement'),
            (lambda a: a['placement'].update(source_m=[.006,0,0]), 'radii'),
        ]:
            args = setup_probe(); mutate(args)
            with pytest.raises(ValueError, match=message):
                predict_external_probe(e, **args)
        args = setup_probe(); args['articulation'] = {'VO': .5}
        with pytest.raises(ValueError, match='velum'):
            predict_external_probe(e, **args)
