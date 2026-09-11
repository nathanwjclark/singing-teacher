"""Cue-execution learning through the session ledger and isolated native jobs (synthetic evidence)."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib

import pytest

from singing_physics.pcm_design import _hash, freeze_pcm_hypotheses
from singing_physics.service import JobService, canonical
from singing_physics.session import SessionController, state_field
from singing_physics.session_control import prepare, verify_ledger
from science.scripts.app_recompute import recompute_session
from test_control_pcm import CONTEXT, CONTROLS, FIRST, GAIN, SECOND, cue, frame
from test_session import send

BINDING = {'cue': cue(), 'context': CONTEXT, 'controls': CONTROLS, 'gain': GAIN}


def now(): return datetime.now(timezone.utc).isoformat()


def register(controller, anatomies, model_id):
    from singing_physics.engine import Engine
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id=model_id, evidence_ids=['calibration'], evidence_hashes=['a' * 64], provenance=provenance,
        frozen_at=now(), hypotheses=[{'hypothesis_id': f'h{i}', 'anatomy': a} for i, a in enumerate(anatomies)]).data
    return send(controller, 'register_model', snapshot=snapshot)


def finish(controller, service, status='succeeded'):
    job = controller.execute({'action': 'state'})['state']['pending']['job_id']
    assert service.wait(job, timeout_s=90)['status'] == status, service.status(job)
    return send(controller, 'collect_job', job_id=job)


def metadata(target, index):
    return {'sessionId': 'session', 'observationId': target, 'attemptId': f'attempt-{index}', 'artifactId': f'artifact-{index}',
            'clockId': 'clock', 'sourceKind': 'engine-generated', 'evidenceAt': now(),
            'sourceHashes': [hashlib.sha256(f'session-original-{index}'.encode()).hexdigest()]}


def forecast(controller, service, target, binding='delivered-cue'):
    send(controller, 'forecast_control', binding_id=binding, target_id=target, parameters={})
    return finish(controller, service)['control_forecasts'][target]


def attempt(controller, service, target, index, pcm=None, **changes):
    send(controller, 'score_control', forecast_id=target, pcm=pcm or frame(FIRST, CONTROLS[1], index), metadata={**metadata(target, index), **changes})
    return controller.execute({'action': 'state'})['state']


def by_anatomy(forecast): return forecast['artifact']['artifact']['execution_support']['by_anatomy']


def test_ledger_history_changes_the_fourth_forecast_and_survives_pruning(tmp_path):
    with JobService(tmp_path / 'jobs') as service:
        controller = SessionController(tmp_path / 'sessions', service, 'session')
        state = register(controller, [FIRST, SECOND], 'baseline')
        first = _hash(state['snapshot']['hypotheses'][0]['anatomy'])
        send(controller, 'declare_control_binding', binding_id='delivered-cue', binding=BINDING)
        for index in range(3):
            committed = forecast(controller, service, f'target-{index}')
            assert committed['status'] == 'committed' and by_anatomy(committed)[first]['matched_attempts'] == index
            attempt(controller, service, f'target-{index}', index)
            state = finish(controller, service)
            assert state['control_forecasts'][f'target-{index}']['status'] == 'scored'
        learned = forecast(controller, service, 'target-3')
        assert by_anatomy(learned)[first]['status'] == 'empirical' and by_anatomy(learned)[first]['leading_control_ids'] == ['open']
        assert state['snapshot']['model_id'] == 'baseline'
        # Control job entries keep digests only; the sealed artifacts live in the control fields.
        # Every read verifies them against the full requests recorded while pending and the retained artifacts.
        replay = controller.execute({'action': 'replay'})
        state, jobs = replay['state'], [job for job in replay['state']['jobs'] if job.get('control_binding')]
        assert len(jobs) == 7 and all(set(job['request']['parameters']) == {'sha256'} and job['result'] is None for job in jobs)
        nodes = {key: canonical(node) for key, node in replay['nodes'].items()}
        pending = [state_field(event, nodes, 'pending') for event in replay['events']]
        requests = {row['key']: row['request']['parameters'] for row in pending if (row or {}).get('control_binding')}
        receipts = {r['job_id']: r for r in state['control_receipts']}
        for job in jobs:
            assert job['request']['parameters']['sha256'] == _hash(requests[job['key']])
            receipt = receipts[job['job_id']]
            retained = receipt['result'] if receipt['operation'] == 'score_control_pcm' else state['control_forecasts'][receipt['forecast_id']]['artifact']
            assert job['result_sha256'] == _hash(retained)
            if receipt['operation'] == 'score_control_pcm': assert job['result_sha256'] == receipt['result_sha256']
        for field, value in (('result_sha256', '0' * 64), ('request', {**jobs[0]['request'], 'parameters': {'sha256': '0' * 64}})):
            tampered = deepcopy(state); next(job for job in tampered['jobs'] if job['key'] == jobs[0]['key'])[field] = value
            with pytest.raises(RuntimeError, match='digest does not match'):
                verify_ledger(tampered, replay['events'], nodes)

        # Callers cannot supply history, a snapshot or extra command fields.
        state = controller.execute({'action': 'state'})['state']
        forged = [receipt['result'] for receipt in state['control_receipts'] if receipt['result']][:1]
        with pytest.raises(ValueError, match='Invalid control forecast parameters'):
            send(controller, 'forecast_control', binding_id='delivered-cue', target_id='forged', parameters={'history': forged})
        with pytest.raises(ValueError, match='Unsupported session command fields'):
            send(controller, 'forecast_control', binding_id='delivered-cue', target_id='forged', parameters={}, history=forged)

        # Another wording never matches, so its forecast request carries none of this history.
        send(controller, 'declare_control_binding', binding_id='other-cue', binding={**BINDING, 'cue': cue('Sing a bright, easy ah.')})
        send(controller, 'forecast_control', binding_id='other-cue', target_id='other-target', parameters={})
        assert controller.execute({'action': 'state'})['state']['pending']['request']['parameters']['history'] == []
        state = finish(controller, service)
        assert state['control_forecasts']['target-3']['status'] == 'superseded'
        assert by_anatomy(state['control_forecasts']['other-target'])[first]['matched_attempts'] == 0
        assert state['control_receipts'][-2]['operation'] == 'supersede_control_forecast'

        # A successor model with pruned support keeps each surviving anatomy's history.
        state = register(controller, [FIRST], 'pruned-successor')
        assert state['control_forecasts']['other-target']['status'] == 'stale'
        with pytest.raises(ValueError, match='current committed forecast'):
            attempt(controller, service, 'other-target', 3)
        pruned = forecast(controller, service, 'target-pruned')
        assert by_anatomy(pruned) == {first: by_anatomy(learned)[first]}
        assert pruned['baseline_model_id'] == 'pruned-successor'


def test_bindings_are_immutable_and_unsuccessful_attempts_stay_uncounted(tmp_path):
    with JobService(tmp_path / 'jobs') as service:
        controller = SessionController(tmp_path / 'sessions', service, 'session')
        state = register(controller, [FIRST], 'baseline')
        first = _hash(state['snapshot']['hypotheses'][0]['anatomy'])
        with pytest.raises(ValueError, match='Declare the delivered cue binding'):
            send(controller, 'forecast_control', binding_id='delivered-cue', target_id='t', parameters={})
        send(controller, 'declare_control_binding', binding_id='delivered-cue', binding=BINDING)
        declared = controller.execute({'action': 'state'})['state']['control_bindings']['delivered-cue']
        send(controller, 'declare_control_binding', binding_id='delivered-cue', binding=BINDING)
        assert controller.execute({'action': 'state'})['state']['control_bindings']['delivered-cue'] == declared
        with pytest.raises(ValueError, match='cannot be rebound'):
            send(controller, 'declare_control_binding', binding_id='delivered-cue', binding={**BINDING, 'cue': cue('Sing a bright ee.')})
        with pytest.raises(ValueError, match='bank-wide nuisance'):
            send(controller, 'declare_control_binding', binding_id='gain-control', binding={**BINDING, 'controls': [{**c, 'gain': 1.} for c in CONTROLS]})

        forecast(controller, service, 'stopped-target')
        with pytest.raises(ValueError, match='follow session commitment'):
            send(controller, 'score_control', forecast_id='stopped-target', pcm=frame(FIRST, CONTROLS[1], 0),
                 metadata={**metadata('stopped-target', 0), 'evidenceAt': '2020-01-01T00:00:00+00:00'})
        send(controller, 'record_control_attempt', forecast_id='stopped-target', status='stopped', reason='Learner stopped for discomfort')
        with pytest.raises(ValueError, match='current committed forecast'):
            attempt(controller, service, 'stopped-target', 0)

        forecast(controller, service, 'superseded-target')
        forecast(controller, service, 'failed-target')
        assert controller.execute({'action': 'state'})['state']['control_forecasts']['superseded-target']['status'] == 'superseded'
        attempt(controller, service, 'failed-target', 1, sourceKind='human-observation')
        state = finish(controller, service, status='failed')
        assert state['control_forecasts']['failed-target']['status'] == 'failed'

        forecast(controller, service, 'silent-target')
        attempt(controller, service, 'silent-target', 2, pcm=[0.] * 4096)
        state = finish(controller, service)
        assert state['control_forecasts']['silent-target']['status'] == 'unscorable'

        receipts = [(r['operation'], r['forecast_id'], r['status']) for r in state['control_receipts']]
        assert ('record_control_attempt', 'stopped-target', 'stopped') in receipts
        assert ('score_control_pcm', 'failed-target', 'failed') in receipts
        assert ('score_control_pcm', 'silent-target', 'unscorable') in receipts
        later = forecast(controller, service, 'later-target')['artifact']['artifact']['execution_support']
        assert later['by_anatomy'][first]['matched_attempts'] == 0 and later['eligible_attempts'] == 0
        assert [row['attempt_id'] for row in later['excluded']] == ['attempt-2']
        with pytest.raises(ValueError, match='already used'):
            attempt(controller, service, 'later-target', 2)

        # A forecast frozen before the absolute-fit policy is refused before its capture is consumed.
        state = controller.execute({'action': 'state'})['state']
        old = deepcopy(state); frozen = old['control_forecasts']['later-target']['artifact']
        del frozen['artifact']['maximum_best_fit_square_sum']; frozen['sha256'] = _hash(frozen['artifact'])
        with pytest.raises(ValueError, match='predates the absolute-fit policy'):
            prepare(old, 'score_control', {'forecast_id': 'later-target', 'pcm': frame(FIRST, CONTROLS[1], 9), 'metadata': metadata('later-target', 9)})
        assert old['control_forecasts']['later-target']['status'] == 'committed'
        assert len(old['control_receipts']) == len(state['control_receipts'])

        # The score recomputation verifier reports control jobs by their digests and does not recompute them.
        report = recompute_session(controller.execute({'action': 'replay'}), session_id='session')
        control = [row for row in report['operations'] if row['operation'].endswith('control_pcm')]
        jobs = {job['job_id']: job for job in state['jobs']}
        assert control and all(row['status'] == 'unsupported_operation' and row['requestSha256'] is None
            and row['originalResultSha256'] == jobs[row['jobId']]['result_sha256']
            and row['requestParametersSha256'] == jobs[row['jobId']]['request']['parameters']['sha256'] for row in control)
