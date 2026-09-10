"""Original synthetic rear-depth bytes through normal app/session/native fusion.

Optical calibration and correspondence in this fixture are explicit mathematical
constructions. Passing this test does not validate an iPhone or human anatomy.
"""
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import zipfile

import numpy as np

from singing_physics.engine import Engine
from test_live_capture_jobs import capture
from test_native_capture_geometry import fixture as depth_fixture
from test_app_source_loop import app_runtime, publish_capture, wait_for


BOOTSTRAP = r"""
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
// Reuse the test helper's restart switch; no environment file or key is loaded.
process.env.LIDAR_FUSION_ENABLED=process.env.PHONATION_SOURCE_ENABLED;
const repo=process.cwd(),dataRoot=process.env.LOCAL_DATA_DIR;
const load=name=>import(pathToFileURL(resolve(repo,'server',name)));
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
const routes=[(await load('lidar.mjs')).createLidarRoutes({repo,dataRoot,json}),
  (await load('science.mjs')).scienceRoutes({repo,dataRoot,json}),
  (await load('voiceCapture.mjs')).createVoiceCaptureRoutes({repo,dataRoot,json})];
const proxy=(await load('science-proxy.mjs')).createScienceProxy({url:process.env.SCIENCE_URL,token:process.env.SCIENCE_TOKEN});
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
  for(const route of routes)if(await route(req,res,url))return;
  if(url.pathname.startsWith('/api/science/'))return proxy(req,res);
  json(res,404,{error:'No test route'});
}catch(e){json(res,500,{error:e.message})}}).listen(Number(process.env.PORT),'127.0.0.1');
"""


