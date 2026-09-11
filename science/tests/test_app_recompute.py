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
from singing_physics.pcm_spectral import SPECTRAL_OBJECTIVE
from singing_physics.prediction import Artifact, _encode
from singing_physics.service import JobService
from singing_physics.session import SessionController
from test_session import send, collect
from science.scripts.app_recompute import recompute_session, source_score, visual_score
from science.scripts.recompute_session_score import digest


@pytest.fixture(scope='module')
def batch_evidence(tmp_path_factory):
    root = tmp_path_factory.mktemp('batch-recompute')
    now = lambda: datetime.now(timezone.utc).isoformat()
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id='synthetic-replay-model', evidence_ids=['calibration'], evidence_hashes=['a'*64],
        provenance=provenance, frozen_at=now(), hypotheses=[{'hypothesis_id':'first','anatomy':{'hard_palate_length':4.2}},
        {'hypothesis_id':'second','anatomy':{'hard_palate_length':4.8}}]).data
    with JobService(root/'worker') as service:
        controller = SessionController(service.root/'sessions', service, 'synthetic-replay-session')
        send(controller, 'register_model', snapshot=snapshot)
        for index, f0 in enumerate((180., 220.)):
            design, target = 'design-'+str(index), 'target-'+str(index)
            send(controller, 'propose_design', parameters={'design_id':design,'target_observation_id':target,
                'experiments':[{'experiment_id':'a','pose':'a','JA':-2.,'f0_hz':f0,'gain':.8}],
                'feature_scales':{k:{'unit':u,'scale':s,'assumption':'Synthetic engineering scale'} for k,(u,s) in FEATURES.items()},
                'minimum_separation':.000001,'max_synthesis_calls':2,**({'objective':SPECTRAL_OBJECTIVE} if index else {})})
            collect(controller, service)
            with Engine() as engine:
                engine.set_anatomy(snapshot['hypotheses'][0]['anatomy'])
                pcm = np.asarray(engine.synthesize('a', {'JA':-2.}, f0_hz=f0, duration_s=.25)[4410:8506]*.8,dtype='<f4')
            send(controller,'submit_outcome',design_id=design,parameters={'experiment_id':'a','observation_id':target,
                'artifact_id':'frame-'+str(index),'observed_at':now(),'pcm':pcm.tolist(),'source_kind':'engine-generated'})
            collect(controller, service)
        replay = controller.execute({'action':'replay'})
    return root, replay


@pytest.fixture(scope='module')
def batch_replay(batch_evidence):
    return batch_evidence[1]


OUTCOMES = ('matched', 'failed', 'unavailable', 'unsupported', 'skipped')


def updates(replay):
    """Map objective name to the retained update_pcm job id."""
    return {json.loads(j['request']['parameters']['design_json'])['objective']: j['job_id']
            for j in replay['state']['jobs'] if j['request']['operation'] == 'update_pcm'}


def reseal(replay, changes):
    """Rewrite a copy of a genuine ledger as an explicitly altered transcript.

    Rehashing lets the chain check pass so the test reaches per-operation
    classification; it is not an authenticated history."""
    altered = deepcopy(replay)
    for job in altered['state']['jobs']:
        if job['job_id'] in changes:
            changes[job['job_id']](job)
    altered['events'][-1]['state'] = deepcopy(altered['state'])
    previous = '0'*64
    for event in altered['events']:
        event.pop('sha256'); event['previous_sha256'] = previous
        previous = digest(event); event['sha256'] = previous
    altered['ledger_sha256'] = previous
    return altered


def redesign(change):
    """Change the frozen design and rebind every hash that names it."""
    def apply(job):
        params = job['request']['parameters']; design = json.loads(params['design_json']); change(design)
        encoded = _encode(design); design_hash = hashlib.sha256(encoded).hexdigest()
        params.update(design_json=encoded.decode(), expected_design_digest=design_hash)
        result = job['result']
        result['design_sha256'] = result['observation_receipt']['design_sha256'] = result['updated_snapshot']['design_sha256'] = design_hash
        result['observation_receipt_sha256'] = digest(result['observation_receipt'])
        result['updated_snapshot_sha256'] = digest(result['updated_snapshot'])
    return apply


