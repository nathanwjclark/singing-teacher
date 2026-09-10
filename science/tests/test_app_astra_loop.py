"""Two real native update rounds with a deterministic, explicitly test-only brain.

By default no API key or .env is read. Explicit SINGING_TEST_LIVE_ASTRA_ENV opts
into two live decisions using that server env file; there are no paid retries.
This verifies application wiring, not human anatomy. Audio is synthesized.
"""
import hashlib
import json
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

from singing_physics.engine import Engine
from singing_physics.http_service import ScientificHTTPServer
from singing_physics.pcm_inverse import resample_native_pcm
from test_live_capture_jobs import capture


BOOTSTRAP = r"""
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const repo=process.cwd(),dataRoot=process.env.LOCAL_DATA_DIR;
const load=name=>import(pathToFileURL(resolve(repo,'server',name)));
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
let provider={getProviderStatus:()=>({available:true,provider:'test-only'}),generateDecision:async({input})=>({
  decision:{action:'record',experimentId:input.forecast.experiments.at(-1).experiment.experiment_id,
    cue:'Comfortably sustain the selected vowel.',explanation:'Deterministic integration-test selection; not a live coaching recommendation.'},
  provider:'test-only',model:'deterministic-test-fixture',usage:{}})};
if(process.env.SINGING_TEST_LIVE_ASTRA_ENV){
  process.env.OPENAI_ENV_FILE=process.env.SINGING_TEST_LIVE_ASTRA_ENV;
  await load('environment.mjs');provider=await load('astraProvider.mjs');
}
const routes=[(await load('astra.mjs')).createAstraRoutes({dataRoot,json,provider}),
  (await load('science.mjs')).scienceRoutes({repo,dataRoot,json}),
  (await load('voiceCapture.mjs')).createVoiceCaptureRoutes({repo,dataRoot,json})];
const proxy=(await load('science-proxy.mjs')).createScienceProxy({url:process.env.SCIENCE_URL,token:process.env.SCIENCE_TOKEN});
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
  for(const route of routes)if(await route(req,res,url))return;
  if(url.pathname.startsWith('/api/science/'))return proxy(req,res);
  json(res,404,{error:'No test route'});
}catch(e){json(res,500,{error:e.message})}}).listen(Number(process.env.PORT),'127.0.0.1');
"""


