"""Actual encoded motion audio through app import and isolated native analysis.

Generated audio and blank video are explicit software fixtures. Unknown video
alignment remains unknown; numerical output does not validate human anatomy.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import numpy as np
import pytest

from app_port import listening_port
from singing_physics.http_service import ScientificHTTPServer
from test_live_capture_jobs import capture
from test_app_source_loop import publish_capture, wait_for


BOOTSTRAP = r"""
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const repo=process.cwd(),dataRoot=process.env.LOCAL_DATA_DIR;
const load=name=>import(pathToFileURL(resolve(repo,'server',name)));
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
const routes=[(await load('sessionExport.mjs')).createSessionExportRoutes({dataRoot,json}), (await load('motion.mjs')).createMotionRoutes({repo,dataRoot,json}),
  (await load('science.mjs')).scienceRoutes({repo,dataRoot,json}),
  (await load('voiceCapture.mjs')).createVoiceCaptureRoutes({repo,dataRoot,json})];
const proxy=(await load('science-proxy.mjs')).createScienceProxy({url:process.env.SCIENCE_URL,token:process.env.SCIENCE_TOKEN});
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/test/motion-context'){json(res,200,await (await load('motionContext.mjs')).readMotionContext({dataRoot,sessionId:url.searchParams.get('session'),modelId:url.searchParams.get('model')}));return;}
  for(const route of routes)if(await route(req,res,url))return;
  if(url.pathname.startsWith('/api/science/'))return proxy(req,res);
  json(res,404,{error:'No test route'});
}catch(e){json(res,500,{error:e.message})}}).listen(Number(process.env.PORT),'127.0.0.1',function(){console.log('App: http://127.0.0.1:'+this.address().port)});
"""


def motion_record(media, identity, mime):
    raw = media.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    return {'schemaVersion': '1.0.0', 'kind': 'motion-observation', 'id': identity,
        'createdAt': '2026-01-01T00:00:00Z',
        'provenance': {'kind': 'development-fixture', 'producer': 'motion-runtime-test',
            'producerVersion': '1', 'sourceIds': ['generated-native-audio'], 'sourceHashes': [digest]},
        'attemptId': identity + '-attempt', 'cueId': 'test-cue', 'cueVersion': '1',
        'context': {'description': 'Native synthesized audio and blank-video software fixture'},
        'samples': [{'id': 'frame-' + str(i), 'captureMs': t, 'sourceTimestampMs': t,
            'repetition': 1, 'phase': 'gesture', 'head': None, 'gapBefore': i == 1,
            'points': [{'name': 'tongue_tip', 'image': None, 'headRelative': None,
                'visibility': 'missing', 'reason': 'tip-not-tracked', 'confidence': None}]}
            for i, t in enumerate((100, 500))],
        'markers': [], 'coordinateFrame': 'normalized-image-and-outer-eye-relative-2d',
        'timebase': {'clock': 'browser-performance', 'originMs': 0, 'syncUncertaintyMs': None},
        'visibility': 'Per-point', 'uncertainty': 'unquantified-image-estimates', 'observedEnvelope': [],
        'media': {'filename': media.name, 'mimeType': mime, 'startedAtMs': 0,
            'syncUncertaintyMs': None, 'sha256': digest, 'byteLength': len(raw)},
        'missing': {'depth': 'not-supported', 'internalGeometry': 'not-observed',
            'calibratedHeadPose': 'not-captured'},
        'interpretation': 'observed-visible-motion-not-anatomical-limits'}


def encode_media(ffmpeg, directory, pcm, *, name, audio=True):
    output = directory / name
    command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=20:d=0.6']
    if audio:
        command += ['-f', 'f32le', '-ar', '48000', '-ac', '1', '-i', str(pcm)]
    command += ['-c:v', 'libvpx-vp9' if output.suffix == '.webm' else 'libx264']
    if audio:
        command += ['-c:a', 'libopus' if output.suffix == '.webm' else 'aac']
    else:
        command += ['-an']
    command += ['-shortest', str(output)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert output.stat().st_size > 0
    return output


@contextmanager
def app_runtime(tmp_path, bootstrap, ffmpeg):
    root = Path(__file__).parents[2]
    data = tmp_path / 'app'
    data.mkdir()
    port = None
    with ScientificHTTPServer(tmp_path / 'worker', 't' * 48, port=0) as worker:
        thread = threading.Thread(target=worker.serve_forever, daemon=True)
        thread.start()
        env = {**os.environ, 'PORT': '0', 'LOCAL_DATA_DIR': str(data),
            'SINGING_PYTHON': sys.executable,
            'SCIENCE_URL': f'http://127.0.0.1:{worker.server_port}', 'SCIENCE_TOKEN': 't' * 48,
            'SINGING_FFMPEG': ffmpeg}
        env.pop('OPENAI_API_KEY', None)
        env.pop('SINGING_TEST_LIVE_ASTRA_ENV', None)
        process = None
        log = (tmp_path / 'app.log').open('w')

        def request(path, *, method='GET', body=None, content_type='application/json', expected=200):
            req = urllib.request.Request(f'http://127.0.0.1:{port}' + path,
                method=method, data=body, headers={'Content-Type': content_type})
            try:
                response = urllib.request.urlopen(req, timeout=180)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                result = json.load(response)
                assert response.status == expected, (path, response.status, result)
                return result

        def call(path, body=None, expected=200):
            return request(path, method='GET' if body is None else 'POST',
                body=None if body is None or body is False else json.dumps(body).encode(), expected=expected)

        def upload(record, media):
            boundary = 'motion-runtime-test-boundary'
            chunks = []
            for field, name, mime, raw in (
                ('record', 'motion.json', 'application/json', json.dumps(record).encode()),
                ('media', media.name, record['media']['mimeType'], media.read_bytes())):
                chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode(), raw, b'\r\n']
            chunks.append(f'--{boundary}--\r\n'.encode())
            return request('/api/motion/import', method='POST', body=b''.join(chunks),
                content_type='multipart/form-data; boundary=' + boundary)

        def stop():
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

        def restart(decoder=ffmpeg):
            nonlocal process, port
            stop()
            env['SINGING_FFMPEG'] = decoder
            offset = (tmp_path / 'app.log').stat().st_size
            process = subprocess.Popen(['node', '--input-type=module', '-e', bootstrap],
                cwd=root, env=env, stdout=log, stderr=log)
            port = listening_port(process, tmp_path / 'app.log', offset)
            for _ in range(100):
                try:
                    call('/api/science/health')
                    return
                except OSError:
                    assert process.poll() is None, (tmp_path / 'app.log').read_text()
                    time.sleep(.1)
            raise AssertionError('Application did not start')

        try:
            restart()
            yield data, call, upload, restart
        finally:
            stop()
            log.close()
            worker.shutdown()
            thread.join()


def test_encoded_motion_audio_ranks_native_windows_without_changing_baseline(tmp_path):
    ffmpeg = shutil.which('ffmpeg')
    if ffmpeg is None or shutil.which('ffprobe') is None:
        pytest.skip('Actual encoded-media integration requires ffmpeg and ffprobe')
    with app_runtime(tmp_path, BOOTSTRAP, ffmpeg) as (data, call, upload, restart):
        assert call('/api/motion/status')['capture'] is None
        original = capture(data)
        manifest = json.loads((original / 'manifest.json').read_text())
        manifest['capture_id'] = '00000000-0000-4000-8000-000000000030'
        (original / 'manifest.json').write_text(json.dumps(manifest))
        publish_capture(data, original)
        assert call('/api/science/use-latest-capture', {
            'purpose': 'calibration', 'pose': 'a', 'contains_external_excitation': False})['prepared']
        started = call('/api/science/run', False, expected=202)
        baseline_result = wait_for(call, '/api/science/status')['result']
        session_path = '/api/science/sessions/' + baseline_result['sessionId'] + '/state'
        initial_state = call(session_path)['state']
        baseline_file = data / 'science-runs' / started['runId'] / 'summary.json'
        initial_hash = hashlib.sha256(baseline_file.read_bytes()).hexdigest()

        def unchanged():
            assert call(session_path)['state'] == initial_state
            assert hashlib.sha256(baseline_file.read_bytes()).hexdigest() == initial_hash

        voiced = encode_media(ffmpeg, tmp_path, original / 'audio.pcm.raw', name='voiced.webm')
        record = motion_record(voiced, 'native-voiced-motion', 'video/webm')
        imported = upload(record, voiced)
        capture_id = imported['capture']['id']
        assert imported['capture']['includedInPhysicalFit'] is False
        analysis_path = '/api/motion/analysis?captureId=' + capture_id
        assert call(analysis_path)['status'] == 'not-run'
        payload = {'requestId': 'native-motion-analysis', 'captureId': capture_id,
            'pose': 'a', 'containsExternalExcitation': False}
        call('/api/motion/analyze', payload, expected=202)
        completed = wait_for(call, analysis_path)
        result = completed['result']
        assert result['kind'] == 'motion-pcm-fit-1'
        assert result['status'] == 'available'
        assert result['visualSync'] == 'unknown'
        assert result['modelUpdated'] is False
        assert result['modelId'] == initial_state['snapshot']['model_id']
        assert result['sourceHashes']['media'] == record['media']['sha256']
        assert result['decode']['sampleRateHz'] == 48000
        assert result['decode']['codec'] == 'opus'
        assert 0 < result['actualSynthesisCalls'] <= 108
        assert len(result['windows']) == 3
        scored = [row for row in result['windows'] if row['status'] == 'scored']
        assert len(scored) >= 1
        for row in scored:
            fit = row['fit']
            assert fit['kind'] == 'conditional_pcm_candidate_fit'
            assert fit['identifiability'] == 'not_established'
            rankings = [candidate for candidate in fit['joint']['candidates'] if candidate['status'] == 'scored']
            assert rankings
            discrepancies = [candidate['weighted_mean_square_discrepancy'] for candidate in rankings]
            assert all(np.isfinite(value) and value >= 0 for value in discrepancies)
            assert fit['joint']['best']['weighted_mean_square_discrepancy'] == min(discrepancies)
        temporal = result['temporalAnalysis']
        assert temporal['additionalSynthesisCalls'] == 0 and temporal['modelUpdated'] is False
        for comparison in temporal['sensitivity']:
            for alternative in comparison['alternatives']:
                assert len({step['anatomySha256'] for step in alternative['path']}) == 1
                for step in alternative['path']:
                    assert step['candidateId'] in [c['candidate_id'] for c in result['windows'][step['position']]['fit']['joint']['candidates']]
        compact = call('/test/motion-context?session=' + result['sessionId'] + '&model=' + result['modelId'])
        assert compact['receiptSha256'] and compact['temporal']['status'] == temporal['status']
        exported = call('/api/session-export')
        assert exported['summary']['motionAnalysisCount'] == 1
        assert next(a for a in exported['artifacts'] if a.get('binding', {}).get('role') == 'conditional-motion-audio-analysis')['data']['temporalAnalysis'] == temporal
        assert any(row['status'] == 'unavailable' for row in result['windows'])
        assert call('/api/motion/status')['record']['timebase']['syncUncertaintyMs'] is None
        unchanged()
        restart()
        assert call(analysis_path)['result'] == result
        reused = call('/api/motion/analyze', payload)
        assert reused['reused'] is True
        assert reused['analysisId'] == completed['analysisId']
        unchanged()

        silent_pcm = tmp_path / 'silent.f32'
        silent_pcm.write_bytes(np.zeros(28800, dtype='<f4').tobytes())
        silent = encode_media(ffmpeg, tmp_path, silent_pcm, name='silent.mp4')
        silence_record = motion_record(silent, 'silent-motion', 'video/mp4')
        silence_id = upload(silence_record, silent)['capture']['id']
        call('/api/motion/analyze', {**payload, 'requestId': 'silent-motion-analysis',
            'captureId': silence_id}, expected=202)
        silent_result = wait_for(call, '/api/motion/analysis?captureId=' + silence_id)['result']
        assert silent_result['status'] == 'insufficient-quality'
        assert silent_result['actualSynthesisCalls'] == 0
        assert all(row['fit'] is None for row in silent_result['windows'])
        assert silent_result['modelUpdated'] is False
        unchanged()

        no_audio = encode_media(ffmpeg, tmp_path, silent_pcm, name='no-audio.mp4', audio=False)
        no_audio_id = upload(motion_record(no_audio, 'no-audio-motion', 'video/mp4'), no_audio)['capture']['id']
        call('/api/motion/analyze', {**payload, 'requestId': 'no-audio-analysis',
            'captureId': no_audio_id}, expected=202)
        unavailable = wait_for(call, '/api/motion/analysis?captureId=' + no_audio_id,
            terminal=('succeeded', 'failed'))
        assert unavailable['status'] == 'failed' or unavailable['result']['status'] == 'unavailable'
        assert not unavailable.get('result') or unavailable['result']['actualSynthesisCalls'] == 0
        unchanged()

        restart(decoder=str(tmp_path / 'not-installed-ffmpeg'))
        missing = call('/api/motion/analysis?captureId=' + capture_id)
        assert missing['availability']['available'] is False
        call('/api/motion/analyze', {**payload, 'requestId': 'missing-decoder-analysis'}, expected=503)
        assert call('/api/motion/status')['capture']['id'] == no_audio_id
        assert (data / 'motion-captures' / capture_id / 'media').read_bytes() == voiced.read_bytes()
        unchanged()