def rows(report):
    assert sum(report['counts'][name] for name in OUTCOMES) == report['counts']['total'] == len(report['operations'])
    return {row['jobId']: row for row in report['operations']}


def test_multiple_actual_pcm_scores_match_without_mutation_and_retry(batch_replay):
    before = deepcopy(batch_replay)
    report = recompute_session(batch_replay, session_id='synthetic-replay-session')
    counts = report['counts']
    assert counts['matched'] == counts['policyVerified'] == 2, report
    assert counts['failed'] == counts['unavailable'] == counts['skipped'] == counts['legacyVersionUnverified'] == 0
    assert counts['unsupported'] == counts['total'] - 2 > 0
    assert report['budget']['canonicalExtractions'] == 2
    assert report['budget']['synthesisCalls'] == report['budget']['geometryCalls'] == 0
    assert report['modelUpdated'] is False and batch_replay == before
    by_job = rows(report)
    for objective, job_id in updates(batch_replay).items():
        row = by_job[job_id]
        assert (row['outcome'], row['status'], row['policyVerification'], row['numericalAgreement']) == ('matched', 'verified', 'verified', True)
        assert row['details']['objective'] == objective
        assert row['details']['current_scorer_implementation_pin'] == json.loads(next(j for j in batch_replay['state']['jobs'] if j['job_id'] == job_id)['request']['parameters']['design_json'])['scorer_implementation_pin']
    assert all(row['status'] == 'unsupported_operation' for row in by_job.values() if row['operation'] != 'update_pcm')
    limited = recompute_session(batch_replay, session_id='synthetic-replay-session', max_operations=1)
    assert limited['counts']['matched'] == limited['counts']['skipped'] == 1
    skipped = [row for row in rows(limited).values() if row['outcome'] == 'skipped']
    assert skipped[0]['operation'] == 'update_pcm' and skipped[0]['status'] == 'operation_limit' and 'limit' in skipped[0]['reason']
    assert batch_replay == before
    # Re-running has no model/ledger writes and uses the same frozen evidence.
    again = recompute_session(batch_replay, session_id='synthetic-replay-session', max_operations=1)
    assert again['workerLedgerSha256'] == report['workerLedgerSha256'] and again['counts'] == limited['counts']
    assert not any('pcm' == key for row in report['operations'] for key in row.get('details',{}))


def test_spectral_update_disagreement_tamper_pin_and_absent_media_are_separate(batch_replay):
    ids = updates(batch_replay)
    spectral, coarse = ids[SPECTRAL_OBJECTIVE], ids['canonical-coarse-v1']
    def rescore(job): job['result']['scores'][0]['standardized_rms'] += 1
    def unpin(design): design.pop('scorer_implementation_pin')
    # A recorded spectral score that differs from its recomputation fails and is
    # never verified; a coarse design sealed before pins existed still matches but
    # only under the legacy label.
    report = recompute_session(reseal(batch_replay, {spectral: rescore, coarse: redesign(unpin)}), session_id='synthetic-replay-session')
    by_job = rows(report)
    assert (by_job[spectral]['outcome'], by_job[spectral]['status'], by_job[spectral]['numericalAgreement']) == ('failed', 'numerical_disagreement', False)
    assert by_job[spectral]['policyVerification'] == 'verified'
    assert (by_job[coarse]['outcome'], by_job[coarse]['status'], by_job[coarse]['policyVerification']) == ('matched', 'legacy_version_unverified', 'legacy_version_unverified')
    assert report['counts']['failed'] == report['counts']['matched'] == report['counts']['legacyVersionUnverified'] == 1
    assert report['counts']['policyVerified'] == 0
    # A pin naming other scoring code is unsupported, not recomputed. An absent
    # frame is unavailable and nothing stands in for it.
    def repin(design): design['scorer_implementation_pin']['implementation_sha256']['science/src/singing_physics/pcm_spectral.py'] = '0'*64
    def drop(job): job['request']['parameters']['pcm'] = None
    report = recompute_session(reseal(batch_replay, {spectral: redesign(repin), coarse: drop}), session_id='synthetic-replay-session')
    by_job = rows(report)
    assert (by_job[spectral]['outcome'], by_job[spectral]['status'], by_job[spectral]['policyVerification'], by_job[spectral]['numericalAgreement']) == ('unsupported', 'version_mismatch', 'unverified', None)
    assert 'scoring policy' in by_job[spectral]['reason']
    assert (by_job[coarse]['outcome'], by_job[coarse]['status'], by_job[coarse]['numericalAgreement']) == ('unavailable', 'missing_media', None)
    assert 'recomputed_scientific_result' not in by_job[coarse]['details'] and 'recomputed_scientific_result' not in by_job[spectral]['details']
    assert report['budget']['canonicalExtractions'] == report['counts']['matched'] == report['counts']['policyVerified'] == 0
    # A spectral design cannot drop its pin to pass as legacy; a changed received
    # frame fails its receipt check before any extraction.
    def perturb(job): job['request']['parameters']['pcm'][100] += .01
    report = recompute_session(reseal(batch_replay, {spectral: redesign(unpin), coarse: perturb}), session_id='synthetic-replay-session')
    by_job = rows(report)
    assert (by_job[spectral]['outcome'], by_job[spectral]['status']) == ('unsupported', 'version_mismatch')
    assert (by_job[coarse]['outcome'], by_job[coarse]['status']) == ('failed', 'invalid_evidence') and 'SHA-256' in by_job[coarse]['reason']
    assert report['counts']['unsupported'] == report['counts']['total'] - 1 and report['budget']['canonicalExtractions'] == 0


