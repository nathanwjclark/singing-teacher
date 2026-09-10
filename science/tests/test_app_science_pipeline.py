"""Real app POST -> native capture -> shared session owner -> app geometry."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.request

from singing_physics.http_service import ScientificHTTPServer
from test_live_capture_jobs import capture


def test_app_run_publishes_shared_session_and_verified_model(tmp_path):
    root=Path(__file__).parents[2]
    data=tmp_path/'app';data.mkdir()
    source=capture(data)
    (data/'science-input.json').write_text(json.dumps({'sourceDirectory':source.name,'evidenceKind':'development-fixture'}))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    with ScientificHTTPServer(tmp_path/'worker','t'*48,port=0) as worker:
        thread=threading.Thread(target=worker.serve_forever,daemon=True);thread.start()
        env={**os.environ,'PORT':str(port),'HOST':'127.0.0.1','LOCAL_DATA_DIR':str(data),
             'SINGING_PYTHON':sys.executable,'SCIENCE_URL':f'http://127.0.0.1:{worker.server_port}','SCIENCE_TOKEN':'t'*48}
        with (tmp_path/'app.log').open('w') as log:
            app=subprocess.Popen(['node','server/local.mjs'],cwd=root,env=env,stdout=log,stderr=log)
            def call(path,post=False):
                request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,method='POST' if post else 'GET')
                with urllib.request.urlopen(request,timeout=10) as response:
                    return json.load(response)
            try:
                for _ in range(100):
                    try:
                        call('/api/science/health');break
                    except OSError:
                        assert app.poll() is None
                        time.sleep(.1)
                else: raise AssertionError('App did not become ready')
                started=call('/api/science/run',True)
                assert started['status']=='running'
                deadline=time.monotonic()+120
                while time.monotonic()<deadline:
                    state=call('/api/science/status')
                    if state['status']!='running':break
                    time.sleep(.1)
                assert state['status']=='succeeded',state
                result=state['result']
                assert result['source']=='development-fixture'
                session=call('/api/science/sessions/'+result['sessionId']+'/state')['state']
                assert session['snapshot']['model_id']==result['modelId']
                assert session['designs'][result['designId']]['data']==result['forecast']
                assert result['forecast']['profile']['sample_rate_hz']==48000
                geometry=call('/api/science/asset?run='+started['runId']+'&name=geometry.json')
                assert geometry
                assert not (data/'science-runs'/started['runId']/'jobs').exists()
            finally:
                app.terminate()
                try: app.wait(timeout=5)
                except subprocess.TimeoutExpired: app.kill();app.wait()
                worker.shutdown();thread.join()
