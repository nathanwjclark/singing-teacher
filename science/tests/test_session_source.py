"""Optional native source model lifecycle alongside unchanged baseline anatomy."""
from copy import deepcopy
from datetime import datetime,timezone
import hashlib

import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.phonation import synthesize_phonation,_metadata,_frame
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_session import send,collect


def setup_source(controller,rate=48000):
    with Engine() as engine:
        anatomy=engine.set_anatomy({'hard_palate_length':4.2});provenance=engine.provenance
        audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,PS=.2)
        frame,_=_frame(audio,rate)
    snapshot=freeze_pcm_hypotheses(model_id='baseline',evidence_ids=['baseline-evidence'],evidence_hashes=['a'*64],
        provenance=provenance,hypotheses=[{'hypothesis_id':'anatomy','anatomy':anatomy}],frozen_at=datetime.now(timezone.utc).isoformat()).data
    send(controller,'register_model',snapshot=snapshot)
    metadata=_metadata('source-cal',rate,hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest(),'engine-generated')
    metadata['sessionId']='session';metadata['sourceHashes'].append('b'*64);metadata['evidenceAt']=None
    document={'schema_version':'phonation-fit-1','trials':[{'id':'source-cal','pose':'a','sample_rate_hz':rate,'pcm':frame.tolist(),'metadata':metadata}]}
    candidates=[{'candidate_id':str(ps),'anatomy':anatomy,'trials':{'source-cal':{'JA':-3,'F0':180,'PR':8000,'PS':ps,'gain':1.}}} for ps in (.2,0.)]
    return snapshot,document,candidates


def fitted(controller,service,rate=48000):
    snapshot,document,candidates=setup_source(controller,rate)
    send(controller,'fit_source',parameters={'document':document,'candidates':candidates,'max_synthesis_calls':6})
    state=collect(controller,service)
    assert state['source_model'] is not None,state['jobs'][-1]
    return snapshot,document,candidates,state


def test_actual_native_optional_source_forecast_score_restart_and_baseline(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,document,candidates,state=fitted(controller,service)
        source=deepcopy(state['source_model']);assert state['snapshot']==baseline
        send(controller,'forecast_source',parameters={'family':'joint','candidate_id':'0.2','reference_trial_id':'source-cal',
            'pose':'a','controls':{'JA':-3,'F0':200,'PR':8000,'gain':1.},'target_id':'source-later'})
        state=collect(controller,service);forecast=state['source_forecasts']['source-later']
        assert forecast['artifact']['forecast']['pose']=='a'
        assert forecast['status']=='committed' and forecast['artifact']['forecast']['record']['window']['sampleRateHz']==48000
        with Engine() as engine:
            engine.set_anatomy(baseline['hypotheses'][0]['anatomy'])
            audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=200,PR=8000,PS=.2)
            frame,_=_frame(audio,48000)
        metadata=_metadata('source-later',48000,hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest(),'engine-generated');metadata['sessionId']='session'
        overlap=deepcopy(metadata);overlap['sourceHashes']=['b'*64]
        with pytest.raises(ValueError,match='aliases calibration'):
            send(controller,'score_source',forecast_id='source-later',pcm=frame.tolist(),metadata=overlap)
        unknown=deepcopy(metadata);unknown['evidenceAt']=None
        with pytest.raises(ValueError,match='requires capture time'):
            send(controller,'score_source',forecast_id='source-later',pcm=frame.tolist(),metadata=unknown)
        old=deepcopy(metadata);old['evidenceAt']=forecast['committed_at']
        with pytest.raises(ValueError,match='follow session'):
            send(controller,'score_source',forecast_id='source-later',pcm=frame.tolist(),metadata=old)
        send(controller,'score_source',forecast_id='source-later',pcm=frame.tolist(),metadata=metadata)
        state=collect(controller,service)
        assert state['source_forecasts']['source-later']['status']=='scored'
        assert state['source_forecasts']['source-later']['score_result']['score']<1e-8
        assert state['snapshot']==baseline and state['source_model']==source
        receipt=controller.execute({'action':'replay'})
        assert SessionController(tmp_path/'sessions',service,'session').execute({'action':'replay'})==receipt
        with pytest.raises(ValueError,match='current committed'):
            send(controller,'score_source',forecast_id='source-later',pcm=frame.tolist(),metadata=metadata)


def test_failed_refit_retains_source_and_changed_baseline_rejects_forecast(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,document,candidates,state=fitted(controller,service,44100)
        model=deepcopy(state['source_model'])
        silent=deepcopy(document);silent['trials'][0]['pcm']=[0.]*4096
        send(controller,'fit_source',parameters={'document':silent,'candidates':candidates,'max_synthesis_calls':6})
        state=collect(controller,service)
        assert state['source_model']==model and state['snapshot']==baseline
        assert state['source_status']['status']=='insufficient-quality'
        send(controller,'fit_source',parameters={'document':document,'candidates':candidates,'max_synthesis_calls':1})
        pending=controller.execute({'action':'state'})['state']['pending'];assert service.wait(pending['job_id'])['status']=='failed'
        state=send(controller,'collect_job',job_id=pending['job_id'])
        assert state['source_model']==model and state['source_status']['status']=='failed'
        new=deepcopy(baseline);new['model_id']='baseline-new'
        state=send(controller,'register_model',snapshot=new)
        assert state['source_status']['status']=='unsupported'
        with pytest.raises(ValueError,match='current baseline'):
            send(controller,'forecast_source',parameters={'family':'joint','candidate_id':'0.2','reference_trial_id':'source-cal',
                'pose':'a','controls':{'JA':-3,'F0':200,'PR':8000,'gain':1.},'target_id':'next'})