def test_corrupted_ledger_rejected_before_scoring(batch_replay):
    bad=deepcopy(batch_replay);bad['events'][0]['action']='tampered'
    with pytest.raises(ValueError,match='hash-chain'):
        recompute_session(bad,session_id='synthetic-replay-session')
    with pytest.raises(ValueError,match='sixteen'):
        recompute_session(batch_replay,session_id='synthetic-replay-session',max_operations=17)


def test_actual_visual_scores_and_changed_policy_are_explicit(tmp_path):
    from test_session_visual import setup
    with JobService(tmp_path/'worker') as service:
        controller=SessionController(tmp_path/'sessions',service,'visual-replay')
        _,params,annotation=setup(controller)
        send(controller,'forecast_visual',forecast_id='vf',parameters=params);collect(controller,service)
        send(controller,'score_visual',forecast_id='vf',parameters={'annotations':[annotation()]});collect(controller,service)
        replay=controller.execute({'action':'replay'})
    report=recompute_session(replay,session_id='visual-replay')
    assert report['counts']['matched']==report['counts']['policyVerified']==1,report
    assert report['budget']['canonicalExtractions']==0
    job_id=replay['state']['jobs'][-1]['job_id']
    def repolicy(job):
        params=job['request']['parameters'];params['forecast']['policy']={**params['forecast']['policy'],'version':'changed'}
        forecast=Artifact(_encode(params['forecast']));params['expected_digest']=forecast.sha256
        job['result']['artifact']['forecast_sha256']=forecast.sha256;job['result']['sha256']=digest(job['result']['artifact'])
    # A forecast frozen under another policy and bound to its score is unsupported.
    row=rows(recompute_session(reseal(replay,{job_id:repolicy}),session_id='visual-replay'))[job_id]
    assert (row['outcome'],row['status'],row['numericalAgreement'])==('unsupported','version_mismatch',None)
    # The same policy change without rebinding is a forged forecast: failed, not unsupported.
    def forge(job): job['request']['parameters']['forecast']['policy']={**job['request']['parameters']['forecast']['policy'],'version':'changed'}
    row=rows(recompute_session(reseal(replay,{job_id:forge}),session_id='visual-replay'))[job_id]
    assert (row['outcome'],row['status'])==('failed','invalid_evidence') and 'bind' in row['reason']
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
    assert (report['status'],report['numerical_agreement'],report['canonical_extractions'])==('verified',True,1),report
    missing=deepcopy(job);missing['result']['observation']=None
    assert source_score(missing)['status']=='missing_artifacts'
    # An absent retained frame is missing media, as for update_pcm, never a failure.
    absent=deepcopy(job);absent['request']['parameters']['pcm']=None
    assert source_score(absent)['status']=='missing_media'
    bad=deepcopy(job);bad['request']['parameters']['pcm'][0]+=1
    with pytest.raises(ValueError,match='frame receipt'):source_score(bad)


