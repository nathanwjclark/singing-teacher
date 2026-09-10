from copy import deepcopy
from datetime import datetime,timezone
import hashlib

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.phonation import (synthesize_phonation,fit_phonation,forecast_phonation,
    score_phonation_forecast,_metadata,source_capability)


def fixture(engine,anatomy=None,ps=.2):
    anatomy=anatomy or {'hard_palate_length':4.2}
    saved=engine.anatomy();engine.set_anatomy(anatomy)
    audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,PS=ps)
    engine.set_anatomy(saved);frame=audio[4410:8506]
    sha=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
    metadata=_metadata('cal',44100,sha,'engine-generated')
    document={'schema_version':'phonation-fit-1','trials':[{'id':'cal','pose':'a','pcm':frame.tolist(),'sample_rate_hz':44100,'metadata':metadata}]}
    candidates=[{'candidate_id':str(i),'anatomy':a,'trials':{'cal':{'JA':-3,'F0':180,'PR':8000,'PS':s,'gain':1.}}}
        for i,(a,s) in enumerate([(anatomy,ps),(anatomy,0.),({'hard_palate_length':4.8},ps)])]
    return document,candidates


def test_real_source_tract_fit_equal_calls_and_heldout(tmp_path):
    with Engine() as engine:
        doc,candidates=fixture(engine);original=deepcopy(doc);saved=engine.anatomy()
        fitted=fit_phonation(engine,doc,candidates=candidates,max_synthesis_calls=9,enabled=True)
        assert fitted['status']=='available',fitted
        assert fitted['joint']['best']['candidate_id']=='0'
        assert fitted['joint']['best']['score']<1e-8
        assert fitted['fixed_source']['best']['score']>1e-5
        assert all(fitted[f]['actual_synthesis_calls']==3 for f in ('joint','fixed_source','fixed_anatomy'))
        assert fitted['actual_synthesis_calls']==9 and doc==original and engine.anatomy()==saved
        forecasts=[forecast_phonation(engine,fitted,family=f,candidate_id=fitted[f]['best']['candidate_id'],
            reference_trial_id='cal',pose='a',controls={'JA':-3,'F0':200,'PR':8000,'gain':1.},target_id='later')
            for f in ('joint','fixed_source')]
        engine.set_anatomy({'hard_palate_length':4.2})
        audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=200,PR=8000,PS=.2)
        frame=audio[4410:8506];sha=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
        metadata=_metadata('later',44100,sha,'engine-generated')
        scores=[score_phonation_forecast(f,frame,metadata) for f in forecasts]
        assert scores[0]['score']<1e-8 and scores[1]['score']>scores[0]['score']
        assert not scores[0]['model_updated'] and not fitted['closure_contact_inference']
        with pytest.raises(ValueError,match='hash'):
            bad=deepcopy(forecasts[0]);bad['forecast']['controls']['PS']=0;score_phonation_forecast(bad,frame,metadata)


def test_disabled_quality_budget_native_failure_and_source_controls(monkeypatch):
    with Engine() as engine:
        assert fit_phonation(engine,None,candidates=None)['status']=='disabled'
        assert source_capability(engine)['source_model_family']=='prescribed geometric glottis'
        doc,candidates=fixture(engine);saved=engine.anatomy()
        for budget in (8,True):
            with pytest.raises(ValueError):fit_phonation(engine,doc,candidates=candidates,max_synthesis_calls=budget,enabled=True)
        silent=deepcopy(doc);silent['trials'][0]['pcm']=[0.]*4096
        result=fit_phonation(engine,silent,candidates=candidates,enabled=True)
        assert result['status']=='insufficient-quality' and result['actual_synthesis_calls']==0
        with pytest.raises(ValueError):synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,PS=.4)
        def failed(*args,**kwargs):raise RuntimeError('injected synthesis failure')
        monkeypatch.setattr('singing_physics.phonation.synthesize_phonation',failed)
        result=fit_phonation(engine,doc,candidates=candidates,max_synthesis_calls=9,enabled=True)
        assert result['status']=='failed' and result['actual_synthesis_calls']==9
        assert engine.anatomy()==saved


def test_tract_change_missing_features_stays_unscorable_and_cancellation():
    import threading
    with Engine() as engine:
        doc,candidates=fixture(engine)
        event=threading.Event();event.set()
        assert fit_phonation(engine,doc,candidates=candidates,enabled=True,cancelled=event)['status']=='timed-out'
        fitted=fit_phonation(engine,doc,candidates=candidates,max_synthesis_calls=9,enabled=True)
        frozen=forecast_phonation(engine,fitted,family='joint',candidate_id='0',reference_trial_id='cal',
            pose='i',controls={'JA':-3,'F0':180,'PR':8000,'gain':1.},target_id='tract-change')
        engine.set_anatomy({'hard_palate_length':4.2})
        audio,_=synthesize_phonation(engine,pose='i',JA=-3,F0=180,PR=8000,PS=.2)
        frame=audio[4410:8506]
        metadata=_metadata('tract-change',44100,hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest(),'engine-generated')
        scored=score_phonation_forecast(frozen,frame,metadata)
        assert scored['status']=='insufficient-quality' and scored['score'] is None
        assert scored['baseline_preserved'] and not scored['model_updated']


def test_tract_only_generator_does_not_require_source_change():
    with Engine() as engine:
        doc,candidates=fixture(engine,anatomy={'hard_palate_length':4.6},ps=0.)
        candidates[1]['trials']['cal']['PS']=.2
        result=fit_phonation(engine,doc,candidates=candidates,max_synthesis_calls=9,enabled=True)
        assert result['joint']['best']['score']<1e-8
        assert result['fixed_source']['best']['score']<1e-8
        assert result['fixed_anatomy']['best']['score']>1e-8
        assert result['identifiability']=='not_established'


@pytest.mark.parametrize('missing',[False,True])
def test_frozen_score_preserves_baseline_when_extractor_changes_or_disappears(monkeypatch,missing):
    with Engine() as engine:
        doc,candidates=fixture(engine)
        fitted=fit_phonation(engine,doc,candidates=candidates,max_synthesis_calls=9,enabled=True)
        frozen=forecast_phonation(engine,fitted,family='joint',candidate_id='0',reference_trial_id='cal',
            pose='a',controls={'JA':-3,'F0':200,'PR':8000,'gain':1.},target_id='later-unavailable')
        before=deepcopy(frozen)
        metadata=_metadata('later-unavailable',44100,'b'*64,'engine-generated')
        def signature():
            if missing:raise FileNotFoundError('removed optional extractor')
            return {'changed-source':'c'*64}
        monkeypatch.setattr('singing_physics.phonation.extractor_signature',signature)
        result=score_phonation_forecast(frozen,[0.]*4096,metadata)
        assert result['status']=='unsupported' and result['score'] is None
        assert result['baseline_preserved'] and not result['model_updated']
        assert frozen==before
