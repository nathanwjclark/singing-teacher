"""Session ledger storage: content-addressed format 2 events next to recorded full-state (v1) ledgers.

The golden fixture is synthetic evidence (software correctness only): the rows of
science/scripts/measure_control_ledger.py with 1 anatomy and 1 round, recorded before
content-addressed events existed, with that code's response hashes.
"""
from contextlib import closing
import gzip
import hashlib
import http.client
import json
from pathlib import Path
import sqlite3
import sys
import threading

import pytest

from singing_physics.http_service import ScientificHTTPServer
from singing_physics.service import JobService, canonical
from singing_physics.session import SessionController, _root, _split, join, read_ledger

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from recompute_session_score import verify_replay

GOLDEN = json.loads(gzip.decompress((Path(__file__).parent/'fixtures/session-ledger-v1.json.gz').read_bytes()))
TOKEN = 'fictional-ledger-token-'+'x'*32


def sha(data): return hashlib.sha256(data).hexdigest()
def compact(value): return json.dumps(value, allow_nan=False, separators=(',', ':')).encode()


def recorded(root):
    """Write the golden rows into a session database created by the current controller."""
    with JobService(root/'jobs') as service: SessionController(root/'sessions', service, GOLDEN['session_id'])
    with sqlite3.connect(root/'sessions/sessions.sqlite3') as db:
        db.executemany('INSERT INTO events VALUES(?,?,?,?)', [(GOLDEN['session_id'], *row) for row in GOLDEN['events']])
        db.executemany('INSERT INTO commands VALUES(?,?,?)', [(GOLDEN['session_id'], *row) for row in GOLDEN['commands']])
    return root


def routes(root, *names):
    with ScientificHTTPServer(root, TOKEN, port=0) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            def get(name):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=60)
                connection.request('GET', f"/sessions/{GOLDEN['session_id']}/{name}", headers={'Authorization': 'Bearer '+TOKEN})
                response = connection.getresponse(); body = response.read(); connection.close()
                return response.status, body
            return {name: get(name) for name in names}
        finally: server.shutdown()


def test_recorded_v1_ledger_reads_byte_identically(tmp_path):
    root, expected = recorded(tmp_path), GOLDEN['expected']
    with JobService(root/'jobs') as service:
        replay = SessionController(root/'sessions', service, GOLDEN['session_id']).execute({'action': 'replay'})
    assert sha(compact(replay)) == expected['replay_sha256'] and replay['ledger_sha256'] == expected['ledger_sha256']
    assert sha(canonical(replay['state']).encode()) == expected['state_sha256']
    assert [sha(canonical(event['state']).encode()) for event in replay['events']] == expected['version_state_sha256']
    assert sha(compact(read_ledger(root/'sessions', GOLDEN['session_id']))) == expected['ledger_sha256_route']
    assert verify_replay(replay, GOLDEN['session_id'], expected['ledger_sha256']) == expected['ledger_sha256']
    served = routes(root, 'ledger', 'replay', 'state')
    assert {name: (status, sha(body)) for name, (status, body) in served.items()} == {
        'ledger': (200, expected['ledger_sha256_route']), 'replay': (200, expected['replay_sha256']), 'state': (200, expected['state_sha256_route'])}
    # Reading never rewrote a recorded row.
    with sqlite3.connect(root/'sessions/sessions.sqlite3') as db:
        assert [list(row) for row in db.execute('SELECT version,body,digest FROM events ORDER BY version')] == GOLDEN['events']


@pytest.mark.parametrize('kind', ['body', 'chain', 'state_version'])
def test_recorded_v1_corruption_is_still_detected(tmp_path, kind):
    root = recorded(tmp_path)
    with sqlite3.connect(root/'sessions/sessions.sqlite3') as db:
        body = GOLDEN['events'][1][1]; event = json.loads(body)
        if kind == 'body': body += ' '
        else:
            if kind == 'chain': event['previous_sha256'] = 'f'*64
            else: event['state']['version'] = 3
            body = canonical(event)
        db.execute('UPDATE events SET body=?,digest=? WHERE version=2', (body, GOLDEN['events'][1][2] if kind == 'body' else sha(body.encode())))
    with pytest.raises(RuntimeError, match='Session ledger integrity failure') as failure:
        read_ledger(root/'sessions', GOLDEN['session_id'])
    assert str(failure.value.__cause__) == {'body': 'digest', 'chain': 'chain', 'state_version': 'v1 event'}[kind]


