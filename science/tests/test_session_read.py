"""Read-path regressions preserve complete ledger verification without duplicate work."""
from copy import deepcopy
import hashlib
import json

import pytest

from singing_physics.service import JobService, canonical
from singing_physics.session import SessionController


def ledger(tmp_path):
    service=JobService(tmp_path/'jobs')
    controller=SessionController(tmp_path/'sessions',service,'read-test')
    state=controller.execute({'action':'state'})['state']
    with controller._db() as db:
        for i in range(4):
            state['sensations'].append({'text':'bounded fictional ledger payload '+str(i)})
            controller._append(db,state,'read-fixture',{'sequence':i})
    return service,controller


def test_idle_state_and_replay_verify_once_and_return_detached_state(tmp_path,monkeypatch):
    service,controller=ledger(tmp_path)
    try:
        real=controller._read;calls=[]
        def counted(db):
            calls.append(1)
            return real(db)
        monkeypatch.setattr(controller,'_read',counted)
        first=controller.execute({'action':'state'})
        assert len(calls)==1 and first['state']['version']==4
        original=deepcopy(first)
        first['state']['sensations'].clear()
        calls.clear();second=controller.execute({'action':'replay'})
        assert len(calls)==1 and len(second['events'])==4
        assert {k:v for k,v in second.items() if k!='events'}==original
        for event in second['events']:
            assert hashlib.sha256(canonical({k:v for k,v in event.items() if k!='sha256'}).encode()).hexdigest()==event['sha256']
    finally:service.close()


@pytest.mark.parametrize('tamper',['body','chain','version'])
def test_old_event_corruption_is_still_detected(tmp_path,tamper):
    service,controller=ledger(tmp_path)
    try:
        with controller._db() as db:
            body=db.execute('SELECT body FROM events WHERE session=? AND version=2',(controller.session_id,)).fetchone()[0]
            event=json.loads(body)
            if tamper=='body':
                body=body+' '
                db.execute('UPDATE events SET body=? WHERE session=? AND version=2',(body,controller.session_id))
            else:
                if tamper=='chain':event['previous_sha256']='f'*64
                else:event['state']['version']=3
                body=canonical(event)
                db.execute('UPDATE events SET body=?,digest=? WHERE session=? AND version=2',
                    (body,hashlib.sha256(body.encode()).hexdigest(),controller.session_id))
        with pytest.raises(RuntimeError,match='ledger integrity'):
            controller.execute({'action':'state'})
    finally:service.close()
