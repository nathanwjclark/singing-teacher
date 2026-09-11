"""Real native two-mass selection, restoration, provenance and source-family plumbing.

The off-grid, equal-budget family comparison is the frozen protocol in
evaluation/wave3/source; nothing here is evidence that either family predicts better.
"""
from copy import deepcopy
import hashlib
from pathlib import Path
import sys

import numpy as np
import pytest

from singing_physics.engine import BUILD, Engine, select_speaker_source, speaker_source_selection
import singing_physics.phonation as source

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from app_source import source_candidates


SHAPE={'source_model':'two_mass','XB':.005,'XT':.005,'EAA':0.,'DF':1.}
SPEAKER=BUILD/'source/resources/JD3.speaker'


def frame(engine,pose,controls,identity):
    audio,state=source.synthesize_phonation(engine,pose=pose,**{k:v for k,v in controls.items() if k!='gain'})
    pcm,_=source._frame(audio,48000);pcm*=controls['gain']
    sha=hashlib.sha256(pcm.astype('<f4').tobytes()).hexdigest()
    return pcm,source._metadata(identity,48000,sha,'engine-generated'),state


def trial(engine,identity,pose,control):
    pcm,meta,_=frame(engine,pose,control,identity)
    return {'id':identity,'pose':pose,'pcm':pcm.tolist(),'sample_rate_hz':48000,'metadata':meta}


def test_selected_speaker_changes_only_selection_digits():
    raw=SPEAKER.read_bytes()
    assert [name for name,selected in speaker_source_selection(raw) if selected]==['Geometric glottis']
    selected=select_speaker_source(raw,'Two-mass model')
    changed=[i for i,(a,b) in enumerate(zip(raw,selected)) if a!=b]
    assert len(selected)==len(raw) and len(changed)==2 and all(raw[i:i+1] in b'01' for i in changed)
    assert [name for name,on in speaker_source_selection(selected) if on]==['Two-mass model']
    with pytest.raises(ValueError):select_speaker_source(raw,'invented family')


def test_restoration_reloads_the_certified_file_and_restores_exact_state(monkeypatch):
    with Engine() as engine:
        engine.set_anatomy({'hard_palate_length':4.2})
        anatomy,provenance,info=engine.anatomy(),deepcopy(engine.provenance),deepcopy(engine.source_info)
        base={pose:engine.synthesize(pose,duration_s=.1) for pose in 'aeiou'}
        geometric,_=source.synthesize_phonation(engine,pose='o',JA=-3,F0=190,PR=8000,PS=.1)
        loaded=[];native=engine.lib.vtlInitialize
        def initialize(path):loaded.append(path.decode());return native(path)
        monkeypatch.setattr(engine.lib,'vtlInitialize',initialize)
        for _ in range(2):
            with pytest.raises(RuntimeError,match='test interruption'):
                with engine.source_model('Two-mass model'):
                    assert engine.source_model_family=='Two-mass model' and engine.glottis_count==6
                    assert next(r for r in engine.source_info if r['name']=='DF')['unit']==''
                    assert engine.provenance['selected_source_speaker_sha256']==hashlib.sha256(select_speaker_source(SPEAKER.read_bytes(),'Two-mass model')).hexdigest()
                    assert engine.provenance['speaker_sha256']==provenance['speaker_sha256']
                    engine.set_anatomy({'hard_palate_length':4.6})
                    raise RuntimeError('test interruption')
            assert engine.source_model_family=='Geometric glottis' and engine.source_info==info
            assert engine.anatomy()==anatomy and engine.provenance==provenance
            assert 'selected_source_speaker_sha256' not in engine.provenance
        assert len(loaded)==4 and loaded[1]==loaded[3]==str(SPEAKER) and SPEAKER.name not in loaded[0]
        for pose,audio in base.items():np.testing.assert_array_equal(engine.synthesize(pose,duration_s=.1),audio)
        np.testing.assert_array_equal(source.synthesize_phonation(engine,pose='o',JA=-3,F0=190,PR=8000,PS=.1)[0],geometric)
        with pytest.raises(ValueError):
            with engine.source_model('invented family'):pass
        assert engine.anatomy()==anatomy