def test_format_2_events_extend_a_recorded_v1_ledger(tmp_path):
    root, session = recorded(tmp_path), GOLDEN['session_id']
    with JobService(root/'jobs') as service:
        controller = SessionController(root/'sessions', service, session)
        before = controller.execute({'action': 'replay'})
        # A real command: re-registering the identical frozen model appends one event.
        controller.execute({'action': 'register_model', 'command_id': 'mixed-ledger', 'expected_version': 8, 'snapshot': before['state']['snapshot']})
        replay = controller.execute({'action': 'replay'})
    with sqlite3.connect(root/'sessions/sessions.sqlite3') as db:
        assert [list(row) for row in db.execute('SELECT version,body,digest FROM events WHERE version<=8 ORDER BY version')] == GOLDEN['events']
    assert replay['events'][:8] == before['events'] and 'nodes' not in before and replay['nodes']
    upgraded = replay['events'][8]
    assert set(upgraded) == {'format', 'session_id', 'version', 'previous_sha256', 'action', 'received_at', 'details', 'state_root', 'sha256'}
    assert (upgraded['format'], upgraded['version'], upgraded['previous_sha256']) == (2, 9, GOLDEN['expected']['ledger_sha256'])
    assert replay['state'] == {**before['state'], 'version': 9}
    assert verify_replay(replay, session, replay['ledger_sha256']) == replay['ledger_sha256']
    assert compact(read_ledger(root/'sessions', session)) == compact(replay)
    # No full-state event may follow a format 2 event.
    body = canonical({'session_id': session, 'previous_sha256': replay['ledger_sha256'], 'action': 'v1-after-v2',
                      'received_at': '2026-01-01T00:00:00+00:00', 'details': {}, 'state': {**replay['state'], 'version': 10}})
    with sqlite3.connect(root/'sessions/sessions.sqlite3') as db:
        db.execute('INSERT INTO events VALUES(?,?,?,?)', (session, 10, body, sha(body.encode())))
    with pytest.raises(RuntimeError, match='Session ledger integrity failure'): read_ledger(root/'sessions', session)


VALUES = {
    'tiny': {'session_id': 's', 'version': 1, 'pending': None, 'jobs': []},
    'floats': {'pcm': [1e-05, -0.0, 0.1, 1e300, -2.5e-310, 3, -7] * 200, 'scalars': [1e-05, -0.0]},
    'text': {'reports': ['Kehlkopf \u00e9 \u4e2d \U0001d11e \u2028 "quoted" \\ ' * 60, 'ascii'], 'short': '\U0001d11e'},
    'empty': {'dict': {}, 'list': [], 'rows': [{}, [], '', {'nested': []}] * 300, 'large': [[] for _ in range(600)]},
    'keys': {'outer': {1: 'x' * 1500, 2: {3: [0.5] * 300, 4: None}}, 'flat': {7: True, 8: False}},
    'list_root': [{'value': 'y' * 1100}, {'value': 'y' * 1100}, 1, None],
}


@pytest.mark.parametrize('name', sorted(VALUES))
def test_split_and_join_round_trip_canonical_json(name):
    value, nodes = VALUES[name], {}
    root = _root(value, nodes)
    assert _split(value, {})[0] == canonical(value)
    assert all(sha(body.encode()) == digest for digest, body in nodes.items())
    assert canonical(join(root, nodes)) == canonical(value)
    assert name in ('tiny', 'text') or len(nodes) > 1  # Large values really are split into several nodes.


def test_every_recorded_version_round_trips():
    for (version, body, _), expected in zip(GOLDEN['events'], GOLDEN['expected']['version_state_sha256']):
        state, nodes = json.loads(body)['state'], {}
        assert sha(canonical(join(_root(state, nodes), nodes)).encode()) == expected, version


def test_identical_large_values_share_one_node_and_read_back_detached(tmp_path):
    design = {'data': {'values': [0.25] * 400}, 'status': 'committed', 'committed_at': '2026-01-01T00:00:00+00:00'}
    with JobService(tmp_path/'jobs') as service:
        controller = SessionController(tmp_path/'sessions', service, 'alias-test')
        state = controller.execute({'action': 'state'})['state']
        state['designs'] = {'first': design, 'second': json.loads(json.dumps(design))}
        with controller._db() as db: controller._append(db, state, 'alias-fixture', {})
        replay = controller.execute({'action': 'replay'})
        [designs] = [node[1] for node in replay['nodes'].values() if node[0] == 'd' and set(node[1]) == {'first', 'second'}]
        assert designs['first'] == designs['second'] and designs['first'][0] == 'h'
        read = controller.execute({'action': 'state'})['state']
    read['designs']['first']['status'] = 'stale'; read['designs']['first']['data']['values'].append(1.)
    assert read['designs']['second'] == design and replay['state']['designs']['first'] == design


def test_database_written_before_nodes_table_reads_without_changes(tmp_path):
    path = tmp_path/'sessions'; path.mkdir()
    with closing(sqlite3.connect(path/'sessions.sqlite3')) as db, db:
        db.execute('CREATE TABLE events(session TEXT, version INTEGER, body TEXT, digest TEXT, PRIMARY KEY(session,version))')
        db.execute('CREATE TABLE commands(session TEXT, id TEXT, digest TEXT, PRIMARY KEY(session,id))')
        db.executemany('INSERT INTO events VALUES(?,?,?,?)', [(GOLDEN['session_id'], *row) for row in GOLDEN['events']])
    stored = (path/'sessions.sqlite3').read_bytes()
    assert sha(compact(read_ledger(path, GOLDEN['session_id']))) == GOLDEN['expected']['ledger_sha256_route']
    assert (path/'sessions.sqlite3').read_bytes() == stored and [p.name for p in path.iterdir()] == ['sessions.sqlite3']
