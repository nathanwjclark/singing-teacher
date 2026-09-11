"""Known native controls exercise retrospective inference; no human accuracy claim."""
from contextlib import contextmanager
from copy import deepcopy
import json
import math
import os
from pathlib import Path
import subprocess
import threading
from datetime import datetime,timezone

import numpy as np
import pytest

from singing_physics.engine import Engine
from singing_physics.phonation import synthesize_phonation
from singing_physics.http_service import ScientificHTTPServer
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.pcm_inverse import FEATURES,fit_pcm
from singing_physics.motion_path import MAX_LINK_GAP_SECONDS
from singing_physics.motion_trajectory import (MAX_PITCH_DISTANCE_CENTS,MAX_RECORDING_SECONDS,pitch_anchors,score_forward_bank,
    select_hypotheses,window_offsets,window_scales)
from test_app_motion import app_motion,encoded_capture

ROOT=Path(__file__).parents[2]
# Every summary must fit the session export's per-file limit (server/sessionExport.mjs MAX_FILE_BYTES).
EXPORT_FILE_LIMIT=2*1024*1024
# Summary budget per window; three hypotheses at the 120-window limit still fit the export limit.
def summary_budget(windows):return 64000+12500*windows
assert summary_budget(120)<EXPORT_FILE_LIMIT


