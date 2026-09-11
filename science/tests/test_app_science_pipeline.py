"""Real app POST -> native capture -> shared session owner -> app geometry."""
import json
import hashlib
from datetime import datetime, timezone
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

from singing_physics.http_service import ScientificHTTPServer
from test_live_capture_jobs import capture


def test_app_run_publishes_shared_session_and_verified_model(tmp_path):
    root=Path(__file__).parents[2]
    data=tmp_path/'app';data.mkdir()
    source=capture(data)
    # USB transport is simulated with generated native bytes; there is no device
    # or human evidence in this software test. App preparation is real.
    initial=json.loads((source/'manifest.json').read_text())
    initial['capture_id']='00000000-0000-4000-8000-000000000001'
    (source/'manifest.json').write_text(json.dumps(initial))
    def publish_capture(directory):
        manifest=json.loads((directory/'manifest.json').read_text())
        imports=data/'usb-imports';imports.mkdir(exist_ok=True)
        archive=imports/('capture-'+manifest['capture_id']+'.zip')
        with zipfile.ZipFile(archive,'w') as zipped:
            for file in directory.iterdir():zipped.write(file,file.name)
        (data/'native-pull-latest.json').write_text(json.dumps({'name':archive.name,
            'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
    publish_capture(source)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    with ScientificHTTPServer(tmp_path/'worker','t'*48,port=0) as worker:
        thread=threading.Thread(target=worker.serve_forever,daemon=True);thread.start()
        env={**os.environ,'PORT':str(port),'HOST':'127.0.0.1','LOCAL_DATA_DIR':str(data),
             'SINGING_PYTHON':sys.executable,'SCIENCE_URL':f'http://127.0.0.1:{worker.server_port}','SCIENCE_TOKEN':'t'*48}
        with (tmp_path/'app.log').open('w') as log:
            app=subprocess.Popen(['node','server/local.mjs'],cwd=root,env=env,stdout=log,stderr=log)
            def call(path,post=False,body=None):
                request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,method='POST' if post else 'GET',
                    data=json.dumps(body).encode() if body is not None else None,
                    headers={'Content-Type':'application/json'} if body is not None else {})
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
                assert call('/api/science/use-latest-capture',True,{
                    'purpose':'calibration','pose':'a','contains_external_excitation':False})['prepared']
                started=call('/api/science/run',True)
                assert started['status']=='running'
                deadline=time.monotonic()+120
                while time.monotonic()<deadline:
                    state=call('/api/science/status')
                    if state['status']!='running':break
                    time.sleep(.1)
                assert state['status']=='succeeded',state
                result=state['result']
                assert result['source']=='human-observation'  # Caller declaration, not authentication.
                session=call('/api/science/sessions/'+result['sessionId']+'/state')['state']
                assert session['snapshot']['model_id']==result['modelId']
                assert session['designs'][result['designId']]['data']==result['forecast']
                assert result['forecast']['profile']['sample_rate_hz']==48000
                geometry=call('/api/science/asset?run='+started['runId']+'&name=geometry.json')
                assert geometry
                assert not (data/'science-runs'/started['runId']/'jobs').exists()
                # The default protocol forecasts library a/e/i for its fixed finite
                # search support. With no experiment separating that support the
                # design is frozen as unsupported: there is no recording decision,
                # and a later capture cannot be scored or change the model. The
                # scored update through the app is covered with an explicitly
                # selected experiment in test_app_astra_loop.py.
                design=result['forecast']
                assert design['selected_experiment_id'] is None
                assert session['designs'][result['designId']]['status']=='unsupported'
                assert all(row['status']!='separated_at_assumed_threshold' for row in design['rankings'])
                current=call('/api/science/status')['result']
                assert current['recordingAllowed'] is False
                later_root=data/'later';later_root.mkdir();later=capture(later_root)
                manifest=json.loads((later/'manifest.json').read_text())
                manifest['capture_id']='00000000-0000-4000-8000-000000000002'
                manifest['created_at']=datetime.now(timezone.utc).isoformat()
                (later/'manifest.json').write_text(json.dumps(manifest))
                publish_capture(later)
                refusals=[]
                for path,body in (('/api/science/use-latest-capture',{'purpose':'outcome','pose':'a','contains_external_excitation':False}),('/api/science/outcome',None)):
                    try:
                        call(path,True,body);raise AssertionError(path+' accepted a capture without a recording decision')
                    except urllib.error.HTTPError as error:
                        refusals.append((error.code,json.load(error)['error']))
                assert refusals==[(409,current['recordingMessage']),(409,'No later voice capture configured')]
                assert call('/api/science/outcome')['status']=='not-run'
                assert call('/api/science/sessions/'+result['sessionId']+'/state')['state']==session
            finally:
                app.terminate()
                try: app.wait(timeout=5)
                except subprocess.TimeoutExpired: app.kill();app.wait()
                worker.shutdown();thread.join()
