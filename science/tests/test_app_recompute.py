from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.pcm_inverse import FEATURES
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_session import send, collect
from science.scripts.app_recompute import recompute_session, source_score, visual_score
from science.scripts.recompute_session_score import digest


@pytest.fixture(scope='module')
def batch_replay(tmp_path_factory):
    root = tmp_path_factory.mktemp('batch-recompute')
    now = lambda: datetime.now(timezone.utc).isoformat()
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id='synthetic-replay-model', evidence_ids=['calibration'], evidence_hashes=['a'*64],
        provenance=provenance, frozen_at=now(), hypotheses=[{'hypothesis_id':'first','anatomy':{'hard_palate_length':4.2}},
        {'hypothesis_id':'second','anatomy':{'hard_palate_length':4.8}}]).data
    with JobService(root/'worker') as service:
        controller = SessionController(root/'sessions', service, 'synthetic-replay-session')
        send(controller, 'register_model', snapshot=snapshot)
        for index, f0 in enumerate((180., 220.)):
            design, target = 'design-'+str(index), 'target-'+str(index)
            send(controller, 'propose_design', parameters={'design_id':design,'target_observation_id':target,
                'experiments':[{'experiment_id':'a','pose':'a','JA':-2.,'f0_hz':f0,'gain':.8}],
                'feature_scales':{k:{'unit':u,'scale':s,'assumption':'Synthetic engineering scale'} for k,(u,s) in FEATURES.items()},
                'minimum_separation':.000001,'max_synthesis_calls':2})
            collect(controller, service)
            with Engine() as engine:
                engine.set_anatomy(snapshot['hypotheses'][0]['anatomy'])
                pcm = np.asarray(engine.synthesize('a', {'JA':-2.}, f0_hz=f0, duration_s=.25)[4410:8506]*.8,dtype='<f4')
            send(controller,'submit_outcome',design_id=design,parameters={'experiment_id':'a','observation_id':target,
                'artifact_id':'frame-'+str(index),'observed_at':now(),'pcm':pcm.tolist(),'source_kind':'engine-generated'})
            collect(controller, service)
        replay = controller.execute({'action':'replay'})
    return replay


def test_multiple_actual_pcm_scores_match_without_mutation_and_retry(batch_replay):
    before = deepcopy(batch_replay)
    report = recompute_session(batch_replay, session_id='synthetic-replay-session')
    assert report['counts']['compared'] == report['counts']['agreed'] == 2, report
    assert report['budget']['canonicalExtractions'] == 2
    assert report['budget']['synthesisCalls'] == report['budget']['geometryCalls'] == 0
    assert report['modelUpdated'] is False and batch_replay == before
    for row in report['operations']:
        if row['operation'] == 'update_pcm':
            job = next(j for j in batch_replay['state']['jobs'] if j['job_id'] == row['jobId'])
            design = json.loads(job['request']['parameters']['design_json'])
            assert row['status'] == ('verified' if design.get('scoring_policy') else 'version_unverified')
    limited = recompute_session(batch_replay, session_id='synthetic-replay-session', max_operations=1)
    assert limited['counts']['compared'] == limited['counts']['agreed'] == 1
    assert any(row['operation']=='update_pcm' and row['status']=='skipped' and 'limit' in row['reason'] for row in limited['operations'])
    assert batch_replay == before
    # Re-running has no model/ledger writes and uses the same frozen evidence.
    again = recompute_session(batch_replay, session_id='synthetic-replay-session', max_operations=1)
    assert again['workerLedgerSha256'] == report['workerLedgerSha256'] and again['counts'] == limited['counts']
    assert not any('pcm' == key for row in report['operations'] for key in row.get('details',{}))


def test_corrupted_ledger_rejected_before_scoring(batch_replay):
    bad=deepcopy(batch_replay);bad['events'][0]['action']='tampered'
    with pytest.raises(ValueError,match='hash-chain'):
        recompute_session(bad,session_id='synthetic-replay-session')
    with pytest.raises(ValueError,match='sixteen'):
        recompute_session(batch_replay,session_id='synthetic-replay-session',max_operations=17)


def test_actual_visual_scores_and_changed_policy_are_explicit(tmp_path, monkeypatch):
    from test_session_visual import setup
    import singing_physics.visual_likelihood as visual
    with JobService(tmp_path/'worker') as service:
        controller=SessionController(tmp_path/'sessions',service,'visual-replay')
        _,params,annotation=setup(controller)
        send(controller,'forecast_visual',forecast_id='vf',parameters=params);collect(controller,service)
        send(controller,'score_visual',forecast_id='vf',parameters={'annotations':[annotation()]});collect(controller,service)
        replay=controller.execute({'action':'replay'})
    report=recompute_session(replay,session_id='visual-replay')
    assert report['counts']['agreed']==report['counts']['policyVerified']==1,report
    assert report['budget']['canonicalExtractions']==0
    monkeypatch.setattr(visual,'_policy',lambda:{'version':'changed'})
    report=recompute_session(replay,session_id='visual-replay')
    row=report['operations'][-1]
    assert row['status']=='version_mismatch' and row['numericalAgreement'] is None
    tampered=deepcopy(replay['state']['jobs'][-1]);tampered['result']['artifact']['scores'][0]['heldout_rms_px']=10
    with pytest.raises(ValueError,match='digest'):visual_score(tampered)


def test_real_source_bank_score_and_missing_frame_receipt(tmp_path):
    from singing_physics import phonation as p
    with Engine() as engine:
        audio,_=p.synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,PS=.2)
        pcm,_=p._frame(audio,48000);frame_hash=hashlib.sha256(pcm.astype('<f4').tobytes()).hexdigest()
        document={'schema_version':'phonation-fit-1','trials':[{'id':'cal','pose':'a','pcm':pcm.tolist(),'sample_rate_hz':48000,'metadata':p._metadata('cal',48000,frame_hash,'engine-generated')}]}
        fitted=p.fit_phonation(engine,document,candidates=[{'candidate_id':'one','anatomy':engine.anatomy(),'trials':{'cal':{'JA':-3,'F0':180,'PR':8000,'PS':.2,'gain':1.}}}],max_synthesis_calls=3,enabled=True)
        frozen=p.forecast_phonation_bank(engine,fitted,reference_trial_id='cal',pose='a',controls={'JA':-3,'F0':210,'PR':8000,'gain':1.},target_id='heldout',max_synthesis_calls=3)
        audio,_=p.synthesize_phonation(engine,pose='a',JA=-3,F0=210,PR=8000,PS=.2)
        frame,_=p._frame(audio,48000);frame_hash=hashlib.sha256(frame.astype('<f4').tobytes()).hexdigest()
        metadata=p._metadata('heldout',48000,frame_hash,'engine-generated')
        result=p.score_phonation_bank(frozen,frame,metadata)
    job={'request':{'operation':'score_phonation_bank','parameters':{'frozen':frozen,'pcm':frame.tolist(),'metadata':metadata}},'result':result}
    report=source_score(job)
    assert report['numerical_agreement'] is True and report['canonical_extractions']==1,report
    missing=deepcopy(job);missing['result']['observation']=None
    assert source_score(missing)['status']=='missing_artifacts'
    bad=deepcopy(job);bad['request']['parameters']['pcm'][0]+=1
    with pytest.raises(ValueError,match='frame receipt'):source_score(bad)
