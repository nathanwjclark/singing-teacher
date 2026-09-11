from copy import deepcopy
import hashlib
import json
import shutil

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.acoustic_probe import predict_external_probe
from singing_physics.pcm_inverse import extract_pcm
from singing_physics.probe_inverse import fit_probe_pcm

NODE = shutil.which('node')


def probe_fixture(engine, truth=4.2):
    """Native geometry, canonical singing PCM, and analytic driven response fixture."""
    saved = engine.anatomy()
    control = {'JA': -2., 'f0_hz': 180., 'gain': .8}
    f = [100., 200., 400.]
    placement = dict(placement_id='placement', coordinate_frame='fixture-meters', source_m=[.15,0,0],
                     microphone_m=[.12,.05,0], mouth_m=[0,0,0])
    calibration = dict(calibration_id='calibration', kind='synthetic-fixture', route_id='route',
        placement_id='placement', frequency_hz=f, source_volume_velocity_real=[1e-5]*3,
        source_volume_velocity_imag=[0.]*3, microphone_gain_real=[.01]*3,
        microphone_gain_imag=[0.]*3, source_hashes=['a'*64], delay_s=0.)
    try:
        engine.set_anatomy({'hard_palate_length': truth})
        pcm = engine.synthesize('a', {'JA': -2.}, f0_hz=180., duration_s=.25)
        response = predict_external_probe(engine, pose='a', frequency_hz=f, articulation={'JA': -2.},
                                          placement=placement, calibration=calibration)
    finally:
        engine.set_anatomy(saved)
    measurement = extract_pcm(pcm[4410:8506]*.8,44100,measurement_id='sing-measurement',
        observation_id='sing',artifact_id='sing-pcm',start_ms=100.,node_binary=NODE)['measurement']
    pcm_doc = dict(schema_version='0.1.0',kind='canonical_pcm_observations', trials=[dict(id='sing',pose='a',
        measurement=measurement,sample_rate_hz=44100,frame_start_sample=4410,frame_size=4096,duration_s=.25)])
    t = np.arange(4096)/8192
    waves = np.exp(2j*np.pi*np.array(f)[:,None]*t)
    h = np.array(response['response_real'])+1j*np.array(response['response_imag'])
    drive = .01*waves.real.sum(axis=0); received = .01*(h[:,None]*waves).real.sum(axis=0)
    sha = lambda x: hashlib.sha256(x.astype('<f4').tobytes()).hexdigest()
    nuisance = dict(JA=-2., gain=1., direct_gain=1., coupling_gain=1., delay_s=0.)
    record = dict(id='probe',split='calibration',channel='oral_external',quantity='recorded_pcm_per_digital_drive',
        pose_state='held-quiet',pose='a',quality_flags=[],frequency_hz=f,response_real=response['response_real'],
        response_imag=response['response_imag'],valid_mask=response['valid_mask'],comparison='complex',
        timing=dict(phase_verified=True,uncertainty_s=1e-7,evidence_id='timing',source_hashes=['b'*64]),
        bands=[dict(low_hz=50.,high_hz=500.,sigma=1e-6,weight=1.)],
        source=dict(kind='synthetic-fixture',drive_artifact_id='drive',received_artifact_id='received',
                    drive_sha256=sha(drive),received_sha256=sha(received)),placement=placement,calibration=calibration,
        nuisance_prior=dict(prior_id='prior',source_hashes=['a'*64],bounds={k:[v,v] for k,v in nuisance.items() if k!='JA'}),
        conditions=dict(termination='rigid',termination_resistance_pa_s_m3=None,attenuation_np_per_m=.5))
    probes = dict(schema_version='0.1.0',kind='external_probe_observations',trials=[record])
    candidates = [dict(candidate_id=str(length),anatomy={'hard_palate_length':length},trials={'sing':control},
                       probe_trials={'probe':nuisance}) for length in [4.2,4.8]]
    return pcm_doc, probes, candidates