def depth_archive(data, directory, distance, identity, *, depth_m=.35):
    directory.mkdir()
    manifest, save = depth_fixture(directory)
    manifest.update(capture_mode='separate-rear-lidar-held-pose', sensor='rear-lidar',
        capture_id=identity, created_at=datetime.now(timezone.utc).isoformat())
    manifest['device'].update(device_type='AVCaptureDeviceTypeBuiltInLiDARDepthCamera',
        position='back', sensor='rear-lidar')
    raw = np.full((2, 2), depth_m, dtype='<f4').tobytes()
    (directory / 'depth.f32').write_bytes(raw)
    frame = manifest['frames'][0]
    frame['depth'].update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    frame['calibration']['intrinsics_row_major'] = [[.35 / distance, 0, 1], [0, .35 / distance, 1], [0, 0, 1]]
    frame['calibration']['inverse_lens_distortion_table_base64'] = base64.b64encode(
        np.zeros(2, dtype='<f4').tobytes()).decode()
    save()
    imports = data / 'usb-imports'
    imports.mkdir(exist_ok=True)
    archive = imports / ('rear-lidar-' + identity + '.zip')
    with zipfile.ZipFile(archive, 'w') as output:
        for file in directory.iterdir():
            output.write(file, file.name)
    receipt = {'name': archive.name, 'bytes': archive.stat().st_size,
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
    (data / 'native-pull-latest.json').write_text(json.dumps(receipt))
    return receipt, manifest


def declaration():
    return {'frameSequence': 0, 'upperPixel': [0, 0], 'lowerPixel': [1, 0],
        'depthToReference': np.eye(3).tolist(),
        'referenceMappingExplanation': 'Explicit synthetic identity mapping; not measured device calibration.',
        'pose': 'a', 'jawValues': [-3.], 'jawWeights': [1.],
        'measurementSigmaM': .0002, 'modelSigmaM': .0002,
        'uncertaintyExplanation': 'Declared software diagnostic scales; not physical sensor error characterization.',
        'correspondenceExplanation': 'Synthetic projected pixels are constructed from the declared native outer-lip vertices.',
        'registrationExplanation': 'Synthetic same-pose rigid-distance invariance, not recovered registration of a person.',
        'experimentalDeclaration': True, 'sourceKind': 'development-fixture'}


def completed_lidar(call):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        state = call('/api/lidar/status')
        if not state['busy']:
            assert state['error'] is None and state['result'] is not None, state
            return state
        time.sleep(.05)
    raise AssertionError('LiDAR app fit did not complete')


def test_original_rear_depth_changes_normal_native_model_through_app(tmp_path):
    with app_runtime(tmp_path, BOOTSTRAP) as (data, call, restart):
        assert call('/api/lidar/status')['capture'] is None
        original = capture(data)
        manifest = json.loads((original / 'manifest.json').read_text())
        manifest['capture_id'] = '00000000-0000-4000-8000-000000000040'
        (original / 'manifest.json').write_text(json.dumps(manifest))
        publish_capture(data, original)
        assert call('/api/science/use-latest-capture', {
            'purpose': 'calibration', 'pose': 'a', 'contains_external_excitation': False})['prepared']
        started = call('/api/science/run', False, expected=202)
        baseline = wait_for(call, '/api/science/status')['result']
        run = data / 'science-runs' / started['runId']
        protocol = json.loads((run / 'protocol.json').read_text())
        assert 'lip_width' in protocol['anatomy_bounds']
        assert protocol['search_budget'] == 60
        baseline_bytes = (run / 'summary.json').read_bytes()
        session_path = '/api/science/sessions/' + baseline['sessionId'] + '/state'
        before = call(session_path)['state']
        hypotheses = before['snapshot']['hypotheses']
        distances = []
        with Engine() as engine:
            for hypothesis in hypotheses:
                engine.set_anatomy(hypothesis['anatomy'])
                distances.append(engine.lip_markers('a', {'JA': -3})['distance_m'])
        target_index = max(range(len(distances)), key=lambda i: abs(distances[i] - distances[0]))
        assert abs(distances[target_index] - distances[0]) > 1e-5, (
            'Normal app search lacks meaningfully different retained outer-lip geometry', distances)
        archive, depth_manifest = depth_archive(data, tmp_path / 'depth', distances[target_index],
            '00000000-0000-4000-8000-000000000041')
        imported = call('/api/lidar/import', {})['capture']
        assert imported['archiveSha256'] == archive['sha256']
        assert imported['manifestSha256'] == hashlib.sha256((tmp_path / 'depth' / 'manifest.json').read_bytes()).hexdigest()
        frame = call('/api/lidar/frame?captureId=' + imported['captureId'] + '&sequence=0')
        assert frame['width'] == 2 and frame['height'] == 2
        assert frame['depthM'] == np.full(4, .35, dtype='<f4').astype(float).tolist()
        assert frame['calibration']['intrinsics_row_major'] == depth_manifest['frames'][0]['calibration']['intrinsics_row_major']
        assert call(session_path)['state'] == before

        request = {'requestId': 'native-lidar-fit', 'captureId': imported['captureId'],
            'expectedModelId': before['snapshot']['model_id'], 'annotation': declaration()}
        restart(enabled=False)
        assert call('/api/lidar/status')['enabled'] is False
        call('/api/lidar/fit', request, expected=503)
        assert call(session_path)['state'] == before
        restart()
        invalid = deepcopy(request)
        invalid['requestId'] = 'invalid-depth-error-scale'
        invalid['annotation']['measurementSigmaM'] = 0
        call('/api/lidar/fit', invalid, expected=202)
        rejected = completed_lidar(call)['result']
        assert rejected['status'] == 'rejected'
        assert rejected['result']['actual_geometry_calls'] == 0
        assert rejected['adoption']['model_updated'] is False
        assert call(session_path)['state']['snapshot'] == before['snapshot']
        call('/api/lidar/fit', request, expected=202)
        completed = completed_lidar(call)
        result = completed['result']
        updated = call(session_path)['state']
        assert completed['resultCurrent'] is True
        assert result['status'] == 'ranked'
        assert result['modelId'] == updated['snapshot']['model_id']
        assert result['modelId'] != before['snapshot']['model_id']
        numeric = result['result']
        assert numeric['without_depth_order'] == [h['hypothesis_id'] for h in hypotheses]
        assert numeric['with_depth_order'][0] != hypotheses[0]['hypothesis_id']
        # Different anatomy parameters can project to the same measured distance.
        # Preserve the prior ordering within this unresolved group, rather than
        # asserting an unsupported unique recovery of the generating parameter.
        equivalent = [i for i, distance in enumerate(distances)
            if abs(distance - distances[target_index]) < 1e-7]
        assert numeric['with_depth_order'][0] == hypotheses[equivalent[0]]['hypothesis_id']
        assert updated['snapshot']['hypotheses'][0]['anatomy'] == hypotheses[equivalent[0]]['anatomy']
        assert updated['snapshot']['hypotheses'][0]['anatomy']['lip_width'] != hypotheses[0]['anatomy']['lip_width']
        assert numeric['actual_geometry_calls'] == len(hypotheses)
        assert numeric['source_manifest_sha256'] == imported['manifestSha256']
        assert result['adoption']['model_updated'] is True
        assert result['geometry']['modelId'] == result['modelId']
        assert result['geometry']['hypothesisId'] == updated['snapshot']['hypotheses'][0]['hypothesis_id']
        difference = call('/api/lidar/artifact?fitId=' + result['fitId'] + '&name=space-diff.json')
        assert difference['anatomy'] == updated['snapshot']['hypotheses'][0]['anatomy']
        assert result['geometry']['files']['geometry.json']['sha256'] != hashlib.sha256((run / 'geometry.json').read_bytes()).hexdigest()
        assert all(design['status'] == 'stale' for design in updated['designs'].values())
        assert (run / 'summary.json').read_bytes() == baseline_bytes
        retained = data / 'lidar-imports' / imported['importId'] / 'capture'
        assert (retained / 'depth.f32').read_bytes() == (tmp_path / 'depth' / 'depth.f32').read_bytes()
        restart()
        assert call('/api/lidar/status')['result']['modelId'] == result['modelId']
        assert call('/api/lidar/fit', request)['reused'] is True
        assert call(session_path)['state'] == updated

        # Explicitly stale submissions must not reinterpret old declarations
        # against the newly adopted model or replace its valid geometry.
        stale = {**request, 'requestId': 'stale-lidar-fit'}
        assert 'changed' in call('/api/lidar/fit', stale, expected=400)['error']
        assert call(session_path)['state'] == updated
        assert (run / 'summary.json').read_bytes() == baseline_bytes
        invalid_after_adoption = {**invalid, 'requestId': 'invalid-after-adoption',
            'expectedModelId': updated['snapshot']['model_id']}
        call('/api/lidar/fit', invalid_after_adoption, expected=202)
        rejected_later = completed_lidar(call)
        assert rejected_later['result']['status'] == 'rejected'
        assert rejected_later['lastSuccessfulResult']['modelId'] == result['modelId']
        assert rejected_later['lastSuccessfulResult']['geometry'] == result['geometry']
        assert rejected_later['lastSuccessfulResultCurrent'] is True
        assert call(session_path)['state']['snapshot'] == updated['snapshot']
        duplicate = {**request, 'requestId': 'duplicate-original-depth',
            'expectedModelId': updated['snapshot']['model_id']}
        call('/api/lidar/fit', duplicate, expected=202)
        repeated_evidence = completed_lidar(call)
        assert repeated_evidence['result']['status'] == 'rejected'
        assert repeated_evidence['result']['result']['actual_geometry_calls'] == 0
        assert repeated_evidence['result']['includedInFit'] is False
        assert repeated_evidence['result']['adoption']['model_updated'] is False
        assert 'already' in repeated_evidence['result']['adoption']['reason']
        assert call(session_path)['state']['snapshot'] == updated['snapshot']
        restart()
        recovered = call('/api/lidar/status')
        assert recovered['lastSuccessfulResult']['geometry'] == result['geometry']
        assert recovered['lastSuccessfulResultCurrent'] is True
        # A genuinely distinct depth frame may legitimately share the camera's
        # calibration and other metadata. Those shared hashes are not duplicate
        # measurement evidence.
        _, second_manifest = depth_archive(data, tmp_path / 'later-depth', distances[target_index],
            '00000000-0000-4000-8000-000000000042', depth_m=.36)
        assert second_manifest['frames'][0]['calibration'] == depth_manifest['frames'][0]['calibration']
        assert second_manifest['frames'][0]['depth']['sha256'] != depth_manifest['frames'][0]['depth']['sha256']
        second_import = call('/api/lidar/import', {})['capture']
        second_request = {**request, 'requestId': 'distinct-depth-shared-calibration',
            'captureId': second_import['captureId'], 'expectedModelId': updated['snapshot']['model_id']}
        call('/api/lidar/fit', second_request, expected=202)
        second_result = completed_lidar(call)['result']
        assert second_result['status'] == 'ranked'
        assert second_result['adoption']['model_updated'] is True
        assert second_result['modelId'] != updated['snapshot']['model_id']
        assert second_result['modelId'] == call(session_path)['state']['snapshot']['model_id']
        assert (run / 'summary.json').read_bytes() == baseline_bytes
