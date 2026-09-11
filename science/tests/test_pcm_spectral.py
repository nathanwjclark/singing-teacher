from copy import deepcopy
from datetime import datetime,timezone
import hashlib

import numpy as np
import pytest
from singing_physics.engine import Engine
from singing_physics.pcm_spectral import extract_spectral,discrepancy,validate_observation,policy,SPECTRAL_OBJECTIVE
from singing_physics.pcm_inverse import extract_pcm,fit_pcm,FEATURES
from singing_physics.pcm_design import freeze_pcm_hypotheses,design_pcm,update_pcm
from singing_physics.prediction import Artifact,_encode


def spectral(frame,rate=44100,start=0):
    return extract_spectral(frame,rate,source_artifact_id='original',source_artifact_hashes=[hashlib.sha256(np.asarray(frame,dtype='<f4').tobytes()).hexdigest()],frame_start_sample=start)


def test_gain_normalized_shape_and_bounded_level_tilt_are_separate():
    rng=np.random.default_rng(11)
    frame=rng.normal(0,.005,4096)
    base=spectral(frame)
    gain=spectral(frame*4)
    result=discrepancy(base,gain)
    assert result['adjusted_shape_rms_db'] < 1e-7
    assert result['gain_adjustment_db'] == pytest.approx(20*np.log10(4))
    assert result['unexplained_level_db'] == 0
    beyond=spectral(frame*30)
    result=discrepancy(base,beyond)
    assert result['nuisance_bound_reached']
    assert result['unexplained_level_db'] > 5
    assert result['components']['unexplained_level'] > 0
    tilted=deepcopy(base)
    x=np.log2(np.asarray(base['policy']['config']['frequency_grid_hz']))
    x-=x.mean()
    for row in tilted['resolutions']:
        row['log_power_dbfs_per_hz']=(np.array(row['log_power_dbfs_per_hz'])+3*x).tolist()
    result=discrepancy(base,tilted)
    assert result['tilt_adjustment_db_per_octave']==pytest.approx(3)
    assert result['adjusted_shape_rms_db']<1e-10
    assert result['raw_shape_rms_db']>1


def test_invalid_pcm_policy_hash_window_units_and_nonfinite_reject():
    frame=.01*np.sin(2*np.pi*180*np.arange(4096)/44100)
    for bad in [frame.reshape(2,-1),np.full(4096,np.nan),np.ones(4096),np.zeros(4096)]:
        with pytest.raises(ValueError): spectral(bad)
    baseline=spectral(frame)
    altered=deepcopy(baseline);altered['policy']['config']['version']='unknown'
    with pytest.raises(ValueError,match='policy'): discrepancy(baseline,altered)
    altered=deepcopy(baseline);altered['resolutions'][0]['log_power_dbfs_per_hz'][0]=float('inf')
    with pytest.raises(ValueError,match='density'): discrepancy(baseline,altered)
    # The canonical measurement names a longer original segment; only frame_sha256
    # names the exact analysed frame.
    segment=hashlib.sha256(b'whole original segment').hexdigest()
    measurement=extract_pcm(frame,44100,measurement_id='m',observation_id='o',artifact_id='original')['measurement']
    measurement['provenance']['sourceHashes']=[segment]
    exact=extract_spectral(frame,44100,source_artifact_id='original',source_artifact_hashes=[segment])
    trial={'spectral_observation':exact,'frame_sha256':exact['frame_sha256'],'measurement':measurement,'sample_rate_hz':44100,'frame_size':4096,'frame_start_sample':0}
    validate_observation(trial)
    wrong=deepcopy(trial);wrong['spectral_observation']['frame_sha256']='b'*64
    with pytest.raises(ValueError,match='hash/offset'): validate_observation(wrong)
    wrong=deepcopy(trial);wrong['frame_start_sample']=4410
    with pytest.raises(ValueError,match='hash/offset'): validate_observation(wrong)
    # A whole-segment digest listed in sourceHashes is not an exact frame binding.
    wrong=deepcopy(trial);wrong['spectral_observation']['frame_sha256']=segment
    with pytest.raises(ValueError,match='hash/offset'): validate_observation(wrong)
    for field in ('frame_sha256','spectral_observation'):
        wrong=deepcopy(trial);wrong.pop(field)
        with pytest.raises(ValueError,match='together'): validate_observation(wrong)


