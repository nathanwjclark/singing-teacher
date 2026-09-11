"""Known native controls exercise retrospective inference; no human accuracy claim."""
import json
import math
import os
import threading
from datetime import datetime,timezone

import numpy as np

from singing_physics.engine import Engine
from singing_physics.phonation import synthesize_phonation
from singing_physics.http_service import ScientificHTTPServer
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.motion_trajectory import window_offsets
from test_app_motion import app_motion,encoded_capture


def test_adaptive_grid_has_disjoint_frames_and_hard_bound():
    for rate in (44100,48000,96000):
        chunk=round(.25*rate)
        assert window_offsets(chunk-1,rate,chunk)==[0]
        assert window_offsets(chunk,rate,chunk)==[0]
        for seconds in (.6,1,3,21,30):
            count=round(seconds*rate);offsets=window_offsets(count,rate,chunk)
            assert 1<=len(offsets)<=120 and offsets[0]==0
            assert all(b-a>=chunk for a,b in zip(offsets,offsets[1:]))
            assert offsets[-1]+chunk<=count
            if len(offsets)>1:assert offsets[-1]+chunk==count


def test_native_encoded_known_trajectory_noise_dropout_and_source_mismatch(tmp_path,monkeypatch):
    data=tmp_path/'data';data.mkdir()
    truth=[-4.,-4.,-3.,-3.,-2.,-2.,-3.,-3.,-4.,-4.,-3.,-3.]
    with Engine() as engine:
        provenance=engine.provenance
        clean=np.concatenate([engine.synthesize('a',{'JA':ja},f0_hz=180,duration_s=.25) for ja in truth])
        changed_source=np.concatenate([synthesize_phonation(engine,pose='a',JA=ja,F0=180,PR=8000,PS=.25,duration_s=.25)[0] for ja in truth])
    noisy=clean+np.random.default_rng(730).normal(0,np.sqrt(np.mean(clean**2))*.025,len(clean))
    n=round(.25*44100);noisy[4*n:6*n]=0
    server=ScientificHTTPServer(tmp_path/'jobs','t'*48,port=0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('SCIENCE_URL',f'http://127.0.0.1:{server.server_port}');monkeypatch.setenv('SCIENCE_TOKEN','t'*48)
    model=freeze_pcm_hypotheses(model_id='trajectory-baseline',evidence_ids=['prior-independent-recording'],evidence_hashes=['a'*64],
        provenance=provenance,hypotheses=[dict(hypothesis_id='known',anatomy={})],frozen_at=datetime.now(timezone.utc).isoformat()).data
    backend=app_motion.HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],'trajectory-session')
    backend.execute(dict(action='register_model',command_id='register',expected_version=0,snapshot=model))
    (data/'science-current.json').write_text(json.dumps(dict(status='succeeded',runId='run-test')))
    run=data/'science-runs'/'run-test';run.mkdir(parents=True);(run/'summary.json').write_text(json.dumps(dict(sessionId='trajectory-session')))
    metrics=[]
    try:
        initial=backend.execute({'action':'state'})['state']
        for name,pcm in [('known-native-controls',clean),('noise-and-dropout',noisy),('mismatched-source',changed_source)]:
            original=tmp_path/name;original.mkdir();identity=encoded_capture(data,original,pcm=pcm)
            result=app_motion.run(data,identity,'a',tmp_path/(name+'-analysis'),'trajectory-baseline')
            assert result['modelId']=='trajectory-baseline' and result['modelUpdated'] is False
            assert len(result['windows'])==12
            assert 0<result['actualSynthesisCalls']<=9
            assert result['trajectoryBank']['synthesisRequests']<=36
            assert backend.execute({'action':'state'})['state']==initial
            temporal=result['temporalAnalysis'];assert temporal['status']=='available'
            plain=temporal['sensitivity'][0]
            predicted=plain['best']['path'];mae=np.mean([abs(row['JA']-truth[row['position']]) for row in predicted])
            static_mae=min(np.mean([abs(ja-truth[row['position']]) for row in predicted]) for ja in (-4.,-3.,-2.))
            truth_coverage=np.mean([truth[row['position']] in row['JASet'] for row in plain['uncertainty']])
            metrics.append(dict(fixture=name,scoredWindows=len(predicted),trajectoryMAEDeg=float(mae),
                bestConstantControlMAEDeg=float(static_mae),objectiveGapSetTruthCoverage=float(truth_coverage),
                meanDescriptorCost=plain['best']['dataCost']/len(predicted),synthesisCalls=result['actualSynthesisCalls']))
            if name=='known-native-controls':
                assert len(predicted)==12
                assert mae<static_mae
                assert truth_coverage>=.75
            if name=='noise-and-dropout':
                assert {4,5}.issubset({row['position'] for row in temporal['excludedWindows']})
                assert not any(row['fromPosition']<4 and row['toPosition']>=6 for row in plain['transitionUncertainty'])
            # Mismatched source is retained as a challenge, never relabeled measured jaw.
            assert 'Source F0' in temporal['limitations'][1]
            assert all(math.isfinite(row['dataCost']) for row in predicted)
        (tmp_path/'metrics.json').write_text(json.dumps({'interpretation':'Simulator-control recovery benchmark, not held-out acoustic prediction or human anatomy validation','results':metrics},indent=2))
    finally:server.shutdown();thread.join();server.server_close()
