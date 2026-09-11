"""Session ledger storage: recorded full-state (v1) ledgers read back byte-identically.

The golden fixture is synthetic evidence (software correctness only): the rows of
science/scripts/measure_control_ledger.py with 1 anatomy and 1 round, recorded before
content-addressed events existed, with that code's response hashes.
"""
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
from singing_physics.session import SessionController, read_ledger

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