def test_adaptive_grid_has_disjoint_frames_and_hard_bound():
    for rate in (44100,48000,96000):
        chunk=round(.25*rate);frame=(8192 if rate==96000 else 4096)/rate
        assert window_offsets(chunk-1,rate,chunk)==[0]
        assert window_offsets(chunk,rate,chunk)==[0]
        for seconds in (.6,1,3,21,30):
            count=round(seconds*rate);offsets=window_offsets(count,rate,chunk)
            assert 1<=len(offsets)<=120 and offsets[0]==0
            assert all(b-a>=chunk for a,b in zip(offsets,offsets[1:]))
            assert offsets[-1]+chunk<=count
            if len(offsets)>1:assert offsets[-1]+chunk==count
        # Every grid the 30-second limit admits keeps adjacent measured frames within the link gap.
        for count in [2*chunk,3*chunk-1,*range(chunk,MAX_RECORDING_SECONDS*rate+1,rate//7),MAX_RECORDING_SECONDS*rate]:
            offsets=window_offsets(count,rate,chunk)
            if len(offsets)>1:assert max(b-a for a,b in zip(offsets,offsets[1:]))/rate-frame<MAX_LINK_GAP_SECONDS
        with pytest.raises(ValueError,match='30 seconds'):window_offsets(MAX_RECORDING_SECONDS*rate+1,rate,chunk)


def test_robust_pitch_anchors_ignore_a_single_octave_error():
    pitches=[160,164,168,172,176,370,185,190,195,200,205,210]
    anchors=pitch_anchors(pitches)
    assert anchors==[164,185,210]
    cents=lambda pitch:min(abs(1200*math.log2(pitch/anchor)) for anchor in anchors)
    assert all(cents(pitch)<=MAX_PITCH_DISTANCE_CENTS for pitch in pitches if pitch!=370) and cents(370)>900
    # Minimum, median and maximum would anchor the octave error, score it, and leave four real pitches unsupported.
    legacy=sorted({min(pitches),sorted(pitches)[(len(pitches)-1)//2],max(pitches)})
    unsupported=[p for p in pitches if min(abs(1200*math.log2(p/a)) for a in legacy)>MAX_PITCH_DISTANCE_CENTS]
    assert legacy==[160,185,370] and unsupported==[172,200,205,210]
    assert pitch_anchors([180.])==[180.] and pitch_anchors([170.,190.])==[170.,190.]


def test_window_scales_use_only_that_windows_uncertainty():
    quiet={'measurements':[{'name':name,'value':1.,'uncertainty':None} for name in FEATURES]}
    noisy={'measurements':[{'name':name,'value':1.,'uncertainty':900. if name=='centroidHz' else None} for name in FEATURES]}
    declared={name:{'unit':unit,'scale':scale} for name,(unit,scale) in FEATURES.items()}
    assert window_scales(quiet)==declared
    assert window_scales(noisy)=={**declared,'centroidHz':{'unit':'Hz','scale':900.}}
    assert window_scales(quiet)==declared  # Scales are per window; no recording-wide maximum leaks back.


def test_synthesis_budget_refuses_before_any_native_call():
    windows=[{'index':i,'status':'measured','measurement':{'measurements':[{'name':'pitchHz','value':pitch}]}} for i,pitch in enumerate((150.,180.,220.))]
    before=deepcopy(windows)
    # Four hypotheses at three anchors would need 144 syntheses; no engine is supplied, so any synthesis attempt would fail differently.
    with pytest.raises(ValueError,match='144 syntheses; the limit is 108'):
        score_forward_bank(None,windows,[dict(hypothesis_id=f'h{i}',anatomy={}) for i in range(4)],'a',44100,4410,4096)
    assert windows==before
    with pytest.raises(ValueError,match='declared hypotheses'):score_forward_bank(None,windows,[],'a',44100,4410,4096)


def test_hypothesis_selection_is_declared_from_the_frozen_snapshot_rank():
    hypotheses=[dict(hypothesis_id=f'h{i}',anatomy={'x':float(i)}) for i in range(5)]
    selected,declared=select_hypotheses({'model_id':'m','hypotheses':hypotheses,'search_result_sha256':'a'*64})
    assert [row['hypothesis_id'] for row in selected]==declared['selectedIds']==['h0','h1','h2']
    assert declared['totalRetained']==5 and declared['rankingBasis']=='baseline search discrepancy ranking' and declared['rankingReceiptSha256']=='a'*64
    assert declared['selection']=='top-3-by-frozen-snapshot-rank' and len(declared['anatomies'])==3
    probe=select_hypotheses({'model_id':'m','hypotheses':hypotheses,'search_result_sha256':'a'*64,'probe_ranking':[{}],'probe_fit_sha256':'b'*64})[1]
    assert probe['rankingBasis'].startswith('probe-adopted') and probe['rankingReceiptSha256']=='b'*64
    caller=select_hypotheses({'model_id':'m','hypotheses':hypotheses[:2]})
    assert len(caller[0])==2 and caller[1]['rankingReceiptSha256'] is None and 'declares no ranking' in caller[1]['rankingBasis']
    with pytest.raises(ValueError):select_hypotheses({'model_id':'m','hypotheses':[]})


@contextmanager
def baseline(tmp_path,monkeypatch):
    data=tmp_path/'data';data.mkdir()
    server=ScientificHTTPServer(tmp_path/'jobs','t'*48,port=0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('SCIENCE_URL',f'http://127.0.0.1:{server.server_port}');monkeypatch.setenv('SCIENCE_TOKEN','t'*48)
    try:
        with Engine() as engine:provenance=engine.provenance
        model=freeze_pcm_hypotheses(model_id='trajectory-baseline',evidence_ids=['prior-independent-recording'],evidence_hashes=['a'*64],
            provenance=provenance,hypotheses=[dict(hypothesis_id='known',anatomy={})],frozen_at=datetime.now(timezone.utc).isoformat()).data
        backend=app_motion.HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],'trajectory-session')
        backend.execute(dict(action='register_model',command_id='register',expected_version=0,snapshot=model))
        (data/'science-current.json').write_text(json.dumps(dict(status='succeeded',runId='run-test')))
        run=data/'science-runs'/'run-test';run.mkdir(parents=True);(run/'summary.json').write_text(json.dumps(dict(sessionId='trajectory-session')))
        yield data,backend
    finally:server.shutdown();thread.join();server.server_close()


def chunks(engine,controls):
    return np.concatenate([engine.synthesize('a',{'JA':ja},f0_hz=f0,duration_s=.25) for ja,f0 in controls])


def compact_context(summary):
    """The real server-side Astra reduction applied to a real pipeline summary."""
    script=("import {boundedMotionEvidence} from './server/motionContext.mjs';import {readFileSync} from 'node:fs';"
        "const r=JSON.parse(readFileSync(process.argv[1],'utf8'));const c=boundedMotionEvidence(r,{});"
        "process.stdout.write(JSON.stringify({compact:c,length:c?JSON.stringify(c).length:null}))")
    out=subprocess.run(['node','--input-type=module','-e',script,str(summary)],cwd=ROOT,capture_output=True,text=True,timeout=30,check=True)
    return json.loads(out.stdout)


def constant_mae(path,truth):
    return min(np.mean([abs(ja-truth[row['position']]) for row in path]) for ja in (-4.,-3.,-2.))


def test_native_encoded_known_trajectory_noise_dropout_source_mismatch_and_varying_pitch(tmp_path,monkeypatch):
    truth=[-4.,-4.,-3.,-3.,-2.,-2.,-3.,-3.,-4.,-4.,-3.,-3.]
    # Pitch rises 160 -> 210 Hz with an octave jump at position 5 (2 x 185 Hz).
    glide=[160.,164.,168.,172.,176.,370.,185.,190.,195.,200.,205.,210.]
    with Engine() as engine:
        clean=chunks(engine,[(ja,180.) for ja in truth])
        varying=chunks(engine,list(zip(truth,glide)))
        changed_source=np.concatenate([synthesize_phonation(engine,pose='a',JA=ja,F0=180,PR=8000,PS=.25,duration_s=.25)[0] for ja in truth])
    noisy=clean+np.random.default_rng(730).normal(0,np.sqrt(np.mean(clean**2))*.025,len(clean))
    n=round(.25*44100);noisy[4*n:6*n]=0
    metrics=[]
    with baseline(tmp_path,monkeypatch) as (data,backend):
        initial=backend.execute({'action':'state'})['state']
        for name,pcm in [('known-native-controls',clean),('noise-and-dropout',noisy),('mismatched-source',changed_source),('varying-pitch-octave-error',varying)]:
            original=tmp_path/name;original.mkdir();identity=encoded_capture(data,original,pcm=pcm)
            output=tmp_path/(name+'-analysis')
            result=app_motion.run(data,identity,'a',output,'trajectory-baseline')
            assert result['modelId']=='trajectory-baseline' and result['modelUpdated'] is False
            assert len(result['windows'])==12
            assert 0<result['actualSynthesisCalls']<=9
            assert result['trajectoryBank']['synthesisRequests']==12*len(result['trajectoryBank']['pitchAnchorsHz'])<=36
            assert result['objective']=={'rescoring':'canonical-coarse-v1','baseline':'canonical-coarse-v1','baselineDeclared':False,'matchesBaseline':True,
                'source':'baseline science run summary objective field; absent means the legacy coarse objective'}
            assert result['hypothesisSubset']['selectedIds']==['known'] and 'declares no ranking' in result['hypothesisSubset']['rankingBasis']
            assert backend.execute({'action':'state'})['state']==initial
            # Complete predictions are retained once beside the summary, bound by hash.
            for bank in result['trajectoryBank']['banks']:
                assert bank['status']=='available' and app_motion.sha(json.dumps(json.loads((output/bank['artifact']).read_text()),sort_keys=True,separators=(',',':')).encode())==bank['sha256']
            scored=[w for w in result['windows'] if w['status']=='scored']
            # The canonical extractor reports no descriptor uncertainty, so every window keeps the declared scales.
            assert all(w['fit']['featureScales']=={k:{'unit':u,'scale':s} for k,(u,s) in FEATURES.items()} for w in scored)
            size=(output/'summary.json').stat().st_size
            assert size<=summary_budget(len(result['windows']))
            temporal=result['temporalAnalysis'];assert temporal['status']=='available'
            plain,smoothed=temporal['sensitivity'][0],temporal['sensitivity'][1]
            predicted=plain['alternatives'][0]['path'];mae=np.mean([abs(row['JA']-truth[row['position']]) for row in predicted])
            static_mae=constant_mae(predicted,truth)
            truth_coverage=np.mean([truth[row['position']] in row['JASet'] for row in plain['uncertainty']])
            metrics.append(dict(fixture=name,scoredWindows=len(predicted),trajectoryMAEDeg=float(mae),bestConstantControlMAEDeg=float(static_mae),
                objectiveGapSetTruthCoverage=float(truth_coverage),meanDescriptorCost=plain['alternatives'][0]['dataCost']/len(predicted),synthesisCalls=result['actualSynthesisCalls'],
                pitchAnchorsHz=result['trajectoryBank']['pitchAnchorsHz'],informationOverConstant=temporal['informationOverConstant'],
                constantImprovement={row['lambda']:row['constantComparison']['improvement'] for row in temporal['sensitivity']},summaryBytes=size))
            assert result['warnings']==temporal['warnings']
            if name=='known-native-controls':
                assert len(predicted)==12 and mae<static_mae and truth_coverage>=.75
                assert temporal['informationOverConstant']=='present' and not smoothed['constantComparison']['admissible']
            if name=='noise-and-dropout':
                assert {4,5}.issubset({row['position'] for row in temporal['excludedWindows']})
                assert all(row['reason'] and row['startSeconds'] is not None for row in temporal['excludedWindows'])
                assert not any(row['fromPosition']<4 and row['toPosition']>=6 for row in plain['transitionUncertainty'])
            if name=='mismatched-source':
                # Every window scores, yet with the default smoothing the constant path explains the recording as well.
                assert len(scored)==12 and smoothed['constantComparison']['admissible']
            if name=='varying-pitch-octave-error':
                assert max(result['trajectoryBank']['pitchAnchorsHz'])<250
                outlier=result['windows'][5]
                assert outlier['status']=='unavailable' and outlier['reason']=='Measured pitch outside the one-semitone bank support' and outlier['pitchDistanceCents']>900
                assert [w['index'] for w in scored]==[i for i in range(12) if i!=5]
                assert all(abs(w['pitchDistanceCents'])<=MAX_PITCH_DISTANCE_CENTS for w in scored)
                assert 5 in {row['position'] for row in temporal['excludedWindows']}
            # Mismatched source is retained as a challenge, never relabeled measured jaw.
            assert 'Source F0' in temporal['limitations'][1] and 'Source changes' in temporal['limitations'][3]
            assert all(math.isfinite(row['dataCost']) for row in predicted)
        # A noisy neighbour widens only its own scale: rescoring with one inflated uncertainty leaves every other window's costs unchanged.
        known=json.loads((tmp_path/'known-native-controls-analysis'/'summary.json').read_text())['windows']
        rescored=deepcopy(known)
        for row in rescored:
            row.update(status='measured',fit=None)
        next(m for m in rescored[3]['measurement']['measurements'] if m['name']=='centroidHz')['uncertainty']=2000.
        with Engine() as engine:
            rate=known[0]['sampleRateHz']
            score_forward_bank(engine,rescored,[dict(hypothesis_id='known',anatomy={})],'a',rate,round(.1*rate),4096,fitter=fit_pcm)
        costs=lambda row:[c['weighted_mean_square_discrepancy'] for c in row['fit']['joint']['candidates']]
        assert rescored[3]['fit']['featureScales']['centroidHz']['scale']==2000.
        assert all(costs(a)==costs(b) for i,(a,b) in enumerate(zip(known,rescored)) if i!=3)
        assert costs(rescored[3])!=costs(known[3])
        (tmp_path/'metrics.json').write_text(json.dumps({'interpretation':'Simulator-control recovery benchmark, not held-out acoustic prediction or human anatomy validation','results':metrics},indent=2))


def test_native_long_recording_keeps_gaps_and_bounded_outputs(tmp_path,monkeypatch):
    # Twelve 2.5 s control segments with one second of silence at 15 s. The encoded container
    # adds codec padding, so 29.9 s is the longest generated recording the 30 s duration check admits.
    segments=[-4.,-3.,-2.,-3.]*3
    with Engine() as engine:
        pcm=np.concatenate([engine.synthesize('a',{'JA':ja},f0_hz=180.,duration_s=2.5) for ja in segments])[:round(29.9*44100)]
    pcm[15*44100:16*44100]=0
    with baseline(tmp_path,monkeypatch) as (data,backend):
        original=tmp_path/'long';original.mkdir();identity=encoded_capture(data,original,pcm=pcm)
        output=tmp_path/'long-analysis'
        result=app_motion.run(data,identity,'a',output,'trajectory-baseline')
    windows=result['windows'];temporal=result['temporalAnalysis']
    assert len(windows)==119 and 0<result['actualSynthesisCalls']<=9
    frame=lambda w:(w['sourceStartSample']+w['windowOffsetWithinExcerpt'])/w['sampleRateHz']
    truth={w['index']:segments[int((frame(w)+2048/w['sampleRateHz'])//2.5)] for w in windows}
    silent=[w['index'] for w in windows if 15<frame(w) and frame(w)+4096/w['sampleRateHz']<16]
    excluded={row['position']:row['reason'] for row in temporal['excludedWindows']}
    assert len(silent)>=3 and set(silent)<=set(excluded) and all(windows[p]['reason']=='Unvoiced or invalid canonical window' for p in silent)
    assert temporal['status']=='available' and len(temporal['segments'])>=2
    assert not any(row['fromPosition']<silent[0] and row['toPosition']>silent[-1] for row in temporal['sensitivity'][0]['transitionUncertainty'])
    path=temporal['sensitivity'][0]['alternatives'][0]['path']
    mae=np.mean([abs(row['JA']-truth[row['position']]) for row in path]);static=min(np.mean([abs(ja-truth[row['position']]) for row in path]) for ja in (-4.,-3.,-2.))
    assert mae<static and temporal['informationOverConstant']=='present'
    size=(output/'summary.json').stat().st_size
    assert size<=summary_budget(len(windows))
    context=compact_context(output/'summary.json')
    compact=context['compact']
    assert context['length']<=24000 and compact['timeline']['sampleSize']==12
    assert compact['timeline']['totalWindows']==119 and compact['timeline']['missingWindows']==len(excluded)
    assert compact['temporal']['excludedWindows']['count']==len(excluded) and all(row['reason'] for row in compact['temporal']['excludedWindows']['sample'])
    assert {row['reason'] for row in compact['temporal']['excludedWindows']['reasons']}=={'Unvoiced or invalid canonical window'}
    assert len(compact['temporal']['sensitivity'])==3 and all(row['uncertainty']['sample'] and row['transitionUncertainty']['sample'] for row in compact['temporal']['sensitivity'])
    (tmp_path/'metrics.json').write_text(json.dumps({'windows':len(windows),'summaryBytes':size,'contextChars':context['length'],'segments':len(temporal['segments']),
        'trajectoryMAEDeg':float(mae),'bestConstantControlMAEDeg':float(static)}))
