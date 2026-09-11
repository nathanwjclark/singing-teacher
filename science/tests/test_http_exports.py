import base64
import hashlib
import io
from scipy.io import wavfile
from test_http_service import server, request, wait


def test_actual_forward_http_exports_match_verified_native_files(server):
    payload = {'request': {'operation': 'forward', 'parameters': {'pose': 'a', 'duration_s': .1}}, 'idempotency_key': 'exports-test'}
    code, submitted = request(server, 'POST', '/jobs', payload)
    assert code == 202
    identity = submitted['id']
    assert wait(server, identity)['status'] == 'succeeded'
    code, exports = request(server, 'GET', f'/jobs/{identity}/exports')
    assert code == 200 and exports['job_id'] == identity
    assert set(exports['files']) == {'tract0.obj', 'tract0.mtl', 'tract.svg', 'geometry.json', 'manifest.json', 'audio.wav'}
    for name, record in exports['files'].items():
        data = base64.b64decode(record['base64'], validate=True)
        assert len(data) == record['byteLength']
        assert hashlib.sha256(data).hexdigest() == record['sha256']
        assert data == (server.jobs.root/'artifacts'/identity/'forward'/name).read_bytes()
    assert b'\nv ' in base64.b64decode(exports['files']['tract0.obj']['base64'])
    rate, pcm = wavfile.read(io.BytesIO(base64.b64decode(exports['files']['audio.wav']['base64'])))
    assert rate == 44100 and pcm.dtype == 'float32' and len(pcm) == round(.1*rate)
    (server.jobs.root/'artifacts'/identity/'forward'/'tract.svg').write_bytes(b'tampered')
    assert request(server, 'GET', f'/jobs/{identity}/exports')[0] == 409


def test_exports_unknown_cancelled_and_path_requests_fail(server):
    assert request(server, 'GET', '/jobs/'+'0'*32+'/exports')[0] == 404
    code, state = request(server, 'POST', '/jobs', {'request': {'operation': 'forward', 'parameters': {'pose': 'a', 'duration_s': .1}}, 'idempotency_key': 'cancel-exports'})
    assert code == 202
    assert request(server, 'POST', f"/jobs/{state['id']}/cancel", {})[1]['cancelled']
    assert request(server, 'GET', f"/jobs/{state['id']}/exports")[0] == 409
    assert request(server, 'GET', f"/jobs/{state['id']}/exports?path=../../etc/passwd")[0] == 400
