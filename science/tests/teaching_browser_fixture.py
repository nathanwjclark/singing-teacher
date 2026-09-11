"""Native browser acceptance fixture; generated evidence and seeded decision, no paid model."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
import threading
import time

from singing_physics.service import JobService
from singing_physics.http_service import ScientificHTTPServer
from singing_physics.session import SessionController
from singing_physics.engine import Engine
from singing_physics.pcm_inverse import FEATURES,resample_native_pcm
from test_session_source import setup_source
from test_session import send,collect


def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


def main():
    def stop(_signal,_frame):raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop)
    root=Path(sys.argv[1]);root.mkdir();jobs=root/'jobs';session_id='session'
    with JobService(jobs) as service:
        controller=SessionController(jobs/'sessions',service,session_id)
        baseline,_,_=setup_source(controller)
        send(controller,'propose_design',parameters={'design_id':'design','target_observation_id':'future',
            'experiments':[{'experiment_id':p,'pose':p,'JA':-3.,'f0_hz':180.,'gain':4.} for p in ['a','e']],
            'profile':{'sample_rate_hz':48000,'frame_start_sample':4800,'frame_size':4096,'duration_s':.25},
            'feature_scales':{key:{'unit':unit,'scale':scale,'assumption':'Software fixture engineering scale'} for key,(unit,scale) in FEATURES.items()},'max_synthesis_calls':2})
        collect(controller,service)
        send(controller,'select_experiment',source_design_id='design',design_id='selected',target_observation_id='later',experiment_id='a',selection_reason='Generated software acceptance fixture')
        state=controller.execute({'action':'state'})['state']
    directory=root/'science-runs/run-test';directory.mkdir(parents=True)
    (root/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'run-test'}))
    (directory/'summary.json').write_text(json.dumps({'sessionId':session_id,'modelId':'baseline','designId':'selected','files':{},'forecast':state['designs']['selected']['data']}))
    decisions=root/'astra-decisions'/session_id;decisions.mkdir(parents=True)
    (decisions/'fixture.json').write_text(json.dumps({'status':'succeeded','requestId':'fixture','createdAt':datetime.now(timezone.utc).isoformat(),'completedAt':datetime.now(timezone.utc).isoformat(),'sessionId':session_id,'runId':'run-test','modelId':'baseline','designId':'selected','provider':'seeded-software-fixture','model':'no-live-model-call','decision':{'action':'record','experimentId':'a','cue':'Sing a comfortable ah.','explanation':'Software fixture with a real committed numerical prediction.','demonstrationId':'tongue-jaw-vowels','cueId':None}}))
    token='browser-fixture-token-'+'a'*32;worker=ScientificHTTPServer(str(jobs),token,port=0)
    thread=threading.Thread(target=worker.serve_forever,daemon=True);thread.start()
    app_port=port();env={**os.environ,'OPENAI_API_KEY':'','OPENAI_ENV_FILE':'/dev/null','PORT':str(app_port),'HOST':'127.0.0.1','LOCAL_DATA_DIR':str(root),'SCIENCE_URL':f'http://127.0.0.1:{worker.server_port}','SCIENCE_TOKEN':token,'VISUAL_TEACHING_MODEL_ENABLED':'1','VISUAL_TEACHING_AUDIO_ENABLED':'1','OPENAI_ENV_FILE':str(root/'absent.env')}
    app=subprocess.Popen(['node','server/local.mjs'],cwd=Path.cwd(),env=env,stdout=subprocess.DEVNULL,stderr=sys.stderr)
    print(json.dumps({'port':app_port}),flush=True)
    try:
        while not (root/'quit').exists():
            if (root/'score').exists() and not (root/'scored').exists():
                controller=SessionController(jobs/'sessions',worker.jobs,session_id)
                with Engine() as engine:
                    engine.set_anatomy(baseline['hypotheses'][0]['anatomy']);audio=engine.synthesize('a',{'JA':-3.},f0_hz=180.,duration_s=.25)*4
                    native,_=resample_native_pcm(audio,44100,48000)
                send(controller,'submit_outcome',design_id='selected',parameters={'experiment_id':'a','observation_id':'later','artifact_id':'heldout-browser-fixture','observed_at':datetime.now(timezone.utc).isoformat(),'pcm':native[4800:8896].tolist(),'source_kind':'engine-generated','sample_rate_hz':48000,'frame_start_sample':4800,'frame_size':4096})
                collect(controller,worker.jobs);(root/'scored').write_text('complete')
            time.sleep(.05)
    finally:
        app.terminate();app.wait(timeout=10);worker.shutdown();worker.server_close()


if __name__=='__main__':main()