def test_nested_family_contexts_restore_each_level_and_failed_restore_closes_the_engine(monkeypatch):
    with Engine() as engine:
        provenance=deepcopy(engine.provenance);base=engine.synthesize('u',duration_s=.1)
        with engine.source_model('Two-mass model'):
            outer=deepcopy(engine.provenance)
            with engine.source_model('Two-mass model'):assert engine.provenance==outer  # same family: no reload
            with engine.source_model('Geometric glottis'):
                assert engine.source_model_family=='Geometric glottis' and 'selected_source_family' not in engine.provenance
                np.testing.assert_array_equal(engine.synthesize('u',duration_s=.1),base)
            assert engine.source_model_family=='Two-mass model' and engine.provenance==outer
        assert engine.provenance==provenance
        reload=engine._load_source_family
        def failing(family,anatomy):
            if family=='Geometric glottis':raise RuntimeError('injected restore failure')
            return reload(family,anatomy)
        monkeypatch.setattr(engine,'_load_source_family',failing)
        with pytest.raises(RuntimeError,match='injected restore failure'):
            with engine.source_model('Two-mass model'):pass
        assert engine._closed
        with pytest.raises(RuntimeError,match='closed'):engine.anatomy()
    with Engine() as reopened:assert reopened.source_model_family=='Geometric glottis'


def test_capability_is_family_aware_and_requires_certified_geometric_selection():
    with Engine() as engine:
        capability=source.source_capability(engine)
        assert capability['status']=='available' and capability['certified_source_family']==['Geometric glottis']
        families=capability['source_families']
        assert families['geometric']['source_hypothesis_parameters']==['PS'] and families['geometric']['fixed_native_controls']=={'FL':0.,'DP':0.,'AS':-40.}
        assert families['two_mass']['source_hypothesis_parameters']==['XB','XT','EAA','DF'] and families['two_mass']['fixed_native_controls']=={}
        assert {row['name'] for row in families['two_mass']['native_controls']}>={'XB','XT','EAA','DF'} and 'PS' not in {row['name'] for row in families['two_mass']['native_controls']}
        assert families['two_mass']['native_provenance']['selected_source_family']=='Two-mass model'
        assert 'selected_source_family' not in families['geometric']['native_provenance']
        assert {'source_model_family','native_controls','supported_control_bounds','fixed_controls'}.isdisjoint(capability)
        assert source.source_capability(engine)==capability
        engine.certified_source_family='Two-mass model'
        try:
            refused=source.source_capability(engine)
            assert refused['status']=='unsupported' and 'Geometric glottis' in refused['reason'] and refused['source_families']=={}
            assert source.fit_phonation(engine,None,candidates=None,enabled=True)['status']=='unsupported'
        finally:engine.certified_source_family='Geometric glottis'


def test_family_controls_are_required_and_validated():
    with Engine() as engine:
        control={'JA':-3,'F0':180,'PR':8000,'gain':1.,**SHAPE}
        _,_,state=frame(engine,'a',control,'mechanical')
        assert state['source_model']=='two_mass' and 'PS' not in state['source_controls']
        saved=engine.anatomy()
        with pytest.raises(ValueError,match='PS'):source.synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000)
        with pytest.raises(ValueError,match='XB'):source.synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,source_model='two_mass',XB=.01,XT=.01,EAA=0.)
        for bad in ({'XB':.1},{'DF':True},{'PS':.2},{'source_model':'unknown'}):
            with pytest.raises(ValueError):frame(engine,'a',{**control,**bad},'bad')
        assert engine.anatomy()==saved and engine.source_model_family=='Geometric glottis'