def test_native_spectral_fit_freeze_and_heldout_update(tmp_path):
    now=lambda:datetime.now(timezone.utc).isoformat()
    truth={'hard_palate_length':4.2,'pharynx_length':7.}
    controls={'JA':-3.,'f0_hz':180.,'gain':.8}
    with Engine() as engine:
        engine.set_anatomy(truth)
        frame=engine.synthesize('a',{'JA':-3.},f0_hz=180.,duration_s=.25)[4410:8506]*.8
        canonical=extract_pcm(frame,44100,measurement_id='cal',observation_id='cal-o',artifact_id='original',start_ms=100.)
        observation=spectral(frame,start=4410)
        trial={'id':'cal','pose':'a','measurement':canonical['measurement'],'sample_rate_hz':44100,'frame_start_sample':4410,'frame_size':4096,'duration_s':.25,'spectral_observation':observation,'frame_sha256':observation['frame_sha256']}
        doc={'schema_version':'0.1.0','kind':'canonical_pcm_observations','trials':[trial]}
        candidates=[{'candidate_id':'truth','anatomy':truth,'trials':{'cal':controls}}, {'candidate_id':'other','anatomy':{'hard_palate_length':4.8,'pharynx_length':6.2},'trials':{'cal':controls}}]
        fit=fit_pcm(engine,doc,candidates=candidates,max_synthesis_calls=4,objective=SPECTRAL_OBJECTIVE)
        assert fit['actual_synthesis_calls']==4
        assert fit['joint']['best']['candidate_id']=='truth'
        assert fit['joint']['best']['weighted_mean_square_discrepancy']<1e-12
        provenance=engine.provenance
    snapshot=freeze_pcm_hypotheses(model_id='spectral-model',evidence_ids=['cal'],evidence_hashes=[canonical['pcmFloat32Sha256']],provenance=provenance,hypotheses=[{'hypothesis_id':c['candidate_id'],'anatomy':c['anatomy']} for c in candidates],frozen_at=now())
    scales={k:dict(unit=u,scale=s,assumption='Engineering scale') for k,(u,s) in FEATURES.items()}
    design=design_pcm(snapshot,expected_digest=snapshot.sha256,design_id='spectral-design',target_observation_id='held',generated_at=now(),experiments=[dict(experiment_id='held-vowel',pose='i',**{**controls,'gain':16.})],feature_scales=scales,objective=SPECTRAL_OBJECTIVE,minimum_separation=.001,retention_margin=.001,max_synthesis_calls=2)
    sealed=design.content
    # A different vowel is synthesized only after the predictions are sealed.
    with Engine() as engine:
        engine.set_anatomy(truth)
        held=engine.synthesize('i',{'JA':-3.},f0_hz=180.,duration_s=.25)[4410:8506]*16.
    kwargs=dict(expected_design_digest=design.sha256,expected_snapshot_digest=snapshot.sha256,experiment_id='held-vowel',observation_id='held',artifact_id='held-original',observed_at=now(),pcm=held)
    updated=update_pcm(design,snapshot,**kwargs).data
    assert updated['scorer_pin_status']=='verified'
    assert updated['scores'][0]['hypothesis_id']=='truth'
    assert updated['scores'][0]['standardized_rms']<1e-8
    assert updated['observation_receipt']['spectral_observation']['frame_sha256']==updated['observation_receipt']['frame_sha256']
    assert design.content==sealed
    assert design.data['objective_policy']==fit['objective_policy']==policy()
    pinned=design.data['scorer_implementation_pin']['implementation_sha256']
    assert {'science/src/singing_physics/pcm_spectral.py','science/src/singing_physics/pcm_design.py','science/scripts/extract_pcm.ts'} <= set(pinned)
    changed=deepcopy(design.data);changed['scorer_implementation_pin']['implementation_sha256']['science/src/singing_physics/pcm_spectral.py']='0'*64
    artifact=Artifact(_encode(changed))
    with pytest.raises(ValueError,match='scoring policy'):
        update_pcm(artifact,snapshot,**{**kwargs,'expected_design_digest':artifact.sha256})
    legacy=deepcopy(design.data);legacy.pop('scorer_implementation_pin')
    # A spectral forecast cannot silently lose its scorer pin.
    artifact=Artifact(_encode(legacy))
    with pytest.raises(ValueError,match='scoring policy'):
        update_pcm(artifact,snapshot,**{**kwargs,'expected_design_digest':artifact.sha256})


def test_pins_are_fixed_at_import_not_reread_from_disk(monkeypatch):
    from singing_physics import pcm_design, pcm_spectral
    before_design, before_spectral = deepcopy(pcm_design.SCORER_PIN), policy()
    # A long-running worker must keep pinning the code it executes, even if the
    # files on disk are replaced after import.
    monkeypatch.setattr(pcm_spectral.Path, 'read_bytes', lambda self: b'replaced on disk')
    assert pcm_design.SCORER_PIN == before_design and policy() == before_spectral
    for path in pcm_design._PINNED_SOURCES:
        assert path.is_file()