def test_astra_two_round_native_loop_survives_restart_without_duplicate_update(tmp_path):
    root = Path(__file__).parents[2]
    data = tmp_path / 'app'
    data.mkdir()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]

    def publish(directory):
        manifest = json.loads((directory / 'manifest.json').read_text())
        imports = data / 'usb-imports'
        imports.mkdir(exist_ok=True)
        archive = imports / ('capture-' + manifest['capture_id'] + '.zip')
        with zipfile.ZipFile(archive, 'w') as zipped:
            for file in directory.iterdir():
                zipped.write(file, file.name)
        (data / 'native-pull-latest.json').write_text(json.dumps({
            'name': archive.name, 'bytes': archive.stat().st_size,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))

    def call(path, body=None):
        request = urllib.request.Request(f'http://127.0.0.1:{port}' + path,
            method='GET' if body is None else 'POST',
            data=None if body is None or body is False else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise AssertionError(f'{path}: HTTP {error.code}: {error.read().decode()}') from error

    def wait_completed(path):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            result = call(path)
            if result['status'] != 'running':
                assert result['status'] == 'succeeded', result
                return result
            time.sleep(.1)
        raise AssertionError(f'{path} did not complete')

    with ScientificHTTPServer(tmp_path / 'worker', 't' * 48, port=0) as worker:
        thread = threading.Thread(target=worker.serve_forever, daemon=True)
        thread.start()
        env = {**os.environ, 'PORT': str(port), 'LOCAL_DATA_DIR': str(data),
            'SINGING_PYTHON': sys.executable,
            'SCIENCE_URL': f'http://127.0.0.1:{worker.server_port}', 'SCIENCE_TOKEN': 't' * 48}
        # Only the explicit live opt-in imports the provider/env loader.
        env.pop('OPENAI_API_KEY', None)
        app = None
        log = (tmp_path / 'app.log').open('w')

        def stop():
            if app is not None:
                app.terminate()
                try:
                    app.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    app.kill()
                    app.wait()

        def start():
            process = subprocess.Popen(['node', '--input-type=module', '-e', BOOTSTRAP],
                cwd=root, env=env, stdout=log, stderr=log)
            for _ in range(100):
                try:
                    call('/api/science/health')
                    return process
                except OSError:
                    assert process.poll() is None, (tmp_path / 'app.log').read_text()
                    time.sleep(.1)
            process.terminate()
            process.wait(timeout=5)
            raise AssertionError('Application did not start')

        try:
            app = start()
            assert call('/api/astra/status')['sessionId'] is None
            initial = capture(data)
            manifest = json.loads((initial / 'manifest.json').read_text())
            manifest['capture_id'] = '00000000-0000-4000-8000-000000000001'
            (initial / 'manifest.json').write_text(json.dumps(manifest))
            publish(initial)
            assert call('/api/science/use-latest-capture', {
                'purpose': 'calibration', 'pose': 'a', 'contains_external_excitation': False})['prepared']
            started = call('/api/science/run', False)
            fitted = wait_completed('/api/science/status')['result']
            session_path = '/api/science/sessions/' + fitted['sessionId'] + '/state'
            summary_path = data / 'science-runs' / started['runId'] / 'summary.json'
            initial_summary = summary_path.read_bytes()
            previous_model = fitted['modelId']
            evidence = set(call(session_path)['state']['snapshot']['evidence_ids'])
            prior_design = None
            prior_receipt = None

            for round_index in range(2):
                request = {'requestId': f'integration-round-{round_index}',
                    'goal': 'Explore comfortable vowels. This is an explicitly synthetic native audio integration test, not human or anatomical evidence. The simulated learner is rested and comfortable.'}
                decision = call('/api/astra/decide', request)
                assert decision['status'] == 'succeeded', decision
                if os.environ.get('SINGING_TEST_LIVE_ASTRA_ENV'):
                    assert decision['model'] == 'gpt-6-astra'
                else:
                    assert decision['provider'] == 'test-only'
                assert decision['decision']['action'] == 'record', (
                    'The provider chose rest; the two-outcome live loop was not completed. '
                    + decision['decision']['explanation'])
                assert decision['input']['modelId'] == previous_model
                assert set(decision['input']['evidenceIds']) == evidence
                if prior_design:
                    assert any(row['observationReceiptSha256'] == prior_receipt
                        for row in decision['input']['outcomes'])
                state = call(session_path)['state']
                committed = state['designs'][decision['designId']]
                assert committed['status'] == 'committed'
                assert decision['designId'] != prior_design
                assert committed['data']['model_id'] == previous_model
                experiment = next(row['experiment'] for row in committed['data']['rankings']
                    if row['experiment']['experiment_id'] == decision['decision']['experimentId'])
                assert committed['data']['selected_experiment_id'] == experiment['experiment_id']
                pointer = json.loads((summary_path.parent / 'astra-current.json').read_text())
                assert pointer['designId'] == decision['designId']
                assert pointer['forecast'] == committed['data']
                assert summary_path.read_bytes() == initial_summary

                # Restart between commitment and capture. The same decision must
                # survive without another provider call or session mutation.
                stop()
                app = start()
                assert call('/api/astra/decide', request) == decision
                assert call(session_path)['state']['version'] == state['version']
                assert call('/api/astra/status')['remainingCalls'] == 5 - round_index

                later_root = data / f'round-{round_index}'
                later_root.mkdir()
                later = capture(later_root)
                with Engine() as engine:
                    engine.set_anatomy(fitted['anatomy'])
                    audio = engine.synthesize(experiment['pose'], {'JA': experiment['JA']},
                        f0_hz=experiment['f0_hz'], duration_s=.6)
                    pcm, _ = resample_native_pcm(audio * experiment['gain'], 44100, 48000)
                raw = pcm.astype('<f4').tobytes()
                (later / 'audio.pcm.raw').write_bytes(raw)
                manifest = json.loads((later / 'manifest.json').read_text())
                manifest['capture_id'] = f'00000000-0000-4000-8000-{round_index + 2:012d}'
                manifest['created_at'] = datetime.now(timezone.utc).isoformat()
                manifest['audio']['samples'][0]['artifact'].update(
                    bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
                (later / 'manifest.json').write_text(json.dumps(manifest))
                publish(later)
                assert call('/api/science/use-latest-capture', {
                    'purpose': 'outcome', 'pose': experiment['pose'],
                    'contains_external_excitation': False})['prepared']
                outcome = call('/api/science/outcome', False)
                scored = wait_completed('/api/science/outcome')
                updated = call(session_path)['state']
                assert updated['snapshot']['model_id'] != previous_model
                assert committed['data']['target_observation_id'] in updated['snapshot']['evidence_ids']
                assert scored['result']['modelId'] == updated['snapshot']['model_id']
                assert call('/api/science/outcome', False)['outcomeId'] == outcome['outcomeId']
                assert call(session_path)['state']['version'] == updated['version']
                assert summary_path.read_bytes() == initial_summary
                previous_model = updated['snapshot']['model_id']
                evidence = set(updated['snapshot']['evidence_ids'])
                prior_design = decision['designId']
                prior_receipt = next(job['result']['observation_receipt_sha256']
                    for job in reversed(updated['jobs'])
                    if job['request']['operation'] == 'update_pcm' and job.get('result'))
        finally:
            stop()
            log.close()
            worker.shutdown()
            thread.join()