def test_rows_record_requested_and_simulated_f0_and_a_pitch_excluded_score(monkeypatch):
    with Engine() as engine:
        observed={'JA':-3.,'F0':180.,'PR':8000.,'gain':2.,**SHAPE}
        document={'schema_version':'phonation-fit-1','trials':[trial(engine,'cal','a',observed)]}
        candidates=[{'candidate_id':name,'anatomy':{},'trials':{'cal':{'JA':-3.,'F0':180.,'PR':8000.,'gain':2.,**shape}}}
            for name,shape in (('geometric',{'PS':0.}),('mechanical',{**SHAPE,'XB':.015,'XT':.015}))]
        loads=[];reload=engine._load_source_family
        monkeypatch.setattr(engine,'_load_source_family',lambda *a:(loads.append(a[0]),reload(*a))[1])
        fitted=source.fit_phonation(engine,document,candidates=candidates,max_synthesis_calls=6,enabled=True)
        assert fitted['status']=='available' and len(loads)==4  # capability visit plus one two-mass group
        observed_pitch=fitted['observations'][0]['descriptors']['pitchHz']['value']
        for family in ('joint','fixed_source','fixed_anatomy'):
            assert [row['candidate_id'] for row in fitted[family]['candidates']]==['geometric','mechanical']
            for row in fitted[family]['candidates']:
                prediction=row['predictions'][0]
                assert prediction['requested_f0_hz']==180. and prediction['simulated_f0_hz']==prediction['record']['descriptors']['pitchHz']['value']
                pitch=((prediction['simulated_f0_hz']-observed_pitch)/20.)**2
                assert 4*row['score']-pitch==pytest.approx(3*row['score_excluding_pitch'],abs=1e-9)
        mechanical=fitted['joint']['candidates'][1]['predictions'][0]
        assert abs(mechanical['simulated_f0_hz']-mechanical['requested_f0_hz'])>1
        loads.clear()
        frozen=source.forecast_phonation_bank(engine,fitted,reference_trial_id='cal',pose='o',
            controls={'JA':-3.,'F0':190.,'PR':8000.,'gain':2.},target_id='held')
        assert len(loads)==4 and frozen['forecast']['actual_synthesis_calls']==6
        rows=frozen['forecast']['alternatives']
        assert [row['alternative_id'] for row in rows]==[f'{f}:{c}' for f in ('joint','fixed_source','fixed_anatomy') for c in ('geometric','mechanical')]
        assert [row['source_model'] for row in rows]==['geometric','two_mass']*3
        assert all(row['requested_f0_hz']==190. and row['simulated_f0_hz']==row['record']['descriptors']['pitchHz']['value'] for row in rows)
        pcm,meta,_=frame(engine,'o',{'JA':-3.,'F0':190.,'PR':8000.,'gain':2.,**SHAPE},'held')
        scored=source.score_phonation_bank(frozen,pcm,meta)
        assert all(row['requested_f0_hz']==190. and row['source_model'] in ('geometric','two_mass') for row in scored['alternatives'])
        assert all((row['score'] is None)==(row['score_excluding_pitch'] is None)==(row['heldout_rank_excluding_pitch'] is None) for row in scored['alternatives'])
        assert scored['alternatives'][0]['simulated_f0_hz']==rows[0]['simulated_f0_hz']
        single=source.forecast_phonation(engine,fitted,family='joint',candidate_id='mechanical',reference_trial_id='cal',pose='o',
            controls={'JA':-3.,'F0':190.,'PR':8000.,'gain':2.},target_id='single')
        assert single['forecast']['controls']['source_model']=='two_mass' and single['forecast']['requested_f0_hz']==190.
        assert single['forecast']['simulated_f0_hz']==single['forecast']['record']['descriptors']['pitchHz']['value']
        pcm,meta,_=frame(engine,'o',{'JA':-3.,'F0':190.,'PR':8000.,'gain':2.,**SHAPE},'single')
        result=source.score_phonation_forecast(single,pcm,meta)
        assert result['status']=='available' and result['score_excluding_pitch'] is not None and result['simulated_f0_hz']==single['forecast']['simulated_f0_hz']
        import threading
        stop=threading.Event();stop.set();loads.clear()
        assert source.fit_phonation(engine,document,candidates=candidates,max_synthesis_calls=6,enabled=True,cancelled=stop)['status']=='timed-out'
        cancelled=source.forecast_phonation_bank(engine,fitted,reference_trial_id='cal',pose='o',
            controls={'JA':-3.,'F0':190.,'PR':8000.,'gain':2.},target_id='cancelled',cancelled=stop)['forecast']
        assert cancelled['actual_synthesis_calls']==0 and [row['status'] for row in cancelled['alternatives']]==['timed-out']*6
        assert len(loads)==2  # only the bank's capability audit reloads; no family group is entered after cancellation


