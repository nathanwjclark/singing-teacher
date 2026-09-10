from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.pcm_inverse import FEATURES
from singing_physics.service import JobService
from singing_physics.session import SessionController

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from recompute_session_score import recompute as raw_recompute, digest


def recompute(path, job, frame, **kwargs):
    return raw_recompute(path, job, frame, original_replay=kwargs.pop("original_replay", path.parent/"replay.json"), **kwargs)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def exported(tmp_path_factory):
    root = tmp_path_factory.mktemp('real-score-replay')
    now = lambda: datetime.now(timezone.utc).isoformat()
    with Engine() as engine:
        provenance = engine.provenance
    snapshot = freeze_pcm_hypotheses(model_id='synthetic-model', evidence_ids=['calibration'],
        evidence_hashes=['a'*64], provenance=provenance, frozen_at=now(), hypotheses=[
            {'hypothesis_id':'first', 'anatomy':{'hard_palate_length':4.2}},
            {'hypothesis_id':'second', 'anatomy':{'hard_palate_length':4.8}}]).data
    with JobService(root/'worker') as service:
        controller = SessionController(root/'sessions', service, 'synthetic-session')
        def send(action, **fields):
            version = controller.execute({'action':'state'})['state']['version']
            return controller.execute({'action':action, 'command_id':str(version)+action,
                                       'expected_version':version, **fields})['state']
        def collect():
            job = controller.execute({'action':'state'})['state']['pending']['job_id']
            assert service.wait(job, timeout_s=60)['status'] == 'succeeded'
            return send('collect_job', job_id=job)
        send('register_model', snapshot=snapshot)
        send('propose_design', parameters={'design_id':'design', 'target_observation_id':'target',
            'experiments':[{'experiment_id':'a', 'pose':'a', 'JA':-2., 'f0_hz':180., 'gain':.8}],
            'feature_scales':{k:{'unit':u, 'scale':s, 'assumption':'Synthetic engineering scale'} for k,(u,s) in FEATURES.items()},
            'minimum_separation':.000001, 'max_synthesis_calls':2})
        collect()
        with Engine() as engine:
            engine.set_anatomy(snapshot['hypotheses'][0]['anatomy'])
            pcm = np.asarray(engine.synthesize('a', {'JA':-2.}, f0_hz=180., duration_s=.25)[4410:8506]*.8, dtype='<f4')
        frame = root/'original-frame.f32'; frame.write_bytes(pcm.tobytes())
        send('submit_outcome', design_id='design', parameters={'experiment_id':'a', 'observation_id':'target',
            'artifact_id':'original-frame', 'observed_at':now(), 'pcm':pcm.tolist(), 'source_kind':'engine-generated'})
        state = collect(); job_id = state['jobs'][-1]['job_id']
        replay = controller.execute({'action':'replay'})
    (root/'replay.json').write_text(json.dumps(replay))
    (root/'science-current.json').write_text(json.dumps({'status':'succeeded','runId':'synthetic-run'}))
    (root/'science-runs/synthetic-run').mkdir(parents=True)
    (root/'science-runs/synthetic-run/summary.json').write_text(json.dumps({'sessionId':'synthetic-session'}))
    # Invoke the actual app exporter/redactor over the saved real controller replay.
    # Only transport is substituted; no scientific receipt or score is fabricated.
    source = """
import {readFileSync,writeFileSync} from 'node:fs';
import {createSessionExportRoutes} from './server/sessionExport.mjs';
const root=process.argv[1], replay=JSON.parse(readFileSync(root+'/replay.json'));
const route=createSessionExportRoutes({dataRoot:root,env:{SCIENCE_URL:'http://127.0.0.1:8000',SCIENCE_TOKEN:'synthetic-test-token'},
 fetchImpl:async()=>new Response(JSON.stringify(replay)),json:(_r,status,value)=>{
 if(status!==200)throw Error(JSON.stringify(value));writeFileSync(root+'/export.json',JSON.stringify(value));}});
await route({method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:5299'}},{},new URL('http://127.0.0.1:5299/api/session-export'));
"""
    subprocess.run(['node','--input-type=module','-e',source,str(root)], cwd=ROOT, check=True, capture_output=True, text=True)
    return root/'export.json', job_id, frame


