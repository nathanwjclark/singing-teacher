"""Read-path regressions preserve complete ledger verification without duplicate work."""
from copy import deepcopy
import hashlib
import http.client
import json
import threading

import pytest

from singing_physics.http_service import ScientificHTTPServer
from singing_physics.service import JobService, canonical
from singing_physics.session import SessionController, _ledger, read_ledger


def ledger(tmp_path):
    service=JobService(tmp_path/'jobs')
    controller=SessionController(tmp_path/'sessions',service,'read-test')
    state=controller.execute({'action':'state'})['state']
    with controller._db() as db:
        for i in range(4):
            # Each report exceeds the inline limit, so the ledger stores a root, a list and leaf nodes.
            state['sensations'].append({'text':'bounded fictional ledger payload '+str(i)+' '+'x'*1100})
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
        assert {k:v for k,v in second.items() if k not in ('events','nodes')}==original
        assert all(event['format']==2 for event in second['events']) and second['nodes']
        for event in second['events']:
            assert hashlib.sha256(canonical({k:v for k,v in event.items() if k!='sha256'}).encode()).hexdigest()==event['sha256']
    finally:service.close()


TOKEN='fictional-read-token-'+'x'*32
CAUSES={'body':'digest','chain':'chain','version':'format','format':'format','node_body':'node digest','node_rehash':KeyError,
    'node_deleted':KeyError,'orphan':'unreachable node','bad_tag':'Invalid ledger node','bad_child':'Invalid ledger node',
    'root_swapped':'root','root_version':'root','v1_after_v2':'v1 event'}


def tamper(db,session,kind):
    """Change stored rows the way a corrupted disk or a hand edit would; digests are recomputed where noted."""
    event=lambda version:json.loads(db.execute('SELECT body FROM events WHERE session=? AND version=?',(session,version)).fetchone()[0])
    def put(version,value):
        body=canonical(value)
        db.execute('INSERT OR REPLACE INTO events VALUES(?,?,?,?)',(session,version,body,hashlib.sha256(body.encode()).hexdigest()))
    def insert(body):db.execute('INSERT INTO nodes VALUES(?,?,?)',(session,hashlib.sha256(body.encode()).hexdigest(),body))
    leaf,body=db.execute("SELECT digest,body FROM nodes WHERE session=? AND body LIKE '%payload 0%'",(session,)).fetchone()
    last=event(4)
    if kind=='body':db.execute('UPDATE events SET body=body||? WHERE session=? AND version=2',(' ',session))
    elif kind=='chain':put(2,{**event(2),'previous_sha256':'f'*64})
    elif kind=='version':put(4,{**last,'version':5})
    elif kind=='format':put(4,{**last,'format':3})
    elif kind=='node_body':db.execute('UPDATE nodes SET body=? WHERE digest=?',(body.replace('payload 0','payload 9'),leaf))
    elif kind=='node_rehash':
        body=body.replace('payload 0','payload 9')
        db.execute('UPDATE nodes SET body=?,digest=? WHERE digest=?',(body,hashlib.sha256(body.encode()).hexdigest(),leaf))
    elif kind=='node_deleted':db.execute('DELETE FROM nodes WHERE digest=?',(leaf,))
    elif kind=='orphan':insert('["v","smuggled"]')
    elif kind=='bad_tag':insert('["x",1]')
    elif kind=='bad_child':insert('["l",[["v"]]]')
    elif kind=='root_swapped':
        # Also drop the nodes only the replaced root reached, so the version check alone must catch it.
        seen=set();stack=[event(v)['state_root'] for v in (1,2,3)]
        while stack:
            digest=stack.pop()
            if digest in seen:continue
            seen.add(digest);tag,value=json.loads(db.execute('SELECT body FROM nodes WHERE digest=?',(digest,)).fetchone()[0])
            stack+=[c[1] for c in (value.values() if tag=='d' else value if tag=='l' else ()) if c[0]=='h']
        for (digest,) in db.execute('SELECT digest FROM nodes WHERE session=?',(session,)).fetchall():
            if digest not in seen:db.execute('DELETE FROM nodes WHERE digest=?',(digest,))
        put(4,{**last,'state_root':event(3)['state_root']})
    elif kind=='root_version':
        root=json.loads(db.execute('SELECT body FROM nodes WHERE digest=?',(last['state_root'],)).fetchone()[0])
        root[1]['version']=['v',3];insert(canonical(root))
        db.execute('DELETE FROM nodes WHERE digest=?',(last['state_root'],))
        put(4,{**last,'state_root':hashlib.sha256(canonical(root).encode()).hexdigest()})
    else:
        state,previous,_,_=_ledger(db,session);state['version']=5
        put(5,{'session_id':session,'previous_sha256':previous,'action':'v1-after-v2','received_at':'2026-01-01T00:00:00+00:00','details':{},'state':state})


@pytest.mark.parametrize('kind',sorted(CAUSES))
def test_ledger_corruption_fails_closed_on_every_read_path(tmp_path,kind):
    service,controller=ledger(tmp_path)
    try:
        with controller._db() as db:
            tags=[json.loads(body)[0] for (body,) in db.execute('SELECT body FROM nodes')]
            assert {'d','l','v'}<=set(tags)  # Root, list and leaf nodes: every tamper below has a real tree to break.
            tamper(db,controller.session_id,kind)
        reads=[lambda:controller.execute({'action':'state'}),lambda:controller.execute({'action':'replay'}),lambda:read_ledger(tmp_path/'sessions',controller.session_id)]
        for read in reads:
            with pytest.raises(RuntimeError,match='Session ledger integrity failure') as failure:read()
            cause=failure.value.__cause__
            assert isinstance(cause,KeyError) if CAUSES[kind] is KeyError else str(cause)==CAUSES[kind]
        with ScientificHTTPServer(tmp_path,TOKEN,port=0) as server:
            threading.Thread(target=server.serve_forever,daemon=True).start()
            try:
                for route in ('ledger','state','replay'):
                    connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=30)
                    connection.request('GET',f'/sessions/{controller.session_id}/{route}',headers={'Authorization':'Bearer '+TOKEN})
                    response=connection.getresponse()
                    assert (response.status,json.loads(response.read()))==(409,{'error':'Session ledger integrity failure'}),route
                    connection.close()
            finally:server.shutdown()
    finally:service.close()