def test_app_grids_vary_one_declared_axis_and_family_gains_do_not_clip():
    for count,axis in ((1,[.005,.01,.015]),(3,[.005,.015])):
        _,support=source_candidates([{'anatomy':{}}]*count,'t',180.,'two_mass')
        assert [row['XB'] for row in support]==[row['XT'] for row in support]==axis
        assert {(row['EAA'],row['DF']) for row in support}=={(0.,1.)}
    prescribed,geometric=source_candidates([{'anatomy':{}}],'t',180.)
    candidates,support=source_candidates([{'anatomy':{}}],'t',180.,'two_mass')
    assert {c['trials']['t']['gain'] for c in prescribed}=={4.} and {c['trials']['t']['gain'] for c in candidates}=={2.}
    with Engine() as engine:
        # Loudest points of a 65-600 Hz sweep over all five vowels at PR=8000 (science/MECHANICAL_SOURCE.md).
        for shape,f0,gain in [(geometric[0],415.,4),(geometric[2],415.,4),(support[0],600.,2),(support[1],485.,2),(support[2],380.,2),(support[0],65.,2)]:
            audio,_=source.synthesize_phonation(engine,pose='a',JA=-3,F0=f0,PR=8000,**shape)
            peak=float(np.max(np.abs(source._frame(audio,48000)[0])))
            assert gain*peak<.995
        audio,_=source.synthesize_phonation(engine,pose='a',JA=-3,F0=600,PR=8000,**support[0])
        assert 4*float(np.max(np.abs(source._frame(audio,48000)[0])))>=.995  # the former gain 4 clipped here


def test_on_grid_mixed_family_plumbing_is_not_a_comparison(monkeypatch):
    """Generator equals grid candidate mechanical-4.2, so near-zero discrepancy holds by construction.

    This checks equal per-family call counts, frozen banks, zero post-capture
    synthesis and policy invalidation. It is not comparison evidence.
    """
    with Engine() as engine:
        target={'hard_palate_length':4.2};engine.set_anatomy(target)
        trials=[];controls={}
        for identity,pose,f0,gain in [('cal-a','a',150,2.),('cal-u','u',220,.7)]:
            control={'JA':-3.,'F0':f0,'PR':8000.,'gain':gain,**SHAPE};controls[identity]=control
            trials.append(trial(engine,identity,pose,control))
        candidates=[]
        for family,shape in [('mechanical',SHAPE),('geometric',{'source_model':'geometric','PS':.2})]:
            for palate in (4.2,4.8):
                candidates.append({'candidate_id':f'{family}-{palate}','anatomy':{'hard_palate_length':palate},
                    'trials':{key:{**{k:v for k,v in control.items() if k in ('JA','F0','PR','gain')},**shape} for key,control in controls.items()}})
        document={'schema_version':'phonation-fit-1','trials':trials}
        baseline=engine.anatomy()
        fitted=source.fit_phonation(engine,document,candidates=candidates,max_synthesis_calls=24,enabled=True)
        assert fitted['status']=='available',fitted
        assert fitted['actual_synthesis_calls']==24
        assert all(fitted[family]['actual_synthesis_calls']==8 for family in ('joint','fixed_source','fixed_anatomy'))
        assert fitted['joint']['best']['candidate_id']=='mechanical-4.2' and fitted['joint']['best']['score']<1e-8
        assert fitted['identifiability']=='not_established' and not fitted['closure_contact_inference']
        held={'JA':-3.,'F0':190.,'PR':8500.,'gain':1.3}
        banks={pose:source.forecast_phonation_bank(engine,fitted,reference_trial_id='cal-a',pose=pose,
            controls=held,target_id='held-'+pose,max_synthesis_calls=12) for pose in ('e','o')}
        observations={pose:frame(engine,pose,{**held,**SHAPE},'held-'+pose) for pose in banks}
        monkeypatch.setattr(source,'synthesize_phonation',lambda *a,**kw:(_ for _ in ()).throw(AssertionError('No post-capture synthesis')))
        for pose,frozen in banks.items():
            assert len(frozen['forecast']['alternatives'])==12 and frozen['forecast']['actual_synthesis_calls']==12
            pcm,meta,_=observations[pose]
            scored=source.score_phonation_bank(frozen,pcm,meta)
            correct=next(row for row in scored['alternatives'] if row['alternative_id']=='joint:mechanical-4.2')
            if pose=='e':  # the generator's own e frame is below the analysis floor; kept as an explicit failure
                assert correct['score'] is None and correct['heldout_rank'] is None and scored['status']=='insufficient-quality'
            else:assert correct['score']<1e-8 and correct['heldout_rank']==1
            assert len(scored['alternatives'])==12 and scored['canonical_extractions']==1 and scored['actual_synthesis_calls']==0
            assert not scored['model_updated'] and engine.anatomy()==baseline
        monkeypatch.setattr(source,'adapter_dependencies',lambda:{'engine.py':'changed'})
        stale=source.score_phonation_bank(frozen,pcm,meta)
        assert stale['status']=='unsupported' and stale['canonical_extractions']==0
        assert all(row['score'] is None for row in stale['alternatives'])