def test_app_runner_reads_real_http_worker_and_only_persists_redacted_report(batch_evidence, tmp_path, monkeypatch):
    import threading
    from singing_physics.http_service import ScientificHTTPServer
    from science.scripts.app_recompute import run
    root, original = batch_evidence
    token = 'synthetic-token-' + 'a'*32
    with ScientificHTTPServer(root/'worker', token, port=0) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        monkeypatch.setenv('SCIENCE_URL', 'http://127.0.0.1:'+str(server.server_port))
        monkeypatch.setenv('SCIENCE_TOKEN', token)
        try:
            (tmp_path/'science-runs/run-synthetic').mkdir(parents=True)
            (tmp_path/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-synthetic'}))
            (tmp_path/'science-runs/run-synthetic/summary.json').write_text(json.dumps({'sessionId':'synthetic-replay-session'}))
            output=tmp_path/'replay-verifications/replay-11111111-1111-4111-8111-111111111111'; output.mkdir(parents=True)
            (output/'request.json').write_text(json.dumps({'runId':'run-synthetic','sessionId':'synthetic-replay-session','maxOperations':16}))
            worker=lambda:{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'worker').rglob('*')) if p.is_file()}
            retained=worker()
            report=run(tmp_path,output)
            assert report['counts']['matched']==report['counts']['policyVerified']==2, report
            assert worker()==retained
            assert report['workerLedgerSha256']==original['ledger_sha256']
            assert set(p.name for p in output.iterdir())=={'request.json','report.json'}
            raw=(output/'report.json').read_text()
            assert token not in raw and '"pcm":' not in raw
            with pytest.raises(FileExistsError): run(tmp_path,output)
            from science.scripts.live_capture_jobs import HTTPBackend
            after=HTTPBackend('http://127.0.0.1:'+str(server.server_port),token,'synthetic-replay-session').execute({'action':'replay'})
            assert after==original
        finally:
            server.shutdown();thread.join(timeout=5)


def test_runtime_faults_are_unsupported_not_failed(batch_replay, tmp_path, monkeypatch):
    ids = updates(batch_replay)
    def outcomes(report):
        return {(row['outcome'], row['status']) for row in rows(report).values() if row['jobId'] in ids.values() and row['outcome'] != 'skipped'}
    # The native engine is process-global: holding it makes every PCM recompute's
    # Engine() fail inside this process.
    with Engine():
        report = recompute_session(batch_replay, session_id='synthetic-replay-session')
    assert outcomes(report) == {('unsupported', 'runtime_unavailable')} and report['counts']['failed'] == 0
    assert all('Scoring runtime unavailable' in row['reason'] for row in report['operations'] if row['status'] == 'runtime_unavailable')
    # No Node on PATH: the canonical extractor cannot run.
    monkeypatch.setenv('PATH', str(tmp_path/'empty'))
    report = recompute_session(batch_replay, session_id='synthetic-replay-session')
    assert outcomes(report) == {('unsupported', 'runtime_unavailable')} and report['counts']['failed'] == 0
    # A Node that cannot run the bridge (exits nonzero on the evidence-free validation call).
    (tmp_path/'broken').mkdir(); node = tmp_path/'broken'/'node'
    node.write_text('#!/bin/sh\nexit 9\n'); node.chmod(0o755)
    monkeypatch.setenv('PATH', str(tmp_path/'broken'))
    report = recompute_session(batch_replay, session_id='synthetic-replay-session')
    assert outcomes(report) == {('unsupported', 'runtime_unavailable')} and report['counts']['failed'] == 0
    # A Node that never answers hits the bridge's 30-second timeout.
    (tmp_path/'slow').mkdir(); node = tmp_path/'slow'/'node'
    node.write_text('#!/bin/sh\nexec /bin/sleep 60\n'); node.chmod(0o755)
    monkeypatch.setenv('PATH', str(tmp_path/'slow'))
    report = recompute_session(batch_replay, session_id='synthetic-replay-session', max_operations=1)
    assert outcomes(report) == {('unsupported', 'runtime_unavailable')} and 'timed out' in next(r for r in report['operations'] if r['status'] == 'runtime_unavailable')['reason']


