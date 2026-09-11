import base64
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import sys
from pathlib import Path
import subprocess

import pytest
from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.prediction import Artifact, _encode
from singing_physics.probe_prediction import predict_probe
from singing_physics.probe_evaluation import evaluate_probe

ROOT = Path(__file__).resolve().parents[2]

def now():
    return datetime.now(timezone.utc).isoformat()

def node(code):
    run = subprocess.run(['node','--test-name-pattern=^$','--input-type=module','-e',code],cwd=ROOT,text=True,capture_output=True,env={**os.environ,"PROBE_PYTHON":sys.executable})
    assert run.returncode == 0, run.stderr

@pytest.fixture(scope='module')
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp('probe-evaluation')
    config_path = out/'setup.json'
    node(f"import {{setupFixture}} from './tests/helpers/probe-science-fixture.ts'; import{{writeFile}}from'node:fs/promises';const f=await setupFixture();await writeFile({json.dumps(str(config_path))},JSON.stringify(f));")
    setup = json.loads(config_path.read_text()); config = setup['config']
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id='score-model',evidence_ids=['independent-fit'],evidence_hashes=['a'*64],provenance=provenance,frozen_at=now(),hypotheses=[{'hypothesis_id':'first','anatomy':{'hard_palate_length':4.3}}])
    forecast = predict_probe(snapshot,expected_digest=snapshot.sha256,prediction_id='prospective',target_evidence_id=config['trial_id'],generated_at=now(),pose='a',frequency_hz=config['calibration']['frequency_hz'],placement=config['placement'],calibration=config['calibration'],calibration_evidence_ids=['reference'],calibration_frozen_at=snapshot.data['frozen_at'],comparison='complex',timing={'phase_verified':True,'uncertainty_s':0})
    forecast.write(out/'forecast.json')
    capture_started_at = now()
    # Generate the heldout raw response after persisting the forecast. The known
    # FIR deliberately differs from native acoustics, testing honest mismatch.
    node(f"import{{makeFixture}}from'./scripts/acoustic-probe-fixture.ts';import{{importProbeScience}}from'./science/scripts/import_probe_science.ts';await makeFixture({json.dumps(setup['capture'])});await importProbeScience({json.dumps(setup['capture'])},{json.dumps(str(out/'import'))},{json.dumps(setup['configPath'])});")
    receipt = json.loads((out/'import/probe-science-receipt.json').read_text())
    def media(descriptors, base):
        return {d['path']:base64.b64encode((Path(base)/d['path']).read_bytes()).decode() for d in descriptors}
    return forecast,setup,out,dict(expected_digest=forecast.sha256,document=json.loads((out/'import/probe-science-document.json').read_text()),receipt=receipt,configuration_json=Path(setup['configPath']).read_text(),original_artifacts=media(receipt['original_artifacts'],setup['capture']),supplemental_artifacts=media(receipt['supplemental_evidence'],setup['root']),capture_started_at=capture_started_at)

@pytest.fixture(scope='module')
def scenario(built):
    forecast,_,_,args=built
    return forecast,args

def test_native_forecast_then_verified_raw_outcome(scenario):
    forecast, args = scenario
    before = forecast.content
    result = evaluate_probe(forecast,**args).data
    assert result['model_updated'] is False
    assert result['scores'][0]['rmse'] > .1
    assert result['scores'][0]['valid_bins'] == 3
    assert result['forecast_sha256'] == forecast.sha256
    assert forecast.content == before

@pytest.mark.parametrize('change',['digest','chronology','bytes','receipt','target','frequency','calibration','quality'])
def test_binding_rejections(scenario,change):
    forecast,args = scenario; args=deepcopy(args)
    if change=='digest':args['expected_digest']='0'*64
    if change=='chronology':args['capture_started_at']=forecast.data['generated_at']
    if change=='bytes':args['original_artifacts']['received.f32le']=base64.b64encode(b'bad').decode()
    if change=='receipt':args['receipt']['eligible_for_fit']=False
    if change=='target':
        value=forecast.data;value['target_evidence_id']='wrong';forecast=Artifact(_encode(value));args['expected_digest']=forecast.sha256
    if change=='quality':args['document']['trials'][0]['quality_flags']=['clipping']
    if change in {'frequency','calibration'}:
        import hashlib
        value=forecast.data
        if change=='frequency':value['configuration']['frequency_hz'][0]+=1
        else:value['configuration']['calibration']['route_id']='other'
        value['configuration_sha256']=hashlib.sha256(_encode(value['configuration'])).hexdigest()
        forecast=Artifact(_encode(value));args['expected_digest']=forecast.sha256
    with pytest.raises(ValueError):evaluate_probe(forecast,**args)