def test_native_joint_term_budget_restore_and_out_of_grid():
    with Engine() as engine:
        for truth in (4.2,4.43):
            pcm, probes, candidates = probe_fixture(engine,truth)
            before = deepcopy((pcm,probes,candidates)); saved=engine.anatomy()
            result = fit_probe_pcm(engine,pcm,probes,candidates=candidates,max_native_calls=12,node_binary=NODE)
            assert before == (pcm,probes,candidates) and engine.anatomy()==saved
            assert result['actual_operator_calls']==12 and result['equal_actual_comparison_calls']
            rows=result['joint']['candidates']
            assert all(r['probe_discrepancy'] is not None for r in rows)
            assert rows[1]['probe_discrepancy']>0
            for r in rows:
                assert r['joint_discrepancy']==pytest.approx(r['pcm_discrepancy']+r['probe_discrepancy'])
            if truth==4.2:
                assert result['joint']['best']['candidate_id']=='4.2'
                assert rows[0]['joint_discrepancy']<1e-10
            else:
                assert all(r['joint_discrepancy']>0 for r in rows)
            assert result['status']=='joint_probe_evidence_used'
            assert result['identifiability']=='not_established'
            json.dumps(result,allow_nan=False)


def test_masks_timing_lineage_and_heldout_exclusion():
    with Engine() as engine:
        pcm, probes, candidates=probe_fixture(engine)
        base=probes['trials'][0]
        for changes,reason in [({'channel':'nasal'},'unsupported_channel'),
                ({'source':{**base['source'],'kind':'human-recording'}},'requires_measured'),
                ({'source':{**base['source'],'kind':'human-recording'},'calibration':{**base['calibration'],'kind':'measured'}},'declared_not_measured'),
                ({'source':{**base['source'],'native_capture_fields':['route']}},'native_capture_fields'),
                ({'nuisance_prior':{**base['nuisance_prior'],'source_hashes':pcm['trials'][0]['measurement']['provenance']['sourceHashes']}},'conditioning_source'),
                ({'split':'held_out','frequency_hz':'not read'},'non_calibration'),
                ({'timing':{'phase_verified':False,'uncertainty_s':None}},'finite'),
                ({'valid_mask':[False]*3},'no_valid'),
                ({'source':{**base['source'],'received_sha256':pcm['trials'][0]['measurement']['provenance']['sourceHashes'][0]}},'overlaps')]:
            bad=deepcopy(probes); bad['trials'][0].update(changes)
            result=fit_probe_pcm(engine,pcm,bad,candidates=candidates,max_native_calls=4,node_binary=NODE)
            assert not result['probe_records'][0]['included_in_fit']
            assert reason.lower() in result['probe_records'][0]['reason'].lower()
        reference=deepcopy(probes); reference['trials'][0]['source']['kind']='physical-reference'; reference['trials'][0]['calibration']['kind']='measured'
        assert fit_probe_pcm(engine,pcm,reference,candidates=candidates,max_native_calls=12,node_binary=NODE)['probe_records'][0]['included_in_fit']
        masked=deepcopy(probes); r=masked['trials'][0]
        r.update(comparison='magnitude',timing={'phase_verified':False,'uncertainty_s':None})
        r['valid_mask'][1]=False; r['response_real'][1]=None; r['response_imag'][1]=None
        result=fit_probe_pcm(engine,pcm,masked,candidates=candidates,max_native_calls=12,node_binary=NODE)
        assert result['joint']['best']['probe_predictions'][0]['bands'][0]['bins_aggregated']==2
        assert not result['probe_records'][0]['phase_used']
        duplicate=deepcopy(base); duplicate['id']='alias'; probes['trials'].append(duplicate)
        result=fit_probe_pcm(engine,pcm,probes,candidates=candidates,max_native_calls=12,node_binary=NODE)
        assert not result['probe_records'][1]['included_in_fit']


