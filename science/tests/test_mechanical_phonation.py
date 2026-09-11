"""Real native mechanics, equal-cost ablations, and prospective source transfer."""
from copy import deepcopy
import hashlib

import numpy as np
import pytest

from singing_physics.engine import Engine
import singing_physics.phonation as source


SHAPE={'source_model':'two_mass','XB':.005,'XT':.005,'EAA':0.,'DF':1.}


def frame(engine,pose,controls,identity):
    audio,state=source.synthesize_phonation(engine,pose=pose,**{k:v for k,v in controls.items() if k!='gain'})
    pcm,_=source._frame(audio,48000);pcm*=controls['gain']
    sha=hashlib.sha256(pcm.astype('<f4').tobytes()).hexdigest()
    return pcm,source._metadata(identity,48000,sha,'engine-generated'),state


def test_native_family_lifecycle_preserves_state_and_dimensionless_metadata():
    with Engine() as engine:
        engine.set_anatomy({'hard_palate_length':4.2})
        anatomy=engine.anatomy();provenance=deepcopy(engine.provenance)
        base=engine.synthesize('a',duration_s=.1)
        for _ in range(2):
            with pytest.raises(RuntimeError,match='test interruption'):
                with engine.source_model('Two-mass model'):
                    assert engine.glottis_count==6
                    assert next(r for r in engine.source_info if r['name']=='DF')['unit']==''
                    assert len(engine.provenance['selected_source_speaker_sha256'])==64
                    assert engine.provenance['selected_source_speaker_sha256']!=provenance['speaker_sha256']
                    engine.set_anatomy({'hard_palate_length':4.6})
                    raise RuntimeError('test interruption')
            assert engine.source_model_family=='Geometric glottis'
            assert engine.anatomy()==anatomy and engine.provenance==provenance
            np.testing.assert_allclose(engine.synthesize('a',duration_s=.1),base,rtol=0,atol=1e-12)
        with pytest.raises(ValueError):
            with engine.source_model('invented family'):pass
        assert engine.anatomy()==anatomy


def test_mechanical_control_validation_and_actual_frequency_response():
    with Engine() as engine:
        control={'JA':-3,'F0':180,'PR':8000,'gain':1.,**SHAPE}
        a,meta,state=frame(engine,'a',control,'mechanical')
        observed=source.measure_phonation(a,48000,meta)
        assert abs(observed['descriptors']['pitchHz']['value']-control['F0'])>1
        assert state['source_model']=='two_mass' and 'PS' not in state['source_controls']
        changed,_,_=frame(engine,'a',{**control,'DF':1.2},'damped')
        assert np.linalg.norm(a-changed)>.001
        saved=engine.anatomy()
        for bad in ({'XB':.1},{'DF':True},{'PS':.2},{'source_model':'unknown'}):
            with pytest.raises(ValueError):frame(engine,'a',{**control,**bad},'bad')
            assert engine.anatomy()==saved and engine.source_model_family=='Geometric glottis'


def test_two_source_families_equal_budget_multivowel_pitch_gain_transfer(monkeypatch):
    with Engine() as engine:
        target={'hard_palate_length':4.2};engine.set_anatomy(target)
        trials=[];controls={}
        for identity,pose,f0,gain in [('cal-a','a',150,2.),('cal-u','u',220,.7)]:
            control={'JA':-3.,'F0':f0,'PR':8000.,'gain':gain,**SHAPE};controls[identity]=control
            pcm,meta,_=frame(engine,pose,control,identity)
            trials.append({'id':identity,'pose':pose,'pcm':pcm.tolist(),'sample_rate_hz':48000,'metadata':meta})
        candidates=[]
        # Same 2 alternatives per family; nuisance and tract support match exactly.
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
        assert fitted['joint']['best']['candidate_id']=='mechanical-4.2'
        assert fitted['joint']['best']['score']<1e-8
        assert fitted['identifiability']=='not_established' and not fitted['closure_contact_inference']
        held={'JA':-3.,'F0':190.,'PR':8500.,'gain':1.3}
        # Preserve the under-floor /e/ transfer as an explicit failure case;
        # the supported /o/ transfer independently checks actual finite scores.
        banks={pose:source.forecast_phonation_bank(engine,fitted,reference_trial_id='cal-a',pose=pose,
            controls=held,target_id='held-'+pose,max_synthesis_calls=12) for pose in ('e','o')}
        observations={pose:frame(engine,pose,{**held,**SHAPE},'held-'+pose) for pose in banks}
        monkeypatch.setattr(source,'synthesize_phonation',lambda *a,**kw:(_ for _ in ()).throw(AssertionError('No post-capture synthesis')))
        for pose,frozen in banks.items():
            assert len(frozen['forecast']['alternatives'])==12 and frozen['forecast']['actual_synthesis_calls']==12
            pcm,meta,_=observations[pose]
            scored=source.score_phonation_bank(frozen,pcm,meta)
            correct=next(row for row in scored['alternatives'] if row['alternative_id']=='joint:mechanical-4.2')
            if pose=='e':
                assert correct['score'] is None and correct['heldout_rank'] is None
                assert scored['status']=='insufficient-quality'
            else:
                assert correct['score']<1e-8 and correct['heldout_rank']==1
            assert len(scored['alternatives'])==12 and scored['canonical_extractions']==1 and scored['actual_synthesis_calls']==0
            assert not scored['model_updated'] and engine.anatomy()==baseline
        monkeypatch.setattr(source,'adapter_dependencies',lambda:{'engine.py':'changed'})
        stale=source.score_phonation_bank(frozen,pcm,meta)
        assert stale['status']=='unsupported' and stale['canonical_extractions']==0
        assert all(row['score'] is None for row in stale['alternatives'])