def test_service_evaluates_and_preserves_model_binding(scenario,tmp_path):
    from singing_physics.service import JobService
    forecast,args=scenario
    with JobService(tmp_path) as service:
        service.register_model('session','score-model')
        request={'operation':'evaluate_probe','session_id':'session','model_id':'score-model',
                 'parameters':{'forecast_json':forecast.content.decode(),**args}}
        job=service.submit(request,idempotency_key='score')
        state=service.wait(job)
        assert state['status']=='succeeded',state
        result=service.result(job)
        assert result['forecast_sha256']==forecast.sha256
        assert result['scores'][0]['rmse']>.1
        wrong=deepcopy(request);wrong['parameters']['forecast_json']=json.dumps({**forecast.data,'model_id':'other'})
        with pytest.raises(ValueError,match='model'):
            service.submit(wrong,idempotency_key='wrong')


def test_app_import_is_scored_with_its_pull_receipt(built):
    import hashlib
    import zipfile
    forecast,setup,out,args=built
    # The same generated capture imported as the app does: original.zip plus its repository-fixture pull receipt.
    pull=out/'pull';pull.mkdir()
    with zipfile.ZipFile(pull/'original.zip','w') as z:
        for source in Path(setup['capture']).iterdir():z.write(source,source.name)
    raw=(pull/'original.zip').read_bytes()
    (pull/'usb-receipt.json').write_text(json.dumps({'name':'probe-known-filter-fixture.zip','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
        'acquisition':{'transport':'repository-fixture','generator':'science/tests/test_probe_evaluation.py'}}))
    node(f"import{{importProbeScience}}from'./science/scripts/import_probe_science.ts';await importProbeScience({json.dumps(setup['capture'])},{json.dumps(str(out/'app-import'))},{json.dumps(setup['configPath'])},{json.dumps(str(pull/'usb-receipt.json'))});")
    receipt=json.loads((out/'app-import/probe-science-receipt.json').read_text())
    assert receipt['attestation']=='repository-fixture-receipt' and receipt['receipt_sha256']
    app={**args,'receipt':receipt,'document':json.loads((out/'app-import/probe-science-document.json').read_text()),
         'pull_artifacts':{name:base64.b64encode((pull/name).read_bytes()).decode() for name in ('usb-receipt.json','original.zip')}}
    result=evaluate_probe(forecast,**app).data
    assert result['model_updated'] is False and result['scores'][0]['valid_bins']==3
    # The worker's evaluate_probe job accepts the same pull artifacts.
    from singing_physics.service import JobService
    with JobService(out/'jobs') as service:
        service.register_model('session','score-model')
        job=service.submit({'operation':'evaluate_probe','session_id':'session','model_id':'score-model','parameters':{'forecast_json':forecast.content.decode(),**app}},idempotency_key='app-score')
        assert service.wait(job)['status']=='succeeded' and service.result(job)['scores'][0]['valid_bins']==3
    # Without its pull receipt an app import is refused rather than judged by the manifest-only rule.
    with pytest.raises(ValueError,match='supply its pull receipt'):
        evaluate_probe(forecast,**{k:v for k,v in app.items() if k!='pull_artifacts'})
    # A pull receipt other than the one the import read does not match the recorded receipt hash.
    edited=json.loads((pull/'usb-receipt.json').read_text());edited['acquisition']['generator']='edited'
    with pytest.raises(ValueError,match='does not match verified original bytes'):
        evaluate_probe(forecast,**{**app,'pull_artifacts':{**app['pull_artifacts'],'usb-receipt.json':base64.b64encode(json.dumps(edited).encode()).decode()}})
    with pytest.raises(ValueError,match='usb-receipt.json and original.zip'):
        evaluate_probe(forecast,**{**app,'pull_artifacts':{'usb-receipt.json':app['pull_artifacts']['usb-receipt.json']}})