def test_legacy_coarse_design_without_pin_still_updates_as_unverified():
    now=lambda:datetime.now(timezone.utc).isoformat()
    anatomy={'hard_palate_length':4.2,'pharynx_length':7.}
    with Engine() as engine:
        provenance=engine.provenance
        engine.set_anatomy(anatomy)
        frame=engine.synthesize('a',{'JA':-3.},f0_hz=180.,duration_s=.25)[4410:8506]*.8
    snapshot=freeze_pcm_hypotheses(model_id='legacy',evidence_ids=['cal'],evidence_hashes=['a'*64],provenance=provenance,
        hypotheses=[{'hypothesis_id':'one','anatomy':anatomy},{'hypothesis_id':'two','anatomy':{'hard_palate_length':4.8,'pharynx_length':6.2}}],frozen_at=now())
    scales={k:dict(unit=u,scale=s,assumption='Engineering scale') for k,(u,s) in FEATURES.items()}
    design=design_pcm(snapshot,expected_digest=snapshot.sha256,design_id='legacy-design',target_observation_id='held',generated_at=now(),
        experiments=[dict(experiment_id='a-vowel',pose='a',JA=-3.,f0_hz=180.,gain=.8)],feature_scales=scales,max_synthesis_calls=2)
    # Receipts sealed before objectives and pins existed carry neither field.
    legacy=deepcopy(design.data)
    for key in ('objective','objective_policy','scorer_implementation_pin'): legacy.pop(key)
    artifact=Artifact(_encode(legacy))
    result=update_pcm(artifact,snapshot,expected_design_digest=artifact.sha256,expected_snapshot_digest=snapshot.sha256,
        experiment_id='a-vowel',observation_id='held',artifact_id='held-audio',observed_at=now(),pcm=frame).data
    assert result['scorer_pin_status']=='legacy_version_unverified'
    assert result['objective']=='canonical-coarse-v1'
    assert update_pcm(design,snapshot,expected_design_digest=design.sha256,expected_snapshot_digest=snapshot.sha256,
        experiment_id='a-vowel',observation_id='held',artifact_id='held-audio',observed_at=now(),pcm=frame).data['scorer_pin_status']=='verified'


def test_app_spectral_derivation_reads_hash_bound_original_and_preserves_import(tmp_path):
    from science.scripts.live_capture_jobs import spectral_trials
    samples=(.01*np.sin(2*np.pi*180*np.arange(8192)/44100)).astype('<f4')
    raw=samples.tobytes();segment=hashlib.sha256(raw).hexdigest()
    frame=samples[2048:6144]
    measurement=extract_pcm(frame,44100,measurement_id='measurement',observation_id='observation',artifact_id='original',start_ms=2048/44100*1000)['measurement']
    measurement['provenance']['sourceHashes']=[segment]  # The importer names the whole segment artifact.
    trial={'id':'trial','pose':'a','measurement':measurement,'sample_rate_hz':44100,'frame_size':4096,'frame_start_sample':2048,'duration_s':8192/44100}
    original=deepcopy(trial)
    data={'segments':[{'derived_artifact':{'id':'original','uri':'segment-0.pcm.f32','sha256':segment,'byteLength':len(raw)},'measurement_ids':['measurement'],'sample_count':8192,'sample_rate_hz':44100}]}
    (tmp_path/'import').mkdir();path=tmp_path/'import'/'segment-0.pcm.f32';path.write_bytes(raw)
    enriched=spectral_trials(data,tmp_path,[trial])[0]
    exact=hashlib.sha256(frame.tobytes()).hexdigest()
    assert exact!=segment
    assert enriched['frame_sha256']==enriched['spectral_observation']['frame_sha256']==exact
    assert enriched['measurement']==measurement and enriched['measurement']['provenance']['sourceHashes']==[segment]
    assert trial==original
    # A measurement from a different window of the same verified segment is rejected.
    shifted=deepcopy(trial);shifted['frame_start_sample']=0
    with pytest.raises(ValueError,match='differs from the verified original frame'):
        spectral_trials(data,tmp_path,[shifted])
    path.write_bytes(bytes([raw[0]^1])+raw[1:])
    with pytest.raises(ValueError,match='digest changed'):
        spectral_trials(data,tmp_path,[trial])
