import http.client
import json
import threading
import time

import pytest

from singing_physics.http_service import ScientificHTTPServer

TOKEN = 'fictional-test-token-'+'x'*32


@pytest.fixture
def server(tmp_path):
    instance = ScientificHTTPServer(tmp_path/'jobs', TOKEN, max_body_bytes=20_000)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    try:
        yield instance
    finally:
        instance.shutdown(); thread.join(timeout=5); instance.server_close()


def request(server, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=30)
    payload = json.dumps(body) if body is not None else None
    values = {'Authorization': 'Bearer '+TOKEN}
    if payload is not None:
        values['Content-Type'] = 'application/json'
    values.update(headers or {})
    connection.request(method, path, payload, values)
    response = connection.getresponse()
    result = response.status, json.loads(response.read())
    connection.close()
    return result


def wait(server, identity):
    deadline = time.monotonic()+30
    while time.monotonic()<deadline:
        code, state = request(server, 'GET', '/jobs/'+identity)
        assert code == 200
        if state['status'] in ('succeeded', 'failed', 'cancelled'):
            return state
        time.sleep(.03)
    raise TimeoutError(identity)


def test_actual_http_native_job_result_capabilities_and_idempotency(server):
    assert request(server,'GET','/health')[1]['status']=='ready'
    code, capabilities = request(server,'GET','/capabilities')
    assert code == 200 and capabilities['engine'] == 'VocalTractLab'
    assert capabilities['provenance']['geometry_basis']
    body={'request':{'operation':'forward','parameters':{'pose':'a','duration_s':.1}},'idempotency_key':'forward-test'}
    code, submitted=request(server,'POST','/jobs',body)
    assert code==202
    assert request(server,'POST','/jobs',body)[1]['id']==submitted['id']
    assert wait(server,submitted['id'])['status']=='succeeded'
    code,result=request(server,'GET',f"/jobs/{submitted['id']}/result")
    assert code==200 and result['kind']=='synthetic_forward_export'
    assert 'audio.wav' in result['files']


def test_auth_host_origin_and_body_are_checked(server):
    assert request(server,'GET','/health',headers={'Authorization':'Bearer wrong'})[0]==401
    assert request(server,'GET','/capabilities',headers={'Host':'attacker.example'})[0]==403
    assert request(server,'POST','/models',{'session_id':'s','model_id':'m'},headers={'Origin':'https://attacker.example'})[0]==403
    assert request(server,'POST','/jobs',{'large':'x'*20_000})[0]==413
    assert request(server,'POST','/jobs',[])[0]==400
    assert request(server,'POST','/jobs',{'request':{'operation':'forward','parameters':{'output':'/tmp/forbidden'}},'idempotency_key':'path'})[0]==400
    assert request(server,'GET','/jobs/../../etc/passwd')[0]==404
    assert request(server,'GET','/health?token=anything')[0]==400


def test_stale_registration_cancel_and_unknown_job(server):
    assert request(server,'POST','/models',{'session_id':'session','model_id':'current'})[0]==200
    body={'request':{'operation':'forward','session_id':'session','model_id':'old','parameters':{}},'idempotency_key':'stale'}
    assert request(server,'POST','/jobs',body)[0]==409
    body['request']['model_id']='current'
    code,state=request(server,'POST','/jobs',body)
    assert code==202
    assert request(server,'POST',f"/jobs/{state['id']}/cancel",{})[1]['cancelled'] is True
    assert wait(server,state['id'])['status']=='cancelled'
    assert request(server,'GET',f"/jobs/{state['id']}/result")[0]==409
    assert request(server,'GET','/jobs/'+'0'*32)[0]==404


def test_reject_nonloopback_and_weak_tokens(tmp_path):
    for options in ({'token':'short'}, {'token':TOKEN,'host':'0.0.0.0'}, {'token':TOKEN,'max_body_bytes':-1}):
        with pytest.raises(ValueError):
            ScientificHTTPServer(tmp_path,**options)


def test_session_state_replay_and_stale_command(server):
    code,initial=request(server,'GET','/sessions/research-session')
    assert code==200 and initial['state']['version']==0
    command={'action':'record_sensation','command_id':'sensation-command','expected_version':99,
             'attempt_id':'absent-attempt','text':'fictional test sensation'}
    code,error=request(server,'POST','/sessions/research-session/commands',command)
    assert code==409 and error['error']=='stale_session_version'
    assert request(server,'GET','/sessions/research-session/replay')[1]['events']==[]
    assert request(server,'POST','/sessions/research-session/commands',{'action':'run','path':'/tmp/arbitrary'})[0]==400