def test_recompute_never_dispatches_a_pending_intent(batch_evidence, tmp_path, monkeypatch):
    """The 'replay' session action would submit a persisted intent and append job_dispatched."""
    import shutil, sqlite3, threading
    from singing_physics.http_service import ScientificHTTPServer
    from singing_physics.service import canonical
    from singing_physics.session import _hash, _ledger
    from science.scripts.app_recompute import run
    from science.scripts.live_capture_jobs import HTTPBackend
    root, original = batch_evidence
    shutil.copytree(root/'worker', tmp_path/'worker')
    sessions, jobs = tmp_path/'worker/sessions/sessions.sqlite3', tmp_path/'worker/jobs.sqlite3'
    # Input data: the ledger as left by a crash after an intent was persisted and
    # before JobService returned its job id (written exactly as _append writes).
    with sqlite3.connect(sessions) as db:
        state, previous, _ = _ledger(db, 'synthetic-replay-session')
        state['version'] += 1
        model = state['snapshot']['model_id']
        state['pending'] = {'request': {'operation': 'forward', 'parameters': {'pose': 'a', 'duration_s': .1}, 'session_id': 'synthetic-replay-session', 'model_id': model},
                            'key': 'session:'+'c'*64, 'job_id': None, 'base_model_id': model}
        event = {'session_id': 'synthetic-replay-session', 'previous_sha256': previous, 'action': 'search', 'received_at': datetime.now(timezone.utc).isoformat(), 'details': {}, 'state': deepcopy(state)}
        db.execute('INSERT INTO events VALUES(?,?,?,?)', ('synthetic-replay-session', state['version'], canonical(event), _hash(event)))
    def models():
        with sqlite3.connect(jobs.as_uri()+'?mode=ro', uri=True) as db:
            return db.execute('SELECT * FROM models ORDER BY session_id').fetchall()
    def retained():
        return {str(p.relative_to(tmp_path)): p.read_bytes() for p in sorted((tmp_path/'worker').rglob('*')) if p.is_file() and not p.name.endswith(('-shm', '-wal'))}
    before, before_models = retained(), models()
    token = 'synthetic-token-' + 'b'*32
    with ScientificHTTPServer(tmp_path/'worker', token, port=0) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = 'http://127.0.0.1:'+str(server.server_port)
        monkeypatch.setenv('SCIENCE_URL', url); monkeypatch.setenv('SCIENCE_TOKEN', token)
        try:
            data = tmp_path/'app'; (data/'science-runs/run-synthetic').mkdir(parents=True)
            (data/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-synthetic'}))
            (data/'science-runs/run-synthetic/summary.json').write_text(json.dumps({'sessionId':'synthetic-replay-session'}))
            output = data/'replay-verifications/replay-33333333-3333-4333-8333-333333333333'; output.mkdir(parents=True)
            (output/'request.json').write_text(json.dumps({'runId':'run-synthetic','sessionId':'synthetic-replay-session','maxOperations':16}))
            report = run(data, output)
            assert report['sessionVersion'] == state['version'] and report['counts']['matched'] == 2, report
            assert retained() == before and models() == before_models
            ledger = HTTPBackend(url, token, 'synthetic-replay-session').ledger()
            assert ledger['state']['version'] == state['version'] and ledger['state']['pending']['job_id'] is None
            assert ledger['ledger_sha256'] == report['workerLedgerSha256'] != original['ledger_sha256']
            from urllib.error import HTTPError
            with pytest.raises(HTTPError, match='404'):
                HTTPBackend(url, token, 'unknown-session').ledger()
            # The recovery read the recompute used to call advances this same ledger.
            dispatched = HTTPBackend(url, token, 'synthetic-replay-session').execute({'action': 'replay'})
            assert dispatched['state']['version'] == state['version'] + 1 and dispatched['events'][-1]['action'] == 'job_dispatched'
        finally:
            server.shutdown(); thread.join(timeout=5)