def test_actual_export_recomputes_original_received_frame_without_policy_claim(exported):
    path, job, frame = exported
    report, fresh = recompute(path, job, frame)
    assert report['status'] == 'version_unverified', report
    assert report['numerical_agreement'] is True
    assert report['budget']['actual_synthesis_calls'] == 0
    assert report['budget']['actual_canonical_extractions'] == 1
    assert fresh['observation_receipt']['received_at'] != json.loads(path.read_text())['replay']['state']['jobs'][-1]['result']['observation_receipt']['received_at']


def test_missing_and_wrong_originals_and_job_selection(exported, tmp_path):
    path, job, frame = exported
    assert raw_recompute(path, job, frame)[0]['status'] == 'missing_artifacts'
    assert recompute(path, job, None)[0]['status'] == 'missing_media'
    wrong = tmp_path/'wrong.f32'; wrong.write_bytes(bytes(frame.stat().st_size))
    report, _ = recompute(path, job, wrong)
    assert report['status'] == 'invalid_evidence' and 'SHA-256' in report['reason']
    assert report['budget']['actual_canonical_extractions'] == 0
    assert recompute(path, 'absent-job', frame)[0]['status'] == 'invalid_evidence'


def test_original_ledger_tamper_and_frozen_extractor_version_mismatch(exported, tmp_path):
    path, job, frame = exported
    original = json.loads((path.parent/'replay.json').read_text())
    altered = deepcopy(original)
    altered['events'][0]['action'] = 'changed'
    replay_path = tmp_path/'replay.json'; replay_path.write_text(json.dumps(altered))
    assert raw_recompute(path, job, frame, original_replay=replay_path)[0]['status'] == 'invalid_evidence'
    # Explicit old-version transcript derived from the genuine run. Rehash the
    # test ledger; this tests rejection, not an independently authenticated history.
    altered = deepcopy(original)
    row = altered['state']['jobs'][-1]
    design = json.loads(row['request']['parameters']['design_json'])
    design['extractor']['extractorSha256'] = 'f'*64
    design_text = json.dumps(design, sort_keys=True, separators=(',', ':'))
    design_hash = digest(design)
    row['request']['parameters']['design_json'] = design_text
    row['request']['parameters']['expected_design_digest'] = design_hash
    result = row['result']; result['design_sha256'] = design_hash
    result['observation_receipt']['design_sha256'] = design_hash
    result['observation_receipt_sha256'] = digest(result['observation_receipt'])
    altered['events'][-1]['state'] = deepcopy(altered['state'])
    previous = '0'*64
    for event in altered['events']:
        event.pop('sha256'); event['previous_sha256'] = previous
        previous = digest(event); event['sha256'] = previous
    altered['ledger_sha256'] = previous
    replay_path.write_text(json.dumps(altered))
    export = json.loads(path.read_text()); export['workerLedgerSha256'] = previous
    export['replay']['state']['jobs'][-1] = row
    export_path = tmp_path/'export.json'; export_path.write_text(json.dumps(export))
    report, fresh = raw_recompute(export_path, job, frame, original_replay=replay_path)
    assert report['status'] == 'version_mismatch', report
    assert report['budget']['actual_canonical_extractions'] == 0 and fresh is None


def test_tampered_frozen_input_and_score_discrepancy(exported, tmp_path):
    path, job, frame = exported
    data = json.loads(path.read_text())
    altered = deepcopy(data)
    altered['replay']['state']['jobs'][-1]['request']['parameters']['expected_design_digest'] = 'b'*64
    target = tmp_path/'tampered.json'; target.write_text(json.dumps(altered))
    assert recompute(target, job, frame, original_replay=path.parent/'replay.json')[0]['status'] == 'invalid_evidence'
    altered = deepcopy(data)
    altered['replay']['state']['jobs'][-1]['result']['scores'][0]['standardized_rms'] += 1
    target.write_text(json.dumps(altered))
    report, _ = recompute(target, job, frame, original_replay=path.parent/'replay.json')
    assert report['status'] == 'invalid_evidence' and 'differs' in report['reason']


def test_cli_writes_fresh_immutable_report(exported, tmp_path):
    path, job, frame = exported
    command = [sys.executable, str(ROOT/'science/scripts/recompute_session_score.py'), '--export',str(path),
               '--job-id',job,'--original-replay',str(path.parent/'replay.json'),'--frame',str(frame),'--output',str(tmp_path/'report')]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads((tmp_path/'report/report.json').read_text())['status'] == 'version_unverified'
    assert subprocess.run(command, capture_output=True).returncode != 0