def test_preflight_and_failed_native_prediction(monkeypatch):
    with Engine() as engine:
        pcm,probes,candidates=probe_fixture(engine); saved=engine.anatomy()
        for budget in (11,True):
            with pytest.raises(ValueError):
                fit_probe_pcm(engine,pcm,probes,candidates=candidates,max_native_calls=budget,node_binary=NODE)
        invalid=deepcopy(candidates); invalid[0]['probe_trials']['probe']['gain']=1.1
        with pytest.raises(ValueError,match='prior'):
            fit_probe_pcm(engine,pcm,probes,candidates=invalid,node_binary=NODE)
        def failed(*args,**kwargs):
            raise RuntimeError('injected native geometry failure')
        monkeypatch.setattr(engine,'geometry',failed)
        result=fit_probe_pcm(engine,pcm,probes,candidates=candidates,max_native_calls=12,node_binary=NODE)
        assert result['joint']['best'] is None
        assert result['actual_operator_calls']==12 and result['equal_actual_comparison_calls']
        assert result['status']=='no_complete_joint_prediction'
        assert not result['probe_records'][0]['included_in_fit']
        assert engine.anatomy()==saved


def test_excluded_source_alias_and_direct_only_confounding():
    with Engine() as engine:
        pcm,probes,candidates=probe_fixture(engine)
        held=deepcopy(probes['trials'][0]); held.update(id='held',split='held_out',frequency_hz='unread')
        probes['trials'].append(held)
        result=fit_probe_pcm(engine,pcm,probes,candidates=candidates,max_native_calls=4,node_binary=NODE)
        assert all(not r['included_in_fit'] for r in result['probe_records'])
        assert 'excluded' in result['probe_records'][0]['reason']
        probes['trials'].pop()
        record=probes['trials'][0]
        response=predict_external_probe(engine,pose='a',frequency_hz=record['frequency_hz'],
            placement=record['placement'],calibration=record['calibration'],articulation={'JA':-2.})
        record['response_real']=response['direct_response_real']
        record['response_imag']=response['direct_response_imag']
        # A separate analytic direct-only fixture has no anatomy-sensitive response.
        encoded=json.dumps([record['response_real'],record['response_imag']]).encode()
        record['source']['received_sha256']=hashlib.sha256(encoded).hexdigest()
        record['nuisance_prior']['bounds']['coupling_gain']=[0.,0.]
        for c in candidates:
            c['probe_trials']['probe']['coupling_gain']=0.
        result=fit_probe_pcm(engine,pcm,probes,candidates=candidates,max_native_calls=12,node_binary=NODE)
        assert [r['probe_discrepancy'] for r in result['joint']['candidates']]==[0.,0.]
        assert result['identifiability']=='not_established'


def test_budget_preflight_uses_shared_pcm_synthesis_for_gain_only_candidates():
    with Engine() as engine:
        pcm,probes,candidates=probe_fixture(engine)
        base=candidates[0]
        variants=[{**deepcopy(base),'candidate_id':f'gain-{gain:g}','trials':{'sing':{**base['trials']['sing'],'gain':gain}}} for gain in (.8,1.6)]
        # One shared PCM waveform per model (2 calls) plus geometry and external-forward calls
        # for 2 candidates x 2 models x 1 probe (8): 10. The unshared preflight required 12.
        result=fit_probe_pcm(engine,pcm,probes,candidates=variants,max_native_calls=10,node_binary=NODE)
        assert result['actual_operator_calls']==10 and result['equal_actual_comparison_calls']
        assert all(result['operator_counts'][model]['pcm_synthesis_calls']==1 for model in ('joint','fixed_anatomy_baseline'))
        with pytest.raises(ValueError,match='exceed total budget'):
            fit_probe_pcm(engine,pcm,probes,candidates=variants,max_native_calls=9,node_binary=NODE)
