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
import urllib.request

from singing_physics.http_service import ScientificHTTPServer
from singing_physics.engine import Engine
from singing_physics.pcm_inverse import resample_native_pcm
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
                # A later native capture reaches the actual update through the app,
                # without hand-building a session export, command ID or digest.
                design=result['forecast'];selected=design['selected_experiment_id']
                assert selected is not None
                experiment=next(row['experiment'] for row in design['rankings'] if row['experiment']['experiment_id']==selected)
                later_root=data/'later';later_root.mkdir();later=capture(later_root)
                with Engine() as engine:
                    engine.set_anatomy(result['anatomy'])
                    audio=engine.synthesize(experiment['pose'],{'JA':experiment['JA']},f0_hz=experiment['f0_hz'],duration_s=.6)
                    pcm,_=resample_native_pcm(audio*experiment['gain'],44100,48000)
                raw=pcm.astype('<f4').tobytes();(later/'audio.pcm.raw').write_bytes(raw)
                manifest=json.loads((later/'manifest.json').read_text())
                manifest['capture_id']='later-native-software-test'
                manifest['created_at']=datetime.now(timezone.utc).isoformat()
                manifest['audio']['samples'][0]['artifact'].update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
                (later/'manifest.json').write_text(json.dumps(manifest))
                (data/'science-outcome-input.json').write_text(json.dumps({
                    'sourceDirectory':str(later.relative_to(data)),'pose':experiment['pose'],'segment_index':0,
                    'participant_id':'software-participant','evidence_kind':'development-fixture',
                    'recording_kind':'ordinary-singing','contains_external_excitation':False}))
                outcome=call('/api/science/outcome',True)
                assert outcome['status']=='running'
                deadline=time.monotonic()+60
                while time.monotonic()<deadline:
                    scored=call('/api/science/outcome')
                    if scored['status']!='running':break
                    time.sleep(.1)
                assert scored['status']=='succeeded',scored
                updated=call('/api/science/sessions/'+result['sessionId']+'/state')['state']
                assert updated['snapshot']['model_id']!=result['modelId']
                assert design['target_observation_id'] in updated['snapshot']['evidence_ids']
                assert scored['result']['modelId']==updated['snapshot']['model_id']
                retry=call('/api/science/outcome',True)
                assert retry['outcomeId']==outcome['outcomeId'] and retry['status']=='succeeded'
                assert call('/api/science/sessions/'+result['sessionId']+'/state')['state']['version']==updated['version']
            finally:
                app.terminate()
                try: app.wait(timeout=5)
                except subprocess.TimeoutExpired: app.kill();app.wait()
                worker.shutdown();thread.join()
