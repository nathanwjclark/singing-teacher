import hashlib,json,os,shutil,sys,threading
from datetime import datetime,timezone
from pathlib import Path

from singing_physics.engine import Engine
from singing_physics.phonation import synthesize_phonation
from singing_physics.pcm_design import freeze_pcm_hypotheses
from singing_physics.http_service import ScientificHTTPServer

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import app_motion


def encoded_capture(data,temporary,silent=False,pcm=None):
    if pcm is None:
        with Engine() as engine:
            audio,_=synthesize_phonation(engine,pose='a',JA=-3,F0=180,PR=8000,PS=0,duration_s=1.)
    else:audio=pcm.copy()
    if silent:audio[:]=0
    raw=temporary/'source.f32';raw.write_bytes(audio.astype('<f4').tobytes());video=temporary/'source.webm'
    app_motion.process([shutil.which('ffmpeg'),'-v','error','-f','f32le','-ar','44100','-ac','1','-i',str(raw),'-c:a','libopus',str(video)])
    media=video.read_bytes();mh=app_motion.sha(media)
    record={'kind':'motion-observation','id':'fixture-motion','attemptId':'attempt','media':{'sha256':mh,'byteLength':len(media),'mimeType':'video/webm'},'provenance':{'kind':'development-fixture','sourceHashes':[mh]},'timebase':{'syncUncertaintyMs':None},'samples':[]}
    rb=json.dumps(record).encode();rh=app_motion.sha(rb);identity=app_motion.sha((rh+mh).encode());root=data/'motion-captures'/identity;root.mkdir(parents=True)
    (root/'record.json').write_bytes(rb);(root/'media').write_bytes(media)
    (root/'summary.json').write_text(json.dumps({'id':identity,'recordSha256':rh,'mediaSha256':mh,'mediaByteLength':len(media)}))
    return identity


def test_encoded_native_pcm_real_decode_canonical_fit_unchanged_model(tmp_path,monkeypatch):
    data=tmp_path/'data';data.mkdir();identity=encoded_capture(data,tmp_path)
    server=ScientificHTTPServer(tmp_path/'jobs','t'*48,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('SCIENCE_URL',f'http://127.0.0.1:{server.server_port}');monkeypatch.setenv('SCIENCE_TOKEN','t'*48)
    try:
        with Engine() as engine:provenance=engine.provenance
        model=freeze_pcm_hypotheses(model_id='baseline',evidence_ids=['past'],evidence_hashes=['a'*64],provenance=provenance,hypotheses=[dict(hypothesis_id='one',anatomy={})],frozen_at=datetime.now(timezone.utc).isoformat()).data
        backend=app_motion.HTTPBackend(os.environ['SCIENCE_URL'],os.environ['SCIENCE_TOKEN'],'session')
        backend.execute(dict(action='register_model',command_id='register',expected_version=0,snapshot=model))
        (data/'science-current.json').write_text(json.dumps(dict(status='succeeded',runId='run-test')))
        run=data/'science-runs'/'run-test';run.mkdir(parents=True);(run/'summary.json').write_text(json.dumps(dict(sessionId='session')))
        result=app_motion.run(data,identity,'a',tmp_path/'analysis')
        assert result['status']=='available' and 0<result['actualSynthesisCalls']<=9
        assert len(result['windows'])==4 and all(w['status']=='scored' for w in result['windows'])
        assert result['decode']['sampleRateHz']==48000
        assert result['trajectoryBank']['synthesisRequests']<=36
        assert len(result['trajectoryBank']['pitchAnchorsHz'])<=3
        assert all(len(row['uncertainty'])==4 for row in result['temporalAnalysis']['sensitivity'])
        assert result['temporalAnalysis']['status']=='available'
        assert result['temporalAnalysis']['additionalSynthesisCalls']==0
        assert len(result['temporalAnalysis']['sensitivity'])==3
        assert all(len(s['best']['path'])==4 for s in result['temporalAnalysis']['sensitivity'])
        assert backend.execute({'action':'state'})['state']['snapshot']==model
        assert result['visualSync']=='unknown' and not result['modelUpdated']
        monkeypatch.setattr(app_motion,'fit_pcm',lambda *args,**kwargs:{'joint':{'best':None,'candidates':[{'status':'missing_predicted_features'}]},'actual_synthesis_calls':0})
        unsupported=app_motion.run(data,identity,'a',tmp_path/'missing-predictions')
        assert unsupported['status']=='insufficient-quality' and all(w['status']=='insufficient-quality' for w in unsupported['windows'])
        silent_dir=tmp_path/'silent-source';silent_dir.mkdir()
        silent_id=encoded_capture(data,silent_dir,silent=True)
        silence=app_motion.run(data,silent_id,'a',tmp_path/'silence')
        assert silence['status']=='insufficient-quality' and silence['actualSynthesisCalls']==0 and len(silence['windows'])==4
        assert all(w['status']=='unavailable' for w in silence['windows'])
    finally:server.shutdown();thread.join();server.server_close()


def test_decoder_timeout_reaps_process(tmp_path):
    import pytest,subprocess,time
    pidfile=tmp_path/'pid'
    code='import os,time;from pathlib import Path;Path('+repr(str(pidfile))+').write_text(str(os.getpid()));time.sleep(60)'
    with pytest.raises(subprocess.TimeoutExpired):app_motion.process([sys.executable,'-c',code],timeout=.2)
    pid=int(pidfile.read_text())
    with pytest.raises(ProcessLookupError):os.kill(pid,0)


def test_summary_publication_is_atomic_and_exclusive(tmp_path):
    import pytest
    target=tmp_path/'summary.json'
    with pytest.raises(ValueError):app_motion.write(target,{'invalid':float('nan')})
    assert not target.exists() and not list(tmp_path.iterdir())
    app_motion.write(target,{'status':'complete'})
    with pytest.raises(FileExistsError):app_motion.write(target,{'status':'replacement'})
    assert json.loads(target.read_text())=={'status':'complete'}
    assert list(tmp_path.iterdir())==[target]
