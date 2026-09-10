"""Native source banks retain all alternatives and never update baseline anatomy."""
from copy import deepcopy
import hashlib

import pytest

from singing_physics.engine import Engine
from singing_physics.phonation import synthesize_phonation, _metadata, _frame
from singing_physics.service import JobService
from singing_physics.session import SessionController
from singing_physics.session_source import collect as collect_source, _hash
from test_session import send, collect
from test_session_source import fitted


def bank(controller,service,target,f0):
    send(controller,'forecast_source_bank',parameters={'reference_trial_id':'source-cal','pose':'a',
        'controls':{'JA':-3,'F0':f0,'PR':8000,'gain':1.},'target_id':target,'max_synthesis_calls':6})
    return collect(controller,service)


def later(baseline,target,f0):
    with Engine() as engine:
        engine.set_anatomy(baseline['hypotheses'][0]['anatomy'])
        audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=f0,PR=8000,PS=.2)
        frame,_=_frame(audio,48000)
    metadata=_metadata(target,48000,hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest(),'engine-generated')
    metadata['sessionId']='session'
    return frame.tolist(),metadata


def test_native_bank_two_rounds_restart_reused_original_and_ranking_lineage(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,_,_,state=fitted(controller,service)
        source=deepcopy(state['source_model']);prior=None;first_hashes=None
        for index,f0 in enumerate((200,220),1):
            target=f'bank-{index}'
            state=bank(controller,service,target,f0)
            frozen=state['source_forecasts'][target]
            assert frozen['status']=='committed'
            alternatives=frozen['artifact']['forecast']['alternatives']
            assert len(alternatives)==6
            assert {r['family'] for r in alternatives}=={'joint','fixed_source','fixed_anatomy'}
            assert frozen['ranking_parent_id']==prior
            assert frozen['ranking_parent_version']==index-1
            # SQLite replay after commitment must preserve the exact bank bytes and parent.
            replay=controller.execute({'action':'replay'})
            controller=SessionController(tmp_path/'sessions',service,'session')
            assert controller.execute({'action':'replay'})==replay
            pcm,metadata=later(baseline,target,f0)
            wrong=deepcopy(metadata);wrong['sessionId']='other-session'
            with pytest.raises(ValueError,match='another session'):
                send(controller,'score_source_bank',forecast_id=target,pcm=pcm,metadata=wrong)
            early=deepcopy(metadata);early['evidenceAt']=frozen['committed_at']
            with pytest.raises(ValueError,match='follow session'):
                send(controller,'score_source_bank',forecast_id=target,pcm=pcm,metadata=early)
            if first_hashes:
                reused=deepcopy(metadata);reused['sourceHashes']=first_hashes
                with pytest.raises(ValueError,match='already scored'):
                    send(controller,'score_source_bank',forecast_id=target,pcm=pcm,metadata=reused)
            first_hashes=metadata['sourceHashes']
            send(controller,'score_source_bank',forecast_id=target,pcm=pcm,metadata=metadata)
            state=collect(controller,service);scored=state['source_forecasts'][target]
            assert scored['status']=='scored'
            assert [row['alternative_id'] for row in scored['score_result']['alternatives']]==[row['alternative_id'] for row in alternatives]
            ranking=state['source_rankings'][-1]
            assert ranking['parent_ranking_id']==prior and ranking['version']==index
            assert ranking['bank_sha256']==frozen['artifact']['sha256']
            assert ranking['score_result_sha256']==_hash(scored['score_result'])
            assert ranking['conditional_only'] and ranking['baseline_preserved']
            assert state['snapshot']==baseline and state['source_model']==source
            prior=ranking['ranking_id']
            with pytest.raises(ValueError,match='current committed'):
                send(controller,'score_source_bank',forecast_id=target,pcm=pcm,metadata=metadata)
        changed=deepcopy(baseline);changed['model_id']='updated-baseline'
        send(controller,'register_model',snapshot=changed)
        with pytest.raises(ValueError,match='current baseline'):
            bank(controller,service,'stale-bank',200)


def test_bank_collection_preserves_failed_alternatives_and_rejects_missing_rows(tmp_path):
    with JobService(tmp_path/'jobs') as service:
        controller=SessionController(tmp_path/'sessions',service,'session')
        baseline,_,_,state=fitted(controller,service)
        state=bank(controller,service,'bank-failure',200)
        artifact=deepcopy(state['source_forecasts']['bank-failure']['artifact'])
        # Exercise the session transport policy using an explicit numerical failure row.
        failed=artifact['forecast']['alternatives'][0]
        failed.update(status='failed',record=None,reason='Injected numerical failure for session policy test')
        artifact['sha256']=_hash(artifact['forecast'])
        binding={'baseline_model_id':baseline['model_id'],'source_model_id':state['source_model']['model_id'],
            'forecast_id':'bank-failure','ranking_parent_id':None,'ranking_parent_version':0}
        pending={'job_id':'policy-failure','source_binding':binding,'request':{'operation':'forecast_phonation_bank'}}
        collect_source(state,pending,'succeeded',artifact)
        retained=state['source_forecasts']['bank-failure']['artifact']['forecast']['alternatives']
        assert len(retained)==6 and retained[0]['status']=='failed' and retained[0]['record'] is None
        missing=deepcopy(artifact);missing['forecast']['alternatives'].pop();missing['sha256']=_hash(missing['forecast'])
        with pytest.raises(ValueError,match='every fitted alternative'):
            collect_source(state,pending,'succeeded',missing)
        assert state['snapshot']==baseline
