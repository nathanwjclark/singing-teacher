from copy import deepcopy
import hashlib

import numpy as np
import pytest

from singing_physics.engine import Engine
import singing_physics.phonation as module
from singing_physics.phonation import (synthesize_phonation,fit_phonation,forecast_phonation_bank,
    score_phonation_bank,_metadata,_frame)


@pytest.fixture(scope='module')
def fitted():
    with Engine() as engine:
        engine.set_anatomy({'hard_palate_length':4.2})
        audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,PS=.2)
        pcm,_=_frame(audio,48000);digest=hashlib.sha256(pcm.astype('<f4').tobytes()).hexdigest()
        document={'schema_version':'phonation-fit-1','trials':[{'id':'cal','pose':'a','pcm':pcm.tolist(),
            'sample_rate_hz':48000,'metadata':_metadata('cal',48000,digest,'engine-generated')}]}
        choices=[{'candidate_id':str(i),'anatomy':{'hard_palate_length':palate},
            'trials':{'cal':{'JA':-3,'F0':180,'PR':8000,'PS':ps,'gain':1.}}}
            for i,(palate,ps) in enumerate([(4.2,.2),(4.2,0.),(4.8,.2)])]
        result=fit_phonation(engine,document,candidates=choices,max_synthesis_calls=9,enabled=True)
        assert result['status']=='available'
        return result


def bank(engine,fitted,**kwargs):
    return forecast_phonation_bank(engine,fitted,reference_trial_id='cal',pose='a',
        controls={'JA':-3,'F0':200,'PR':8000,'gain':1.},target_id='heldout',**kwargs)


def observed(engine):
    engine.set_anatomy({'hard_palate_length':4.2})
    audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=200,PR=8000,PS=0.)
    pcm,_=_frame(audio,48000);digest=hashlib.sha256(pcm.astype('<f4').tobytes()).hexdigest()
    return pcm,_metadata('heldout',48000,digest,'engine-generated')


def test_bank_all_families_one_observation_no_scoring_synthesis_and_rank_reversal(fitted,monkeypatch):
    with Engine() as engine:
        saved=engine.anatomy();frozen=bank(engine,fitted)
        assert engine.anatomy()==saved
        assert frozen['forecast']['coverage']=={'total':9,'available':9,'unavailable':0,'complete':True}
        assert frozen['forecast']['actual_synthesis_calls']==9
        assert frozen['forecast']['profile']=={'sampleRateHz':48000,'startSample':4800,'sampleCount':4096}
        assert {r['family'] for r in frozen['forecast']['alternatives']}=={'joint','fixed_source','fixed_anatomy'}
        pcm,metadata=observed(engine)
        real=module.measure_phonation;calls=[]
        def counted(*args):calls.append(1);return real(*args)
        monkeypatch.setattr(module,'measure_phonation',counted)
        def forbidden(*args,**kwargs):raise AssertionError('Post-capture synthesis is forbidden')
        monkeypatch.setattr(module,'synthesize_phonation',forbidden)
        score=score_phonation_bank(frozen,pcm,metadata)
        assert len(calls)==1 and score['canonical_extractions']==1 and score['actual_synthesis_calls']==0
        assert score['coverage']['scored']==9 and score['model_updated'] is False
        rows={r['alternative_id']:r for r in score['alternatives']}
        assert rows['joint:0']['calibration_score']<rows['joint:1']['calibration_score']
        assert rows['joint:1']['score']<rows['joint:0']['score']
        assert rows['joint:1']['rank_change']>0


def test_unavailable_predictions_are_retained_and_budget_is_checked_before_synthesis(fitted,monkeypatch):
    with Engine() as engine:
        with pytest.raises(ValueError,match='budget'):bank(engine,fitted,max_synthesis_calls=8)
        partial=deepcopy(fitted);partial['joint']['candidates'][2].update(status='unscorable',score=None)
        frozen=bank(engine,partial,max_synthesis_calls=8)
        assert frozen['forecast']['actual_synthesis_calls']==8
        assert frozen['forecast']['coverage']['total']==9 and not frozen['forecast']['coverage']['complete']
        pcm,metadata=observed(engine);score=score_phonation_bank(frozen,pcm,metadata)
        missing=next(r for r in score['alternatives'] if r['alternative_id']=='joint:2')
        assert missing['score'] is None and missing['heldout_rank'] is None and missing['reason']
        assert len(score['alternatives'])==9 and len(score['ranking'])==8
        assert all(row['rank_change'] is None for row in score['alternatives'])
        assert score['rank_change_comparison_ids']==[] and score['rank_change_reason']


def test_hash_original_alias_policy_and_profile_guards(fitted,monkeypatch):
    with Engine() as engine:
        frozen=bank(engine,fitted);pcm,metadata=observed(engine)
        bad=deepcopy(frozen);bad['forecast']['alternatives'][0]['controls']['PS']=.1
        with pytest.raises(ValueError,match='hash'):score_phonation_bank(bad,pcm,metadata)
        reused={**metadata,'sourceHashes':frozen['forecast']['excluded_artifact_hashes']}
        with pytest.raises(ValueError,match='artifact reused'):score_phonation_bank(frozen,pcm,reused)
        with pytest.raises(ValueError,match='profile'):score_phonation_bank(frozen,pcm[:-1],metadata)
        monkeypatch.setattr(module,'extractor_signature',lambda:{'changed':'version'})
        score=score_phonation_bank(frozen,pcm,metadata)
        assert score['status']=='unsupported' and score['canonical_extractions']==0
        assert len(score['alternatives'])==9 and all(row['score'] is None for row in score['alternatives'])


def test_cancellation_keeps_the_full_bank_manifest(fitted):
    import threading
    event=threading.Event();event.set()
    with Engine() as engine:
        frozen=bank(engine,fitted,cancelled=event)
        assert frozen['forecast']['actual_synthesis_calls']==0
        assert len(frozen['forecast']['alternatives'])==9
        assert all(row['status']=='timed-out' for row in frozen['forecast']['alternatives'])
